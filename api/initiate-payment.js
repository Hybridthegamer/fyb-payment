// api/initiate-payment.js
// Reads the pre-stored organizer FossaPay account from Firestore (config/fossapay),
// saves the student's pending payment record, and returns the shared bank account details.
// Does NOT call the FossaPay API — that only happens once via /api/setup-account.
//
// Required environment variables:
// FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

const admin = require('firebase-admin');

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

const ALLOWED_ORIGINS = [
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.FRONTEND_ORIGIN || null,
  'http://localhost:3000',
].filter(Boolean);

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { idToken, name, matric, email, phone, gender, items, amount, jacketSize } =
    req.body || {};

  // Input validation

  if (!idToken || !name || !matric || !email || !phone || !gender || !items || amount == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive integer in naira' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (typeof idToken !== 'string' || idToken.length === 0) {
    return res.status(400).json({ error: 'Invalid ID token' });
  }

  // Firebase token verification — never trust a client-supplied UID

  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired ID token' });
  }

  // Read the pre-created organizer account from Firestore

  let accountNumber, accountName, bankName, bankCode;
  try {
    const configSnap = await db.collection('config').doc('fossapay').get();
    if (!configSnap.exists) {
      console.error('[initiate-payment] config/fossapay not found — run /api/setup-account first.');
      return res.status(500).json({ error: 'Payment account not configured. Contact the admin.' });
    }
    ({ accountNumber, accountName, bankName, bankCode } = configSnap.data());
  } catch (err) {
    console.error('[initiate-payment] Failed to read config/fossapay:', err);
    return res.status(500).json({ error: 'Failed to load payment configuration' });
  }

  // Store pending payment — doc ID = uid
  // The Firestore real-time listener on the client watches pendingPayments/{uid}.
  // The webhook queries this collection by expectedAmount to find the right record.
  // Using set() (not add()) so a returning student who abandons and restarts always
  // overwrites their own stale pending doc rather than creating duplicates.

  try {
    await db.collection('pendingPayments').doc(uid).set({
      uid,
      name,
      matric,
      email,
      phone,
      gender,
      items,
      jacketSize:     jacketSize || null,
      expectedAmount: amount,
      accountNumber,
      bankName,
      bankCode,
      status:    'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('[initiate-payment] Firestore write failed:', err);
    return res.status(500).json({ error: 'Failed to store payment record' });
  }

  return res.status(200).json({
    success: true,
    accountNumber,
    accountName,
    bankName,
    bankCode,
    amount,
  });
};
