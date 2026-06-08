const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

function normalizePhone(raw) {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('234')) return '+' + digits;
  if (digits.startsWith('0')) return '+234' + digits.slice(1);
  return '+234' + digits;
}

module.exports = async function handler(req, res) {
  // STEP 1 — CORS + validation
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { idToken, name, matric, email, phone, gender, items, amount, jacketSize } =
    req.body || {};

  if (!idToken || !name || !matric || !email || !phone || !gender || !items || amount == null) {
    return res.status(400).json({ success: false, error: 'Missing required fields: idToken, name, matric, email, phone, gender, items, amount are all required' });
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ success: false, error: 'amount must be a positive integer' });
  }
  if (!String(email).includes('@')) {
    return res.status(400).json({ success: false, error: 'Invalid email address' });
  }

  // STEP 3 — Verify Firebase ID token
  let uid;
  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    uid = decodedToken.uid;
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired ID token' });
  }

  // STEP 4 — Get or create FossaPay customer
  let customerId;

  // 4A — Check Firestore for a previously stored fossaCustomerId
  const paymentDoc = await db.collection('payments').doc(uid).get();
  const storedCustomerId = paymentDoc.exists ? paymentDoc.data().fossaCustomerId : null;

  if (storedCustomerId) {
    // 4B — Reuse existing customer, skip creation entirely
    console.log('Reusing existing FossaPay customer: ' + storedCustomerId);
    customerId = storedCustomerId;
  } else {
    // 4C — No stored ID; attempt to create a new customer
    let createRes, createBody;
    try {
      createRes = await fetch('https://api-production.fossapay.com/api/v1/customers', {
        method: 'POST',
        headers: {
          'x-api-key': process.env.FOSSAPAY_SECRET_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: 'fybpayment26',
          emailAddress: email,
          mobileNumber: normalizePhone(phone),
          dateOfBirth: '2000-01-01',
          address: 'Rivers State University',
          city: 'Port Harcourt',
          country: 'Nigeria',
          type: 'individual',
        }),
      });
      createBody = await createRes.json();
    } catch (err) {
      return res.status(500).json({ success: false, error: 'FossaPay customer request failed: ' + err.message });
    }

    console.log('FossaPay create customer:', createRes.status, JSON.stringify(createBody));

    if (createRes.ok) {
      customerId = createBody.id || createBody.data?.id || createBody.customer?.id;
      await db.collection('payments').doc(uid).set({ fossaCustomerId: customerId }, { merge: true });
    } else {
      const errMsg = String(createBody?.message || '');

      if (errMsg.toLowerCase().includes('already exists')) {
        // First-time recovery: customer exists on FossaPay but we never stored their ID
        let listRes, rawBody;
        try {
          listRes = await fetch('https://api-production.fossapay.com/api/v1/customers', {
            headers: { 'x-api-key': process.env.FOSSAPAY_SECRET_KEY },
          });
          rawBody = await listRes.json();
        } catch (err) {
          return res.status(500).json({ success: false, error: 'FossaPay customer list request failed: ' + err.message });
        }

        console.log('FossaPay customer list:', listRes.status, JSON.stringify(rawBody));

        let list = [];
        if (Array.isArray(rawBody)) list = rawBody;
        else if (Array.isArray(rawBody?.data)) list = rawBody.data;
        else if (Array.isArray(rawBody?.customers)) list = rawBody.customers;
        else if (Array.isArray(rawBody?.data?.customers)) list = rawBody.data.customers;
        else {
          return res.status(500).json({
            success: false,
            error: 'Cannot parse customer list: ' + JSON.stringify(rawBody).slice(0, 300),
          });
        }

        const match = list.find(c => {
          const customerEmail = c.email || c.emailAddress || '';
          return customerEmail.toLowerCase() === email.toLowerCase();
        });

        if (!match) {
          return res.status(500).json({
            success: false,
            error:
              'Customer exists on FossaPay but not found in list. List length: ' +
              list.length +
              '. Sample record keys: ' +
              Object.keys(list[0] || {}).join(', '),
          });
        }

        customerId = match.id || match.customerId;
        await db.collection('payments').doc(uid).set({ fossaCustomerId: customerId }, { merge: true });
      } else {
        return res.status(500).json({ success: false, error: createBody });
      }
    }
  }

  // STEP 5 — Create FossaPay fiat wallet
  let walletRes, walletBody;
  try {
    walletRes = await fetch('https://api-production.fossapay.com/api/v1/wallets/fiat/create', {
      method: 'POST',
      headers: { 'x-api-key': process.env.FOSSAPAY_SECRET_KEY },
      body: JSON.stringify({
        customerId: customerId,
        walletName: 'FYB ' + name,
        walletReference: 'FYB-' + uid + '-' + Date.now(),
      }),
    });
    walletBody = await walletRes.json();
  } catch (err) {
    return res.status(500).json({ success: false, error: 'FossaPay wallet request failed: ' + err.message });
  }

  console.log('FossaPay wallet response:', walletRes.status, JSON.stringify(walletBody));

  if (!walletRes.ok) {
    return res.status(500).json({ success: false, error: walletBody });
  }

  const accountNumber =
    walletBody.accountNumber ||
    walletBody.data?.accountNumber ||
    walletBody.account?.accountNumber ||
    walletBody.data?.account?.accountNumber;

  const bankName =
    walletBody.bankName ||
    walletBody.data?.bankName ||
    walletBody.account?.bankName ||
    'Wema Bank';

  const walletId =
    walletBody.walletId ||
    walletBody.id ||
    walletBody.data?.walletId ||
    walletBody.data?.id;

  if (!accountNumber) {
    return res.status(500).json({
      success: false,
      error:
        'Wallet created but accountNumber not found. Response: ' +
        JSON.stringify(walletBody).slice(0, 400),
    });
  }

  // STEP 6 — Store pending payment in Firestore
  await db.collection('pendingPayments').doc(accountNumber).set({
    uid,
    name,
    matric,
    email,
    phone: normalizePhone(phone),
    gender,
    items,
    jacketSize: jacketSize || null,
    expectedAmount: amount,
    walletId,
    accountNumber,
    bankName,
    fossaCustomerId: customerId,
    status: 'pending',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // STEP 7 — Return success
  return res.status(200).json({ success: true, accountNumber, bankName, amount });
};
