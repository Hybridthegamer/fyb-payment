// api/admin-withdraw.js
// Initiates a withdrawal from the organizer FossaPay wallet to a specified bank account.
// Protected by Firebase ID token + ADMIN_EMAIL check.
//
// Required environment variables:
// FOSSAPAY_SECRET_KEY, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY, ADMIN_EMAIL

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify Firebase ID token
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }
  const idToken = authHeader.slice(7);

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired ID token', message: err.message });
  }

  // Admin email guard
  if (!process.env.ADMIN_EMAIL || decoded.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Access denied. You are not the admin.' });
  }

  const { amount, destinationBankCode, destinationAccountNumber, narration } = req.body || {};

  if (!amount || !destinationBankCode || !destinationAccountNumber || !narration) {
    return res.status(400).json({ error: 'Missing required fields: amount, destinationBankCode, destinationAccountNumber, narration' });
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  // Read walletId from Firestore config
  let walletId;
  try {
    const configSnap = await db.collection('config').doc('fossapay').get();
    if (!configSnap.exists) {
      return res.status(500).json({ error: 'config/fossapay not found. Run setup first.' });
    }
    walletId = configSnap.data().walletId;
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read Firestore config', message: err.message });
  }

  // Initiate withdrawal via FossaPay
  // NOTE: If FossaPay returns an error about the endpoint path, check Vercel logs
  // for the raw response and update the URL accordingly.
  let withdrawalResult;
  try {
    const withdrawRes = await fetch(
      'https://api-production.fossapay.com/api/v1/wallets/fiat/transfer',
      {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    process.env.FOSSAPAY_SECRET_KEY,
        },
        body: JSON.stringify({
          walletId,
          amount,
          destinationBankCode,
          destinationAccountNumber,
          narration,
        }),
      }
    );

    const rawWithdraw = await withdrawRes.text();
    console.log('[admin-withdraw] Withdrawal raw response:', rawWithdraw);

    try {
      withdrawalResult = JSON.parse(rawWithdraw);
    } catch {
      withdrawalResult = { raw: rawWithdraw };
    }

    if (!withdrawRes.ok) {
      return res.status(500).json({
        error:   'FossaPay withdrawal failed',
        details: withdrawalResult,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Withdrawal request threw an exception', message: err.message });
  }

  return res.status(200).json({ success: true, result: withdrawalResult });
};
