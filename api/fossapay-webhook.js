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

  // Verify HMAC-SHA256 signature — reject anything that doesn't match
  const webhookSecret = process.env.FOSSAPAY_WEBHOOK_SECRET || '';
  const signature = req.headers['x-fossapay-signature'] || '';
  const hash = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  console.log('[Webhook Debug] Computed hash:', hash.substring(0, 20) + '...');
  console.log('[Webhook Debug] Received sig: ', signature ? signature.substring(0, 20) + '...' : 'NONE');
  console.log('[Webhook Debug] Match:', hash === signature);
  console.log('[Webhook Debug] webhookSecret length:', webhookSecret.length);

  // TEMPORARY bypass — set SKIP_SIG_VERIFY=true in Vercel env vars to skip
  // signature check while diagnosing. Remove this env var once signature
  // verification is confirmed working.
  const skipVerify = process.env.SKIP_SIG_VERIFY === 'true';

  if (!skipVerify && hash !== signature) {
    console.error('[Webhook] Signature mismatch — possible tampered or replayed request');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  if (skipVerify) {
    console.warn('[Webhook] WARNING: Signature verification bypassed via SKIP_SIG_VERIFY env var');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { event, event_id: eventId, data } = payload;

  // Only process deposit.completed — acknowledge everything else immediately
  if (event !== 'deposit.completed') {
    return res.status(200).json({ received: true });
  }

  const receivedAmount     = data?.amount;
  const fossaTransactionId = data?.transaction_id;

  // FossaPay sends net credited amount with up to 2 decimal places.
  // expectedAmount in Firestore is stored as a rounded integer (Math.round of net).
  // Round receivedAmount to the nearest integer before querying to ensure match.
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
    // Log and return 200 so FossaPay does not retry indefinitely.
    // Investigate manually using eventId in Vercel logs.
    console.error(`[Webhook] Firestore query failed for event ${eventId}:`, err);
    return res.status(200).json({ received: true });
  }

  // Idempotency guard — if already processed, do nothing
  if (pendingDoc.status !== 'pending') {
    return res.status(200).json({ received: true });
  }

  // Atomic batch write: update payments/{uid} and mark pendingPayments/{accountNumber} complete
  const batch      = db.batch();
  const paymentRef = db.collection('payments').doc(pendingDoc.uid);

  const txn = {
    ref:      fossaTransactionId,
    items:    pendingDoc.items,
    amount:   receivedAmount,
    subtotal: pendingDoc.subtotal  ?? receivedAmount,
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
    totalPaid:    admin.firestore.FieldValue.increment(receivedAmount),
    transactions: admin.firestore.FieldValue.arrayUnion(txn),
  };
  if (pendingDoc.jacketSize != null) {
    paymentUpdate.jacketSize = pendingDoc.jacketSize;
  }

  batch.set(paymentRef, paymentUpdate, { merge: true });
  batch.update(pendingRef, {
    status:      'completed',
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  // Log to Google Sheets — fire-and-forget, don't let this delay the 200 response
  fetch(process.env.GOOGLE_SHEETS_WEBHOOK, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timestamp:  new Date().toLocaleString('en-NG'),
      name:       pendingDoc.name,
      matric:     pendingDoc.matric,
      email:      pendingDoc.email,
      phone:      pendingDoc.phone,
      gender:     pendingDoc.gender,
      items:      pendingDoc.items.map(i => i.name).join(', '),
      total:      receivedAmount,
      reference:  fossaTransactionId,
      jacketSize: pendingDoc.jacketSize || 'N/A',
    }),
  }).catch(err => console.error('[Webhook] Sheets log failed:', err));

  return res.status(200).json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };
