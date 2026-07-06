// api/admin-bank-enquiry.js
// Performs a bank account name enquiry via FossaPay.
// Protected by Firebase ID token + ADMIN_EMAIL check.
// Body: { bankCode, accountNumber }

const admin = require('firebase-admin');

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

module.exports = async function handler(req, res) {
  // No CORS headers on purpose: the admin dashboard is served from the same
  // origin, and a wildcard here would let any website replay a captured token.
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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

  if (!process.env.ADMIN_EMAIL || decoded.email !== process.env.ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Access denied. You are not the admin.' });
  }

  const { bankCode, accountNumber } = req.body || {};

  if (!bankCode || !accountNumber) {
    return res.status(400).json({ error: 'Missing required fields: bankCode, accountNumber' });
  }

  try {
    const enquiryRes = await fetch(
      'https://api-production.fossapay.com/api/v1/transfers/fiat/bank-name-enquiry',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key':    process.env.FOSSAPAY_SECRET_KEY,
        },
        body: JSON.stringify({ bankCode, accountNumber }),
      }
    );
    const raw = await enquiryRes.text();
    console.log('[admin-bank-enquiry] Raw response:', raw);

    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!enquiryRes.ok) {
      return res.status(502).json({ error: 'FossaPay enquiry failed', details: data });
    }

    return res.status(200).json({ success: true, data: data.data || data });
  } catch (err) {
    return res.status(500).json({ error: 'Enquiry request threw an exception', message: err.message });
  }
};
