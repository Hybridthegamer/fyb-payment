// api/admin-transactions.js
// Returns wallet balance, FossaPay transaction history, and all Firestore payment
// records to the admin dashboard. Protected by Firebase ID token + ADMIN_EMAIL check.
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Verify Firebase ID token from Authorization header
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

  // Read organizer wallet config from Firestore
  let walletId, accountNumber;
  try {
    const configSnap = await db.collection('config').doc('fossapay').get();
    if (!configSnap.exists) {
      return res.status(500).json({ error: 'config/fossapay not found. Run setup first.' });
    }
    ({ walletId, accountNumber } = configSnap.data());
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read Firestore config', message: err.message });
  }

  // Fetch wallet balance and info from FossaPay
  let walletInfo = null;
  try {
    const walletRes = await fetch(
      `https://api-production.fossapay.com/api/v1/wallets/fiat/${walletId}`,
      { headers: { 'x-api-key': process.env.FOSSAPAY_SECRET_KEY } }
    );
    const rawWallet = await walletRes.text();
    console.log('[admin-transactions] Wallet info raw response:', rawWallet);
    try { walletInfo = JSON.parse(rawWallet); } catch { walletInfo = { raw: rawWallet }; }
  } catch (err) {
    console.error('[admin-transactions] Wallet info fetch failed:', err);
    walletInfo = { error: err.message };
  }

  // Fetch transaction history from FossaPay
  let transactions = null;
  try {
    const txRes = await fetch(
      `https://api-production.fossapay.com/api/v1/wallets/fiat/${walletId}/transactions`,
      { headers: { 'x-api-key': process.env.FOSSAPAY_SECRET_KEY } }
    );
    const rawTx = await txRes.text();
    console.log('[admin-transactions] Transactions raw response:', rawTx);
    try { transactions = JSON.parse(rawTx); } catch { transactions = { raw: rawTx }; }
  } catch (err) {
    console.error('[admin-transactions] Transactions fetch failed:', err);
    transactions = { error: err.message };
  }

  // Read all student payment records from Firestore payments collection
  let studentPayments = [];
  try {
    const paymentsSnap = await db.collection('payments').get();
    paymentsSnap.forEach(doc => {
      studentPayments.push({ uid: doc.id, ...doc.data() });
    });
  } catch (err) {
    console.error('[admin-transactions] Firestore payments read failed:', err);
    studentPayments = [];
  }

  // Read all withdrawal records — written by admin-withdraw.js on every successful transfer
  let withdrawals = [];
  try {
    const withdrawalsSnap = await db.collection('withdrawals').get();
    withdrawalsSnap.forEach(doc => {
      withdrawals.push({ id: doc.id, ...doc.data() });
    });
  } catch (err) {
    console.error('[admin-transactions] Firestore withdrawals read failed:', err);
    withdrawals = [];
  }

  // Read the FossaPay ledger summary — maintained atomically by the webhook
  // (deposits) and admin-withdraw (withdrawals). Balance = totalDeposits - totalWithdrawals.
  let summary = { totalDeposits: 0, totalWithdrawals: 0, depositCount: 0, withdrawalCount: 0 };
  try {
    const summarySnap = await db.collection('summary').doc('fossapay').get();
    if (summarySnap.exists) {
      summary = { ...summary, ...summarySnap.data() };
    }
  } catch (err) {
    console.error('[admin-transactions] Firestore summary read failed:', err);
  }

  return res.status(200).json({
    success:         true,
    accountNumber,
    walletId,
    walletInfo,
    transactions,
    studentPayments,
    withdrawals,
    summary,
  });
};
