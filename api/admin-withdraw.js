// api/admin-withdraw.js
// Initiates an inter-bank transfer from the organizer FossaPay account.
// Requires prior bank name enquiry to obtain destinationAccountName + destinationBankName.
// Protected by Firebase ID token + ADMIN_EMAIL check.
//
// Required environment variables:
// FOSSAPAY_SECRET_KEY, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY, ADMIN_EMAIL

const admin = require('firebase-admin');
const { randomUUID } = require('crypto');

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

  const {
    amount,
    destinationBankCode,
    destinationAccountNumber,
    destinationAccountName,
    destinationBankName,
    remarks,
  } = req.body || {};

  if (!amount || !destinationBankCode || !destinationAccountNumber || !destinationAccountName || !destinationBankName || !remarks) {
    return res.status(400).json({
      error: 'Missing required fields: amount, destinationBankCode, destinationAccountNumber, destinationAccountName, destinationBankName, remarks',
    });
  }
  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }

  // Read customerId from Firestore config
  let customerId;
  try {
    const configSnap = await db.collection('config').doc('fossapay').get();
    if (!configSnap.exists) {
      return res.status(500).json({ error: 'config/fossapay not found. Run setup first.' });
    }
    customerId = configSnap.data().customerId;
    if (!customerId) {
      return res.status(500).json({ error: 'customerId not found in config/fossapay.' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read Firestore config', message: err.message });
  }

  // Generate a unique reference for this transfer
  const reference = `FYB-${Date.now()}-${randomUUID().split('-')[0].toUpperCase()}`;

  // Initiate inter-bank transfer via FossaPay
  let transferResult;
  try {
    const transferRes = await fetch(
      'https://api-production.fossapay.com/api/v1/transfers/fiat/inter-bank',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    process.env.FOSSAPAY_SECRET_KEY,
        },
        body: JSON.stringify({
          customerId,
          destinationBankCode,
          destinationAccountName,
          destinationAccountNumber,
          destinationBankName,
          reference,
          remarks,
          amount,
        }),
      }
    );

    const rawTransfer = await transferRes.text();
    console.log('[admin-withdraw] Transfer raw response:', rawTransfer);

    try {
      transferResult = JSON.parse(rawTransfer);
    } catch {
      transferResult = { raw: rawTransfer };
    }

    if (!transferRes.ok) {
      return res.status(500).json({
        error:   'FossaPay transfer failed',
        details: transferResult,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Transfer request threw an exception', message: err.message });
  }

  // Persist the withdrawal so the dashboard can compute an accurate net balance
  // without relying on FossaPay transaction-type parsing (which is unreliable).
  // Also increment the summary/fossapay ledger in the same batch so the two
  // stay consistent with each other (though not with the external transfer,
  // which has already completed by this point).
  try {
    const fossaTransactionId =
      transferResult?.data?.transactionId ||
      transferResult?.data?.transaction_id ||
      transferResult?.transactionId ||
      null;

    const batch = db.batch();
    batch.set(db.collection('withdrawals').doc(reference), {
      reference,
      amount,
      destinationBankCode,
      destinationAccountNumber,
      destinationAccountName,
      destinationBankName,
      remarks,
      fossaTransactionId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('summary').doc('fossapay'), {
      totalWithdrawals: admin.firestore.FieldValue.increment(amount),
      withdrawalCount:  admin.firestore.FieldValue.increment(1),
      updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await batch.commit();
  } catch (logErr) {
    // Log the error but do not fail the response — the transfer already succeeded
    console.error('[admin-withdraw] Failed to log withdrawal to Firestore:', logErr);
  }

  return res.status(200).json({ success: true, reference, result: transferResult });
};
