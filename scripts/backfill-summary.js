// scripts/backfill-summary.js
// One-time migration: initializes summary/fossapay from existing payments,
// withdrawals, and unmatchedDeposits collections, so historical totals aren't
// zeroed out once the webhook and admin-withdraw start incrementing that doc
// going forward.
//
// Deposits are split by provider: transactions whose ref is in PAYSTACK_REFS
// (legacy Paystack payments that never touched the FossaPay wallet) are
// counted into paystackDeposits, NOT totalDeposits, so the FossaPay balance
// (totalDeposits + unmatchedDeposits - totalWithdrawals) matches the real wallet.
//
// Run once, locally, after deploying the summary-ledger changes:
//   FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
//     node scripts/backfill-summary.js
//
// Safe to re-run: it overwrites summary/fossapay with a freshly computed total
// rather than incrementing, so re-running never double-counts.

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

// Must stay identical to the PAYSTACK_REFS set in admin.html.
const PAYSTACK_REFS = new Set([
  'FYB-1778658974160',
  'FYB-1778932855019',
  'FYB-1779384466818',
  'FYB-1780468178177',
  'FYB-1780567455524',
  'FYB-1780837203280',
]);

async function main() {
  const paymentsSnap = await db.collection('payments').get();
  let totalDeposits = 0;
  let depositCount = 0;
  let paystackDeposits = 0;
  let paystackCount = 0;
  paymentsSnap.forEach(doc => {
    const data = doc.data();
    (data.transactions || []).forEach(t => {
      const amt = Number(t.amount) || 0;
      if (PAYSTACK_REFS.has(t.ref)) {
        paystackDeposits += amt;
        paystackCount += 1;
      } else {
        totalDeposits += amt;
        depositCount += 1;
      }
    });
  });

  const withdrawalsSnap = await db.collection('withdrawals').get();
  let totalWithdrawals = 0;
  let withdrawalCount = 0;
  withdrawalsSnap.forEach(doc => {
    totalWithdrawals += Number(doc.data().amount || 0);
    withdrawalCount += 1;
  });

  const unmatchedSnap = await db.collection('unmatchedDeposits').get();
  let unmatchedDeposits = 0;
  let unmatchedCount = 0;
  unmatchedSnap.forEach(doc => {
    unmatchedDeposits += Number(doc.data().amount || 0);
    unmatchedCount += 1;
  });

  await db.collection('summary').doc('fossapay').set({
    totalDeposits,
    depositCount,
    paystackDeposits,
    paystackCount,
    totalWithdrawals,
    withdrawalCount,
    unmatchedDeposits,
    unmatchedCount,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log('summary/fossapay backfilled:', {
    totalDeposits, depositCount,
    paystackDeposits, paystackCount,
    totalWithdrawals, withdrawalCount,
    unmatchedDeposits, unmatchedCount,
    fossapayBalance: totalDeposits + unmatchedDeposits - totalWithdrawals,
  });
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
