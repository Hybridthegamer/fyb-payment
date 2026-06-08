// Required environment variables:
// FOSSAPAY_SECRET_KEY       — FossaPay live secret key
// FIREBASE_PROJECT_ID       — Firebase project ID
// FIREBASE_CLIENT_EMAIL     — Firebase service account email
// FIREBASE_PRIVATE_KEY      — Firebase private key (with \n as literal backslash-n in Vercel dashboard)

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

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { idToken, name, matric, email, phone, gender, items, amount, jacketSize } =
    req.body || {};

  // Validate required fields
  if (!idToken || !name || !matric || !email || !phone || !gender || !items || amount == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive integer in naira' });
  }
  const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailRx.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (typeof idToken !== 'string' || idToken.length === 0) {
    return res.status(400).json({ error: 'Invalid ID token' });
  }

  // Verify Firebase ID token server-side — never trust a client-supplied UID
  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired ID token' });
  }

  // Create FossaPay customer
  let customerId;
  try {
    const customerRes = await fetch('https://api-production.fossapay.com/api/v1/customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.FOSSAPAY_SECRET_KEY,
      },
      body: JSON.stringify({
        firstName:    name.split(' ')[0],
        lastName:     name.split(' ').slice(1).join(' ') || name.split(' ')[0],
        emailAddress: email,
        mobileNumber: phone,
        dateOfBirth:  '2000-01-01',
        address:      'Rivers State University, Port Harcourt',
        city:         'Port Harcourt',
        country:      'Nigeria',
        type:         'individual',
      }),
    });
    const customerData = await customerRes.json();
    if (!customerRes.ok) {
      return res.status(500).json({
        error: customerData.message || 'Failed to create FossaPay customer',
      });
    }
    customerId = customerData.data?.id ?? customerData.id;
  } catch {
    return res.status(500).json({ error: 'FossaPay customer creation failed' });
  }

  // Create FossaPay fiat wallet — returns dedicated bank account details
  let accountNumber, bankName, bankCode, walletId;
  try {
    const walletRes = await fetch(
      'https://api-production.fossapay.com/api/v1/wallets/fiat/create',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.FOSSAPAY_SECRET_KEY,
        },
        body: JSON.stringify({
          customerId,
          walletName:      'FYB - ' + name,
          walletReference: 'FYB-' + uid + '-' + Date.now(),
        }),
      }
    );
    const walletData = await walletRes.json();
    if (!walletRes.ok) {
      return res.status(500).json({
        error: walletData.message || 'Failed to create FossaPay wallet',
      });
    }
    const w    = walletData.data ?? walletData;
    accountNumber = w.accountNumber;
    bankName      = w.bankName;
    bankCode      = w.bankCode;
    walletId      = w.walletId ?? w.id;
  } catch {
    return res.status(500).json({ error: 'FossaPay wallet creation failed' });
  }

  // Store pending payment — document ID = accountNumber so the webhook can look it up instantly
  try {
    await db.collection('pendingPayments').doc(accountNumber).set({
      uid,
      name, matric, email, phone, gender,
      items,
      jacketSize:     jacketSize || null,
      expectedAmount: amount,
      walletId,
      accountNumber,
      bankName,
      bankCode,
      status:    'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to store payment record' });
  }

  return res.status(200).json({ success: true, accountNumber, bankName, bankCode, amount });
};
