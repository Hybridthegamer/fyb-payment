// scripts/query-pending-payments.js
// Fetches pendingPayments records grouped by status and prints them to stdout.
//
// Usage:
//   FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
//     node scripts/query-pending-payments.js [--status=pending|completed] [--json]
//
// With no --status flag, returns every status, grouped.

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

const args = process.argv.slice(2);
const statusFlag = args.find(a => a.startsWith('--status='));
const statusFilter = statusFlag ? statusFlag.split('=')[1] : null;
const asJson = args.includes('--json');

async function main() {
  let query = db.collection('pendingPayments');
  if (statusFilter) {
    query = query.where('status', '==', statusFilter);
  }

  const snap = await query.get();
  const records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  if (asJson) {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  const grouped = records.reduce((acc, rec) => {
    const key = rec.status || 'unknown';
    (acc[key] = acc[key] || []).push(rec);
    return acc;
  }, {});

  for (const [status, items] of Object.entries(grouped)) {
    console.log(`\n=== ${status} (${items.length}) ===`);
    console.table(items.map(i => ({
      id:             i.id,
      name:           i.name,
      matric:         i.matric,
      expectedAmount: i.expectedAmount,
      displayAmount:  i.displayAmount,
      createdAt:      i.createdAt?.toDate ? i.createdAt.toDate().toISOString() : i.createdAt,
      transactionRef: i.transactionRef,
    })));
  }

  console.log(`\nTotal: ${records.length} record(s)`);
}

main().catch(err => {
  console.error('Query failed:', err);
  process.exit(1);
});
