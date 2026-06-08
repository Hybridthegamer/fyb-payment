// Required environment variables:
// FOSSAPAY_WEBHOOK_SECRET   — Webhook signing secret from FossaPay dashboard
// FIREBASE_PROJECT_ID       — Firebase project ID
// FIREBASE_CLIENT_EMAIL     — Firebase service account email
// FIREBASE_PRIVATE_KEY      — Firebase private key (with \n as literal backslash-n in Vercel dashboard)
// GOOGLE_SHEETS_WEBHOOK     — Google Apps Script web app URL

// Disable Vercel's automatic body parsing so we can read the raw body for HMAC verification
module.exports.config = { api: { bodyParser: false } };

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

  // Verify HMAC-SHA256 signature — reject anything that doesn't match
  const signature = req.headers['x-fossapay-signature'] || '';
  const hash = crypto
    .createHmac('sha256', process.env.FOSSAPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (hash !== signature) {
    console.error('[Webhook] Signature mismatch — possible tampered or replayed request');
    return res.status(401).json({ error: 'Invalid signature' });
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

  const accountNumber      = data?.recipient?.account_number;
  const receivedAmount     = data?.amount;
  const fossaTransactionId = data?.transaction_id;

  // Look up the pending payment record
  const pendingRef  = db.collection('pendingPayments').doc(accountNumber);
  const pendingSnap = await pendingRef.get();

  if (!pendingSnap.exists) {
    // Unknown account — not our payment; acknowledge without action
    return res.status(200).json({ received: true });
  }

  const pendingDoc = pendingSnap.data();

  // Idempotency guard — if already processed, do nothing
  if (pendingDoc.status !== 'pending') {
    return res.status(200).json({ received: true });
  }

  // Reject amounts that differ by more than ₦1 (FossaPay may add/subtract fractions)
  if (Math.abs(receivedAmount - pendingDoc.expectedAmount) > 1) {
    console.error(
      `[Webhook] Amount mismatch for ${accountNumber}: ` +
      `received ${receivedAmount}, expected ${pendingDoc.expectedAmount}`
    );
    return res.status(200).json({ received: true });
  }

  // Atomic batch write: update payments/{uid} and mark pendingPayments/{accountNumber} complete
  const batch      = db.batch();
  const paymentRef = db.collection('payments').doc(pendingDoc.uid);

  const txn = {
    ref:    fossaTransactionId,
    items:  pendingDoc.items,
    amount: receivedAmount,
    date:   new Date().toISOString(),
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
