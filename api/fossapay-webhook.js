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
  console.log('[Webhook Debug] req.body type at entry:', typeof req.body);
  console.log('[Webhook Debug] req.body defined:', req.body !== undefined);

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

  console.log('[Webhook Debug] rawBody length:', rawBody.length);
  console.log('[Webhook Debug] rawBody first 100 chars:', rawBody.substring(0, 100));

  // Temporary: log all headers to confirm correct signature header name — remove after first successful webhook
  console.log('[Webhook] Incoming headers:', JSON.stringify(req.headers));

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
  const match = crypto.timingSafeEqual(
    Buffer.from(hash, 'hex'),
    Buffer.from(receivedSig, 'hex')
  );

  console.log('[Webhook Debug] dataString length:', dataString.length);
  console.log('[Webhook Debug] dataString first 100 chars:', dataString.substring(0, 100));
  console.log('[Webhook Debug] Received sig:', receivedSig ? receivedSig.substring(0, 20) + '...' : 'NONE');
  console.log('[Webhook Debug] webhookSecret length:', webhookSecret.length);

  if (!match) {
    console.error('[Webhook] Signature mismatch — possible tampered or replayed request');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // FossaPay sends camelCase field names — eventType, eventId, not event, event_id
  const eventType = payload.eventType || payload.event;
  const eventId   = payload.eventId   || payload.event_id;

  console.log('[Webhook Debug] eventType:', eventType);
  console.log('[Webhook Debug] eventId:', eventId);
  console.log('[Webhook Debug] data keys:', data ? Object.keys(data).join(', ') : 'null');

  // Only process deposit.completed — acknowledge everything else immediately
  if (eventType !== 'deposit.completed') {
    console.log('[Webhook Debug] Ignoring non-deposit event:', eventType);
    return res.status(200).json({ received: true });
  }

  const receivedAmount     = data?.amount;
  // FossaPay uses camelCase — try both forms
  const fossaTransactionId = data?.transactionId || data?.transaction_id;
  console.log('[Webhook Debug] fossaTransactionId:', fossaTransactionId);
  console.log('[Webhook Debug] receivedAmount:', data?.amount);

  // Idempotency: check if this transaction was already processed
  const existingPayment = await db.collection('processedEvents').doc(fossaTransactionId).get();
  if (existingPayment.exists) {
    console.log('[Webhook] Duplicate event, already processed:', fossaTransactionId);
    return res.status(200).json({ received: true, duplicate: true });
  }

  // FossaPay reports the GROSS amount the student transferred (e.g. "4500.00"),
  // which equals the totalWithFee shown on the account-details screen and stored
  // as expectedAmount (an integer) in initiate-payment.js.
  // Round receivedAmount to the nearest integer before querying to ensure match.
  console.log('[Webhook Debug] Full data object keys:', data ? Object.keys(data).join(', ') : 'null');
  console.log('[Webhook Debug] data.amount:', data?.amount);
  console.log('[Webhook Debug] queryAmount:', Math.round(data?.amount));
  const queryAmount = Math.round(receivedAmount);

  // With the shared-account model all students pay to the same organizer account.
  // Match the deposit to the correct pending payment by querying for the oldest
  // pending record whose expectedAmount equals the received amount.
  // Requires a Firestore composite index on:
  //   pendingPayments — status ASC, expectedAmount ASC, createdAt ASC
  let pendingRef, pendingDoc;
  try {
    const q = await db.collection('pendingPayments')
      .where('status', '==', 'pending')
      .where('expectedAmount', '==', queryAmount)
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get();

    if (q.empty) {
      console.warn(
        `[Webhook] No pending payment found for amount ${receivedAmount}. ` +
        `Event ID: ${eventId}. Acknowledging without action.`
      );
      return res.status(200).json({ received: true });
    }

    pendingRef = q.docs[0].ref;
    pendingDoc = q.docs[0].data();
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
