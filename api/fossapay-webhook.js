// Required environment variables:
// FOSSAPAY_WEBHOOK_SECRET   — Webhook signing secret from FossaPay dashboard
// FIREBASE_PROJECT_ID       — Firebase project ID
// FIREBASE_CLIENT_EMAIL     — Firebase service account email
// FIREBASE_PRIVATE_KEY      — Firebase private key (with \n as literal backslash-n in Vercel dashboard)
// GOOGLE_SHEETS_WEBHOOK     — Google Apps Script web app URL

const crypto = require('crypto');
const admin  = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Collect raw body as string for signature verification before any parsing
  let rawBody = '';
  await new Promise((resolve, reject) => {
    req.on('data', chunk => { rawBody += chunk.toString(); });
    req.on('end', resolve);
    req.on('error', reject);
  });

  // Parse body once — needed for sig verification and event processing
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Verify HMAC-SHA256 signature — sign only the `data` property
  const webhookSecret = process.env.FOSSAPAY_WEBHOOK_SECRET || '';
  const receivedSig = req.headers['x-fossapay-signature'] || '';
  const data = payload.data;
  const dataString = JSON.stringify(data);
  const hash = crypto
    .createHmac('sha256', webhookSecret)
    .update(dataString)
    .digest('hex');
  // Guard against malformed/empty signatures: timingSafeEqual throws if the two
  // buffers differ in length, which would 500 instead of cleanly rejecting.
  const expectedBuf = Buffer.from(hash, 'hex');
  const receivedBuf = Buffer.from(receivedSig, 'hex');
  const match =
    expectedBuf.length === receivedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, receivedBuf);

  if (!match) {
    console.error('[Webhook] Signature mismatch — possible tampered or replayed request');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // FossaPay sends camelCase field names — eventType, eventId, not event, event_id
  const eventType = payload.eventType || payload.event;
  const eventId   = payload.eventId   || payload.event_id;

  // Only process deposit.completed — acknowledge everything else immediately
  if (eventType !== 'deposit.completed') {
    return res.status(200).json({ received: true });
  }

  const receivedAmount     = data?.amount;
  // FossaPay uses camelCase — try both forms
  const fossaTransactionId = data?.transactionId || data?.transaction_id;

  // Without a transaction id we can't dedupe or key the processed-events doc;
  // acknowledge so FossaPay stops retrying, but take no action.
  if (!fossaTransactionId) {
    console.warn('[Webhook] Missing transactionId on deposit.completed. Event ID:', eventId);
    return res.status(200).json({ received: true });
  }

  // Idempotency: check if this transaction was already processed
  const existingPayment = await db.collection('processedEvents').doc(fossaTransactionId).get();
  if (existingPayment.exists) {
    console.log('[Webhook] Duplicate event, already processed:', fossaTransactionId);
    return res.status(200).json({ received: true, duplicate: true });
  }

  // FossaPay reports the NET-credited amount (e.g. "4500.00") — the student's
  // transfer minus FossaPay's settlement fee. By design that net equals the
  // subtotal stored as expectedAmount in initiate-payment.js (the fee markup
  // covers FossaPay's cut). Round receivedAmount to the nearest integer before
  // querying so a "4500.00" string matches the integer expectedAmount.
  const queryAmount = Math.round(receivedAmount);

  // With the shared-account model all students pay to the same organizer account.
  // Match the deposit to the correct pending payment by querying for the oldest
  // pending record whose expectedAmount equals the received (net-credited) amount.
  //
  // expectedAmount is stored as the SUBTOTAL (see initiate-payment.js): FossaPay
  // credits the net after its settlement fee, and the fee markup is sized so net
  // == subtotal. For flat-fee tiers net == subtotal exactly; for the top 1.2%
  // tier rounding can leave net = subtotal + 1. So try the exact amount first,
  // then ±1, to absorb that rounding without widening the match for unrelated
  // payments. Each candidate is an exact equality query, so it reuses the
  //   pendingPayments — status ASC, expectedAmount ASC, createdAt ASC
  // composite index and keeps oldest-first FIFO matching within a given amount.
  let pendingRef, pendingDoc;
  try {
    const candidates = [queryAmount, queryAmount - 1, queryAmount + 1];
    let matchDoc = null;
    for (const candidate of candidates) {
      const q = await db.collection('pendingPayments')
        .where('status', '==', 'pending')
        .where('expectedAmount', '==', candidate)
        .orderBy('createdAt', 'asc')
        .limit(1)
        .get();
      if (!q.empty) { matchDoc = q.docs[0]; break; }
    }

    if (!matchDoc) {
      console.warn(
        `[Webhook] No pending payment found for amount ${receivedAmount} ` +
        `(tried ${candidates.join(', ')}). Event ID: ${eventId}. ` +
        `Acknowledging without action.`
      );
      return res.status(200).json({ received: true });
    }

    pendingRef = matchDoc.ref;
    pendingDoc = matchDoc.data();
  } catch (err) {
    console.error('[Webhook] Firestore query failed for event', eventId + ':', err);
    return res.status(500).json({ error: 'Internal error' });
  }

  // Idempotency guard — if already processed, do nothing
  if (pendingDoc.status !== 'pending') {
    return res.status(200).json({ received: true });
  }

  // Atomic batch write: processedEvents + payments/{uid} + pendingPayments/{accountNumber}
  const batch              = db.batch();
  const processedEventsRef = db.collection('processedEvents').doc(fossaTransactionId);
  const paymentRef         = db.collection('payments').doc(pendingDoc.uid);

  const parsedAmount = parseFloat(receivedAmount);
  const txn = {
    ref:      fossaTransactionId,
    items:    pendingDoc.items,
    amount:   parsedAmount,
    subtotal: pendingDoc.subtotal  ?? parsedAmount,
    fee:      pendingDoc.fee       ?? 0,
    date:     new Date().toISOString(),
  };

  const paymentUpdate = {
    name:         pendingDoc.name,
    matric:       pendingDoc.matric,
    email:        pendingDoc.email,
    phone:        pendingDoc.phone,
    gender:       pendingDoc.gender,
    paidItems:    admin.firestore.FieldValue.arrayUnion(...pendingDoc.items.map(i => i.id)),
    totalPaid:    admin.firestore.FieldValue.increment(parsedAmount),
    transactions: admin.firestore.FieldValue.arrayUnion(txn),
    paidAt:       admin.firestore.FieldValue.serverTimestamp(),
  };
  if (pendingDoc.jacketSize != null) {
    paymentUpdate.jacketSize = pendingDoc.jacketSize;
  }

  batch.set(processedEventsRef, {
    eventId:     eventId,
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(paymentRef, paymentUpdate, { merge: true });
  batch.update(pendingRef, {
    status:         'completed',
    completedAt:    admin.firestore.FieldValue.serverTimestamp(),
    // The client receipt screen reads transactionRef off this doc — persist it
    // here so the student sees their reference instead of a "—" placeholder.
    transactionRef: fossaTransactionId,
  });

  await batch.commit();

  try {
    const sheetsPayload = {
      timestamp: new Date().toISOString(),
      name: pendingDoc.name,
      matric: pendingDoc.matric,
      email: pendingDoc.email,
      phone: pendingDoc.phone,
      gender: pendingDoc.gender,
      items: (pendingDoc.items || []).map(i => i.name).join(', '),
      subtotal: pendingDoc.subtotal,
      fee: pendingDoc.fee,
      totalPaid: pendingDoc.displayAmount,
      transactionRef: fossaTransactionId,
      paidAt: new Date().toISOString()
    };

    await Promise.race([
      fetch(process.env.GOOGLE_SHEETS_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetsPayload)
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sheets timeout')), 5000)
      )
    ]);
    console.log('[Sheets] Logged successfully');
  } catch (err) {
    console.error('[Sheets] Logging failed:', err.message);
  }

  return res.status(200).json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };
