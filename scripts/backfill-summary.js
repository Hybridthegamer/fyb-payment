// scripts/backfill-summary.js
// One-time migration: initializes summary/fossapay from existing payments and
// withdrawals collections, so historical totals aren't zeroed out once the
// webhook and admin-withdraw start incrementing that doc going forward.
//
// Run once, locally, after deploying the summary-ledger changes:
//   FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
//     node scripts/backfill-summary.js
//
// Safe to re-run: it overwrites summary/fossapay with a freshly computed total
// rather than incrementing, so re-running never double-counts.

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

async function main() {
  const paymentsSnap = await db.collection('payments').get();
  let totalDeposits = 0;
  let depositCount = 0;
  paymentsSnap.forEach(doc => {
    const data = doc.data();
    totalDeposits += Number(data.totalPaid || 0);
    depositCount += (data.transactions || []).length;
  });

  const withdrawalsSnap = await db.collection('withdrawals').get();
  let totalWithdrawals = 0;
  let withdrawalCount = 0;
  withdrawalsSnap.forEach(doc => {
    totalWithdrawals += Number(doc.data().amount || 0);
    withdrawalCount += 1;
  });

  await db.collection('summary').doc('fossapay').set({
    totalDeposits,
    depositCount,
    totalWithdrawals,
    withdrawalCount,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log('summary/fossapay backfilled:', {
    totalDeposits, depositCount, totalWithdrawals, withdrawalCount,
    balance: totalDeposits - totalWithdrawals,
  });
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
