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

  function normalizePhone(phone) {
    const digits = phone.replace(/\D/g, '');
    if (digits.startsWith('234')) return '+' + digits;
    if (digits.startsWith('0')) return '+234' + digits.slice(1);
    return '+' + digits;
  }

  // Create FossaPay customer (or retrieve existing one)
  let customerId;
  try {
    const createRes = await fetch('https://api-production.fossapay.com/api/v1/customers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.FOSSAPAY_SECRET_KEY,
      },
      body: JSON.stringify({
        firstName:    'fybpayment26',
        emailAddress: email,
        mobileNumber: normalizePhone(phone),
        dateOfBirth:  '2000-01-01',
        address:      'Rivers State University, Port Harcourt',
        city:         'Port Harcourt',
        country:      'Nigeria',
        type:         'individual',
      }),
    });
    const createBody = await createRes.json();
    console.log('FossaPay create customer response:', JSON.stringify(createBody));
    if (!createRes.ok) {
      const errMsg = createBody.message || '';
      if (!errMsg.toLowerCase().includes('already exists')) {
        return res.status(500).json({
          success: false,
          error: createBody.message || JSON.stringify(createBody),
        });
      }
      // Customer already exists — retrieve the list and find by email
      const listRes = await fetch('https://api-production.fossapay.com/api/v1/customers', {
        headers: { 'x-api-key': process.env.FOSSAPAY_SECRET_KEY },
      });
      const listBody = await listRes.json();
      console.log('FossaPay customer list raw response:', JSON.stringify(listBody));

      let customers = [];
      if (Array.isArray(listBody)) {
        customers = listBody;
      } else if (Array.isArray(listBody?.data)) {
        customers = listBody.data;
      } else if (Array.isArray(listBody?.customers)) {
        customers = listBody.customers;
      } else if (Array.isArray(listBody?.data?.customers)) {
        customers = listBody.data.customers;
      } else {
        return res.status(500).json({
          success: false,
          error: 'Unexpected customer list shape: ' + JSON.stringify(listBody).slice(0, 200),
        });
      }

      const existing = customers.find(
        (c) => (c.email || c.emailAddress)?.toLowerCase() === email.toLowerCase()
      );
      if (!existing) {
        return res.status(500).json({
          success: false,
          error: 'Email not found in customer list. Total customers fetched: ' + customers.length,
        });
      }
      customerId = existing.id;
    } else {
      customerId = createBody.data?.id ?? createBody.id;
    }
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
    console.log('FossaPay create wallet response:', JSON.stringify(walletData));
    if (!walletRes.ok) {
      return res.status(500).json({
        success: false,
        error: walletData.message || JSON.stringify(walletData),
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
      customerId,
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
