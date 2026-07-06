// api/initiate-payment.js
// Reads the pre-stored organizer FossaPay account from Firestore (config/fossapay),
// saves the student's pending payment record, and returns the shared bank account details.
// Does NOT call the FossaPay API — that only happens once via /api/setup-account.
//
// Required environment variables:
// FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY

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

const db = admin.firestore();

const ALLOWED_ORIGINS = [
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.FRONTEND_ORIGIN || null,
  'http://localhost:3000',
].filter(Boolean);

// ── Server-side price catalog ─────────────────────────────────────────────
// The single source of truth for what each item costs. The ITEMS table in
// index.html is display-only; client-sent item prices and totals are NEVER
// trusted — the subtotal is recomputed here and the request is rejected if
// the client's amount doesn't match.
const ITEM_NAMES = {
  jacket:  'Jacket',
  senator: 'Senator Fabric',
  ankara:  'Ankara Fabric',
  sash:    'Sash',
  custom:  'Customizations',
  boxing:  'Boxing',
};
const FIXED_PRICES = {
  male:   { jacket: 12000, sash: 4500, custom: 7000, boxing: 8000 },
  female: { jacket: 12000, sash: 4500, custom: 7000, boxing: 8000 },
};
const VARIABLE_ITEMS = { male: ['senator'], female: ['ankara'] };
const SENATOR_PRICE_PER_YARD = 5500;
const SENATOR_MIN_YARDS = 1;
const SENATOR_MAX_YARDS = 10;
const ANKARA_PRICES = { '3yds': 3000, '6yds': 6000 };
const JACKET_SIZES  = ['M', 'L', 'XL', 'XXL', 'XXXL'];

// Returns the server-side price for one item id, or null if the id is not
// purchasable for this gender / the variable-item options are invalid.
function priceForItem(id, gender, senatorYards, ankaraOption) {
  if (id === 'senator') {
    if (!VARIABLE_ITEMS[gender].includes('senator')) return null;
    if (!Number.isInteger(senatorYards) ||
        senatorYards < SENATOR_MIN_YARDS || senatorYards > SENATOR_MAX_YARDS) return null;
    return senatorYards * SENATOR_PRICE_PER_YARD;
  }
  if (id === 'ankara') {
    if (!VARIABLE_ITEMS[gender].includes('ankara')) return null;
    return ANKARA_PRICES[ankaraOption] ?? null;
  }
  const price = FIXED_PRICES[gender][id];
  return typeof price === 'number' ? price : null;
}

// Display label mirroring getItemDisplayLabel in index.html, rebuilt from
// server-validated values so no client string is ever stored or rendered.
function labelForItem(id, senatorYards, ankaraOption, jacketSize) {
  if (id === 'senator') return `Senator Fabric (${senatorYards} yds)`;
  if (id === 'ankara')  return `Ankara Fabric (${ankaraOption === '3yds' ? 3 : 6} yds)`;
  if (id === 'jacket' && jacketSize) return `Jacket (${jacketSize})`;
  return ITEM_NAMES[id];
}

// Fee calculation — must stay identical to the calculateFee function in index.html
// Fee is always based on the subtotal (before fee), never the grand total.
function calculateFee(subtotal) {
  if (subtotal < 5000)  return 60;
  if (subtotal < 10000) return 120;
  if (subtotal < 15000) return 200;
  if (subtotal < 25000) return 250;
  // Correct formula: fee must cover FossaPay's 1.2% charge on the GROSS amount.
  // gross = subtotal + fee, net = gross * 0.988. For net >= subtotal:
  // fee = Math.ceil(subtotal / 0.988) - subtotal
  return Math.min(Math.ceil(subtotal / 0.988) - subtotal, 1000);
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const { idToken, name, matric, email, phone, gender, items, amount,
          jacketSize, senatorYards, ankaraOption } = req.body || {};

  // Input validation

  if (!idToken || !name || !matric || !email || !phone || !gender || !items || amount == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (typeof idToken !== 'string' || idToken.length === 0) {
    return res.status(400).json({ error: 'Invalid ID token' });
  }
  if (typeof name !== 'string' || name.trim().length < 2 || name.length > 100) {
    return res.status(400).json({ error: 'Name must be 2–100 characters' });
  }
  if (typeof matric !== 'string' || matric.trim().length < 5 || matric.length > 30) {
    return res.status(400).json({ error: 'Invalid matric number' });
  }
  if (typeof email !== 'string' || email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (typeof phone !== 'string' || !/^(\+?234|0)[789]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: 'Invalid Nigerian phone number' });
  }
  if (gender !== 'male' && gender !== 'female') {
    return res.status(400).json({ error: 'Invalid gender' });
  }
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive integer in naira' });
  }

  // Item validation + authoritative server-side pricing

  if (!Array.isArray(items) || items.length === 0 || items.length > 10) {
    return res.status(400).json({ error: 'Items must be a non-empty array' });
  }
  const itemIds = items.map(i => (i && typeof i === 'object') ? i.id : i);
  if (itemIds.some(id => typeof id !== 'string') ||
      new Set(itemIds).size !== itemIds.length) {
    return res.status(400).json({ error: 'Invalid or duplicate item ids' });
  }

  const validJacketSize = itemIds.includes('jacket') ? jacketSize : null;
  if (itemIds.includes('jacket') && !JACKET_SIZES.includes(validJacketSize)) {
    return res.status(400).json({ error: 'Please select a valid jacket size' });
  }

  let serverSubtotal = 0;
  const serverItems  = [];
  for (const id of itemIds) {
    const price = priceForItem(id, gender, senatorYards, ankaraOption);
    if (price == null) {
      return res.status(400).json({ error: `Item "${id}" is not available for this selection` });
    }
    serverSubtotal += price;
    serverItems.push({
      id,
      name:  labelForItem(id, senatorYards, ankaraOption, validJacketSize),
      price,
    });
  }

  // The client-displayed total must equal the server-computed one; a mismatch
  // means a stale price table or a tampered request — reject either way.
  if (serverSubtotal !== amount) {
    return res.status(400).json({
      error: 'Amount does not match current item prices. Please refresh the page and try again.',
    });
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

  const subtotal      = serverSubtotal;
  const fee           = calculateFee(subtotal);
  const totalWithFee  = subtotal + fee;

  try {
    await db.collection('pendingPayments').doc(uid).set({
      uid,
      name:   name.trim(),
      matric: matric.trim(),
      email,
      phone,
      gender,
      items:          serverItems,
      jacketSize:     validJacketSize,
      subtotal,
      fee,
      displayAmount:  totalWithFee,
      // FossaPay credits the NET amount after deducting its own settlement fee,
      // and the webhook reports that net-credited figure as data.amount. The
      // calculateFee markup is sized so that net == subtotal: the student
      // transfers totalWithFee (subtotal + fee), FossaPay takes ~fee, and the
      // organizer wallet is credited the subtotal. Live logs confirm this — the
      // ₦4500 Sash (totalWithFee 4560) produces data.amount = "4500.00".
      // So the webhook must match on the subtotal, NOT totalWithFee. (For the
      // top 1.2% tier the net can round to subtotal + 1; the webhook absorbs
      // that with a ±1 tolerance.)
      expectedAmount: subtotal,
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
    subtotal,
    fee,
    totalWithFee,
  });
};
