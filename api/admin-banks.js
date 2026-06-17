// api/admin-banks.js
// Returns the list of banks supported by FossaPay for inter-bank transfers.
// Protected by Firebase ID token + ADMIN_EMAIL check.

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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

  try {
    const banksRes = await fetch(
      'https://api-production.fossapay.com/api/v1/transfers/fiat/banks',
      { headers: { 'x-api-key': process.env.FOSSAPAY_SECRET_KEY } }
    );
    const raw = await banksRes.text();
    console.log('[admin-banks] Raw response (first 300):', raw.slice(0, 300));

    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    if (!banksRes.ok) {
      return res.status(502).json({ error: 'FossaPay banks fetch failed', details: data });
    }

    return res.status(200).json({ success: true, banks: data.data || [] });
  } catch (err) {
    return res.status(500).json({ error: 'Banks request threw an exception', message: err.message });
  }
};
