// api/setup-account.js
// One-time setup: creates the organizer FossaPay customer + wallet and stores account
// details in Firestore at config/fossapay. Protected by SETUP_SECRET env var.
// Call once before the portal goes live. Returns 409 if already configured.
//
// Usage:
//   POST https://<your-vercel-domain>/api/setup-account
//   Header: x-setup-secret: <value of SETUP_SECRET env var>

const admin  = require('firebase-admin');
const crypto = require('crypto');

if (!process.env.FIREBASE_PRIVATE_KEY) {
  throw new Error('FIREBASE_PRIVATE_KEY environment variable is not set');
}

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

  // Timing-safe comparison (via digests, so lengths always match) — a plain
  // !== leaks the match length through response timing.
  const provided = String(req.headers['x-setup-secret'] || '');
  const expected = process.env.SETUP_SECRET || '';
  const secretOk = expected.length > 0 && crypto.timingSafeEqual(
    crypto.createHash('sha256').update(provided).digest(),
    crypto.createHash('sha256').update(expected).digest(),
  );
  if (!secretOk) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let existing;
  try {
    existing = await db.collection('config').doc('fossapay').get();
  } catch (err) {
    return res.status(500).json({ error: 'Firestore read failed', message: err.message });
  }

  if (existing.exists) {
    return res.status(409).json({
      error: 'Organizer account already configured. Delete config/fossapay in Firestore to reset.',
      data: existing.data(),
    });
  }

  // Step 1 — Create FossaPay customer for the organizer

  let customerId;
  try {
    const customerRes = await fetch('https://api-production.fossapay.com/api/v1/customers', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    process.env.FOSSAPAY_SECRET_KEY,
      },
      body: JSON.stringify({
        firstName:    'fyb',
        lastName:     'outfit',
        emailAddress: process.env.ORGANIZER_EMAIL,
        mobileNumber: process.env.ORGANIZER_PHONE,
        dateOfBirth:  '2000-01-01',
        address:      'Rivers State University, Port Harcourt',
        city:         'Port Harcourt',
        country:      'Nigeria',
        type:         'individual',
      }),
    });

    const rawCustomer = await customerRes.text();
    console.log('[setup-account] FossaPay customer raw response:', rawCustomer);

    let customerData;
    try {
      customerData = JSON.parse(rawCustomer);
    } catch {
      return res.status(500).json({ error: 'FossaPay customer response is not valid JSON', raw: rawCustomer });
    }

    if (!customerRes.ok) {
      return res.status(500).json({ error: 'FossaPay customer creation failed', details: customerData });
    }

    customerId = customerData.data?.id ?? customerData.id;

    if (!customerId) {
      return res.status(500).json({
        error: 'FossaPay customer created but no ID returned. Check raw response.',
        raw: rawCustomer,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'FossaPay customer request threw an exception', message: err.message });
  }

  // Step 2 — Create fiat wallet for the organizer

  let accountNumber, accountName, bankName, bankCode, walletId;
  try {
    const walletRes = await fetch('https://api-production.fossapay.com/api/v1/wallets/fiat/create', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key':    process.env.FOSSAPAY_SECRET_KEY,
      },
      body: JSON.stringify({
        customerId,
        walletName:      'NACOS FYB 2026 Payments',
        walletReference: 'FYB-ORGANIZER-' + Date.now(),
      }),
    });

    const rawWallet = await walletRes.text();
    console.log('[setup-account] FossaPay wallet raw response:', rawWallet);

    let walletData;
    try {
      walletData = JSON.parse(rawWallet);
    } catch {
      return res.status(500).json({ error: 'FossaPay wallet response is not valid JSON', raw: rawWallet });
    }

    if (!walletRes.ok) {
      return res.status(500).json({ error: 'FossaPay wallet creation failed', details: walletData });
    }

    const w   = walletData.data ?? walletData;
    accountNumber = w.accountNumber;
    accountName   = w.accountName ?? 'NACOS FYB 2026';
    bankName      = w.bankName;
    bankCode      = w.bankCode;
    walletId      = w.walletId ?? w.id;

    if (!accountNumber) {
      return res.status(500).json({
        error: 'FossaPay wallet created but no accountNumber returned. Check raw response.',
        raw: rawWallet,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'FossaPay wallet request threw an exception', message: err.message });
  }

  // Step 3 — Persist to Firestore

  try {
    await db.collection('config').doc('fossapay').set({
      customerId,
      walletId:     walletId || null,
      accountNumber,
      accountName,
      bankName,
      bankCode,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Firestore write failed', message: err.message });
  }

  return res.status(200).json({
    success: true,
    message: 'Organizer account created and stored successfully. Do NOT call this endpoint again.',
    accountNumber,
    accountName,
    bankName,
    bankCode,
  });
};
