// scripts/reconcile-pending.js
// Reconciles deposits that reached the FossaPay wallet but whose
// pendingPayments record was never marked 'completed' — the student paid,
// the money is in the wallet, but payments/{uid} was never credited and the
// ledger understates (or mis-buckets) the balance.
//
// Two sources of un-reconciled money are considered:
//
//   1. unmatchedDeposits — the webhook received the event but found no
//      pending record to attribute it to (e.g. the record was outside the
//      match window, or amount reporting flip-flopped before both match
//      keys existed). The money is already counted in the reconciled
//      balance, but under "unmatched" instead of against the student.
//
//   2. FossaPay transaction history — deposits FossaPay executed that have
//      NO processedEvents doc at all: the webhook delivery failed or the
//      handler errored before the fix, so the deposit is missing from the
//      ledger entirely. This is the actual balance shortage. Requires
//      FOSSAPAY_SECRET_KEY; skipped (with a warning) if it isn't set.
//
// For every deposit↔pending match it applies the SAME writes the webhook
// would have made, inside one Firestore transaction per match:
//   - payments/{uid}: increment totalPaid, arrayUnion the transaction,
//     paidItems, profile fields
//   - pendingPayments/{uid}: status → 'completed', transactionRef
//   - processedEvents/{txnId}: matched:true + reconciledAt marker
//   - summary/fossapay: move the amount into totalDeposits (and out of
//     unmatchedDeposits when that's where it was sitting)
//   - unmatchedDeposits/{txnId}: deleted once attributed (its content is
//     preserved on the processedEvents doc), so backfill-summary stays
//     consistent if re-run
//
// Matching is deliberately conservative: a deposit is auto-matched only if
// exactly ONE stuck pending record matches its amount (±1 against both
// expectedAmount and expectedGross, with subtotal/displayAmount fallbacks
// for legacy docs) and no other candidate deposit competes for that same
// record. Anything ambiguous is listed for manual pairing.
//
// Usage (dry run by default — prints the report, writes NOTHING):
//   FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
//   FOSSAPAY_SECRET_KEY=... node scripts/reconcile-pending.js
//
//   --apply                 execute the proposed (confident + manual) matches
//   --match TXNID=UID       manually pair a deposit with a pending record;
//                           repeatable; resolves ambiguous cases
//
// After applying, re-run scripts/backfill-summary.js as a cross-check — it
// recomputes summary/fossapay from scratch and should land on the same totals.

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

// ── CLI args ────────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const manualPairs = new Map(); // txnId -> uid
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--match') {
    const pair = process.argv[++i] || '';
    const eq = pair.indexOf('=');
    if (eq <= 0) {
      console.error(`Invalid --match "${pair}" — expected TXNID=UID`);
      process.exit(1);
    }
    manualPairs.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
}

/**
 * Whether a deposit amount fits a pending record, using the same tolerance
 * the webhook uses: exact match, then ±1 for top-tier fee rounding, against
 * both stored match keys (with subtotal/displayAmount fallbacks for legacy docs).
 * @param {object} pending  pendingPayments doc data
 * @param {number} amount   deposit amount reported by FossaPay
 * @returns {boolean}
 */
function amountMatchesPending(pending, amount) {
  const rounded = Math.round(amount);
  const keys = [
    pending.expectedAmount ?? pending.subtotal,
    pending.expectedGross  ?? pending.displayAmount,
  ].filter(v => typeof v === 'number');
  return keys.some(k => Math.abs(k - rounded) <= 1);
}

/**
 * Digs the transaction array out of a FossaPay API response and normalizes
 * the fields this script needs. FossaPay response shapes have varied, so
 * every envelope observed in production logs is tried in turn.
 * @param {*} payload  parsed JSON body from the transactions endpoint
 * @returns {Array<{transactionId: string|null, amount: number, type: string, status: string, date: *, raw: object}>}
 */
function extractFossaTransactions(payload) {
  const arr =
    (Array.isArray(payload) && payload) ||
    (Array.isArray(payload?.data) && payload.data) ||
    (Array.isArray(payload?.data?.transactions) && payload.data.transactions) ||
    (Array.isArray(payload?.transactions) && payload.transactions) ||
    (Array.isArray(payload?.data?.items) && payload.data.items) ||
    [];
  return arr.map(t => ({
    transactionId: t.transactionId || t.transaction_id || t.id || t.reference || null,
    amount:        parseFloat(t.amount ?? t.value ?? NaN),
    type:          String(t.type || t.transactionType || t.direction || '').toLowerCase(),
    status:        String(t.status || '').toLowerCase(),
    date:          t.createdAt || t.created_at || t.date || t.completedAt || null,
    raw:           t,
  }));
}

/**
 * Whether a normalized FossaPay transaction looks like a settled inbound
 * credit — excludes obvious withdrawals/transfers-out and failed rows.
 * @param {{type: string, status: string, amount: number}} t
 * @returns {boolean}
 */
function isCreditDeposit(t) {
  if (/withdraw|transfer_out|debit|payout/.test(t.type)) return false;
  if (t.status && /fail|revers|cancel|pending/.test(t.status)) return false;
  return Number.isFinite(t.amount) && t.amount > 0;
}

/**
 * Formats a Firestore Timestamp, ISO string, or missing value for report output.
 * @param {*} v
 * @returns {string}
 */
function fmtDate(v) {
  if (!v) return '—';
  if (v.toDate) return v.toDate().toISOString();
  return String(v);
}

/**
 * Fetches the FossaPay wallet transaction history and returns candidate
 * deposits the webhook never processed (no processedEvents doc). Returns an
 * empty list, with a warning, when FOSSAPAY_SECRET_KEY isn't configured.
 * @param {Set<string>} processedIds  transaction ids already in processedEvents
 * @returns {Promise<Array<{source: 'fossapay', transactionId: string, amount: number, date: *, eventId: null, reference: string|null}>>}
 */
async function loadFossaDeposits(processedIds) {
  if (!process.env.FOSSAPAY_SECRET_KEY) {
    console.warn('\n⚠ FOSSAPAY_SECRET_KEY not set — skipping the FossaPay history check.');
    console.warn('  Only unmatchedDeposits will be reconciled; deposits whose webhook');
    console.warn('  delivery failed entirely will NOT be found. Set the key to cover those.\n');
    return [];
  }
  const configSnap = await db.collection('config').doc('fossapay').get();
  if (!configSnap.exists) throw new Error('config/fossapay not found');
  const { walletId } = configSnap.data();
  if (typeof walletId !== 'string' || walletId.length === 0) {
    throw new Error('config/fossapay has no walletId — cannot query FossaPay history');
  }

  const res = await fetch(
    `https://api-production.fossapay.com/api/v1/wallets/fiat/${walletId}/transactions`,
    { headers: { 'x-api-key': process.env.FOSSAPAY_SECRET_KEY } }
  );
  const rawText = await res.text();
  // Fail closed: a non-2xx JSON error body would otherwise parse fine, yield
  // zero transactions, and silently hide every missed deposit.
  if (!res.ok) {
    throw new Error(`FossaPay transactions endpoint HTTP ${res.status}: ${rawText.slice(0, 300)}`);
  }
  let payload;
  try { payload = JSON.parse(rawText); } catch {
    throw new Error(`FossaPay transactions endpoint returned non-JSON (HTTP ${res.status}): ${rawText.slice(0, 300)}`);
  }
  const all = extractFossaTransactions(payload);
  console.log(`FossaPay history: ${all.length} transactions fetched.`);
  if (all.length === 0) {
    console.warn('  (If the wallet is not empty, the response shape may be new — raw first 300 chars:)');
    console.warn(' ', rawText.slice(0, 300));
  }

  return all
    .filter(isCreditDeposit)
    .filter(t => t.transactionId && !processedIds.has(t.transactionId))
    .map(t => ({
      source:        'fossapay',
      transactionId: t.transactionId,
      amount:        t.amount,
      date:          t.date,
      eventId:       null,
      reference:     typeof t.raw.reference === 'string' ? t.raw.reference : null,
    }));
}

/**
 * Applies one deposit↔pending match inside a single Firestore transaction,
 * replaying the exact writes the webhook would have made: credit
 * payments/{uid}, complete the pending doc, record processedEvents, and move
 * the amount into summary totalDeposits (out of unmatchedDeposits when that's
 * where it was counted). Re-validates every precondition inside the
 * transaction so a concurrent webhook delivery or double-run can't double-credit.
 * @param {{source: 'unmatched'|'fossapay', transactionId: string, amount: number, eventId: *}} deposit
 * @param {FirebaseFirestore.DocumentReference} pendingSnapRef  ref of the pendingPayments doc to complete
 * @returns {Promise<void>}
 */
async function applyMatch(deposit, pendingSnapRef) {
  const summaryRef         = db.collection('summary').doc('fossapay');
  const processedEventsRef = db.collection('processedEvents').doc(deposit.transactionId);
  const unmatchedRef       = db.collection('unmatchedDeposits').doc(deposit.transactionId);

  await db.runTransaction(async (t) => {
    const pendingSnap = await t.get(pendingSnapRef);
    if (!pendingSnap.exists) throw new Error(`pendingPayments/${pendingSnapRef.id} disappeared`);
    const pendingDoc = pendingSnap.data();
    if (pendingDoc.status !== 'pending') {
      throw new Error(`pendingPayments/${pendingSnapRef.id} is no longer pending (status=${pendingDoc.status})`);
    }

    const processedSnap = await t.get(processedEventsRef);
    if (deposit.source === 'fossapay' && processedSnap.exists) {
      throw new Error(`processedEvents/${deposit.transactionId} already exists — webhook got there first`);
    }
    if (deposit.source === 'unmatched') {
      const unmatchedSnap = await t.get(unmatchedRef);
      if (!unmatchedSnap.exists) {
        throw new Error(`unmatchedDeposits/${deposit.transactionId} disappeared — already reconciled?`);
      }
    }

    const uid = pendingDoc.uid ?? pendingSnap.id;
    const amount = deposit.amount;

    const paidItemIds = (Array.isArray(pendingDoc.items) ? pendingDoc.items : [])
      .map(i => i && i.id)
      .filter(id => typeof id === 'string' && id.length > 0);

    const txn = {
      ref:      deposit.transactionId,
      items:    Array.isArray(pendingDoc.items) ? pendingDoc.items : [],
      amount,
      subtotal: pendingDoc.subtotal ?? amount,
      fee:      pendingDoc.fee      ?? 0,
      date:     new Date().toISOString(),
      provider: 'fossapay',
      reconciled: true,
    };

    const paymentUpdate = {
      totalPaid:    admin.firestore.FieldValue.increment(amount),
      transactions: admin.firestore.FieldValue.arrayUnion(txn),
      paidAt:       admin.firestore.FieldValue.serverTimestamp(),
    };
    // Merge write: only copy profile fields that are actually present, so a
    // legacy pending doc with gaps can't null out data already on payments/{uid}.
    for (const field of ['name', 'matric', 'email', 'phone', 'gender']) {
      if (pendingDoc[field] != null) paymentUpdate[field] = pendingDoc[field];
    }
    if (paidItemIds.length > 0) {
      paymentUpdate.paidItems = admin.firestore.FieldValue.arrayUnion(...paidItemIds);
    }
    if (pendingDoc.jacketSize != null) {
      paymentUpdate.jacketSize = pendingDoc.jacketSize;
    }

    t.set(processedEventsRef, {
      eventId:      deposit.eventId ?? null,
      matched:      true,
      uid,
      // processedAt keeps these records shaped like webhook-written ones;
      // reconciledAt marks that this one came from the script.
      processedAt:  admin.firestore.FieldValue.serverTimestamp(),
      reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
      reconciledBy: 'reconcile-pending-script',
      reconciledFrom: deposit.source, // 'unmatched' | 'fossapay'
    }, { merge: true });

    t.set(db.collection('payments').doc(uid), paymentUpdate, { merge: true });

    const summaryUpdate = {
      totalDeposits: admin.firestore.FieldValue.increment(amount),
      depositCount:  admin.firestore.FieldValue.increment(1),
      updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
    };
    if (deposit.source === 'unmatched') {
      // The money was already counted under "unmatched" — move it, don't add it.
      summaryUpdate.unmatchedDeposits = admin.firestore.FieldValue.increment(-amount);
      summaryUpdate.unmatchedCount    = admin.firestore.FieldValue.increment(-1);
      t.delete(unmatchedRef);
    }
    t.set(summaryRef, summaryUpdate, { merge: true });

    t.update(pendingSnap.ref, {
      status:         'completed',
      completedAt:    admin.firestore.FieldValue.serverTimestamp(),
      transactionRef: deposit.transactionId,
      reconciled:     true,
    });
  });
}

/**
 * Entry point: loads stuck pendings and candidate deposits, computes
 * manual + auto matches, prints the reconciliation report, and (only with
 * --apply) executes the proposed matches.
 * @returns {Promise<void>}
 */
async function main() {
  console.log(APPLY ? '=== RECONCILE — APPLY MODE ===' : '=== RECONCILE — DRY RUN (no writes) ===');

  // 1. Everything the webhook has ever processed (matched or not)
  const processedSnap = await db.collection('processedEvents').get();
  const processedIds = new Set(processedSnap.docs.map(d => d.id));
  console.log(`processedEvents: ${processedIds.size} transaction ids recorded.`);

  // 2. Stuck pending records
  const pendingSnap = await db.collection('pendingPayments')
    .where('status', '==', 'pending').get();
  const stuckPendings = pendingSnap.docs;
  console.log(`pendingPayments still 'pending': ${stuckPendings.length}`);
  for (const doc of stuckPendings) {
    const p = doc.data();
    console.log(`  - ${doc.id}  ${p.name ?? '?'}  net=${p.expectedAmount ?? p.subtotal} gross=${p.expectedGross ?? p.displayAmount}  created=${fmtDate(p.createdAt)}`);
  }

  // 3. Candidate deposits: unmatchedDeposits + never-processed FossaPay history
  const unmatchedSnap = await db.collection('unmatchedDeposits').get();
  const unmatched = unmatchedSnap.docs.flatMap(d => {
    const u = d.data();
    const amount = Number(u.amount);
    // A malformed amount must not enter the matching pool as ₦0 — surface it
    // for manual inspection instead.
    if (!Number.isFinite(amount) || amount <= 0) {
      console.warn(`  ⚠ skipping unmatchedDeposits/${d.id}: invalid amount=${u.amount}`);
      return [];
    }
    return [{
      source:        'unmatched',
      transactionId: d.id,
      amount,
      date:          u.receivedAt ?? null,
      eventId:       u.eventId ?? null,
      reference:     u.reference ?? null,
    }];
  });
  const missed = await loadFossaDeposits(processedIds);

  const deposits = [...unmatched, ...missed];
  console.log(`\nCandidate deposits: ${unmatched.length} unmatched (webhook saw them), ${missed.length} missing from processedEvents (webhook never processed them).`);
  for (const d of deposits) {
    console.log(`  - [${d.source}] ${d.transactionId}  ₦${d.amount}  ${fmtDate(d.date)}${d.reference ? '  ref=' + d.reference : ''}`);
  }

  if (deposits.length === 0) {
    console.log('\nNothing to reconcile from the deposit side. Done.');
    return;
  }

  // 4. Build matches: manual pairs first, then unique amount matches.
  const pendingById = new Map(stuckPendings.map(d => [d.id, d]));
  const claimedPendings = new Set();
  const matches = [];   // { deposit, pendingSnap, how }
  const ambiguous = []; // { deposit, candidates: [ids] }
  const unmatchable = [];

  for (const [txnId, uid] of manualPairs) {
    const deposit = deposits.find(d => d.transactionId === txnId);
    if (!deposit) throw new Error(`--match ${txnId}: not among the candidate deposits above`);
    const pending = pendingById.get(uid);
    if (!pending) throw new Error(`--match ${txnId}=${uid}: no stuck pending record with that id`);
    if (claimedPendings.has(uid)) throw new Error(`--match: pending ${uid} paired twice`);
    if (!amountMatchesPending(pending.data(), deposit.amount)) {
      console.warn(`  ⚠ --match ${txnId}=${uid}: amounts do NOT line up (deposit ₦${deposit.amount}). Pairing anyway since it was explicit.`);
    }
    claimedPendings.add(uid);
    matches.push({ deposit, pendingSnap: pending, how: 'manual' });
  }

  const remainingDeposits = deposits.filter(d => !matches.some(m => m.deposit === d));
  for (const deposit of remainingDeposits) {
    const candidates = stuckPendings.filter(p =>
      !claimedPendings.has(p.id) && amountMatchesPending(p.data(), deposit.amount));
    if (candidates.length === 1) {
      // Also require no OTHER remaining deposit of a matching amount competes
      // for this same pending record — otherwise which deposit belongs to whom
      // is guesswork and both go to the ambiguous list.
      const rivals = remainingDeposits.filter(d =>
        d !== deposit && amountMatchesPending(candidates[0].data(), d.amount));
      if (rivals.length === 0) {
        claimedPendings.add(candidates[0].id);
        matches.push({ deposit, pendingSnap: candidates[0], how: 'auto (unique amount)' });
        continue;
      }
      ambiguous.push({ deposit, candidates: candidates.map(c => c.id) });
    } else if (candidates.length > 1) {
      ambiguous.push({ deposit, candidates: candidates.map(c => c.id) });
    } else {
      unmatchable.push(deposit);
    }
  }

  console.log(`\nProposed matches: ${matches.length}`);
  for (const m of matches) {
    const p = m.pendingSnap.data();
    console.log(`  ✓ ${m.deposit.transactionId} (₦${m.deposit.amount}, ${m.deposit.source}) → ${m.pendingSnap.id} ${p.name ?? ''} [${m.how}]`);
  }
  if (ambiguous.length > 0) {
    console.log(`\nAmbiguous — need --match TXNID=UID to resolve:`);
    for (const a of ambiguous) {
      console.log(`  ? ${a.deposit.transactionId} (₦${a.deposit.amount}, ${a.deposit.source}) could be any of: ${a.candidates.join(', ')}`);
    }
  }
  if (unmatchable.length > 0) {
    console.log(`\nNo stuck pending record matches these deposits (left as-is):`);
    for (const d of unmatchable) {
      console.log(`  ✗ ${d.transactionId} ₦${d.amount} (${d.source})`);
    }
  }

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to execute the proposed matches.');
    return;
  }

  console.log('\nApplying...');
  let ok = 0, failed = 0;
  for (const m of matches) {
    try {
      await applyMatch(m.deposit, m.pendingSnap.ref);
      ok++;
      console.log(`  ✓ applied ${m.deposit.transactionId} → ${m.pendingSnap.id}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ FAILED ${m.deposit.transactionId} → ${m.pendingSnap.id}: ${err.message}`);
    }
  }
  console.log(`\nDone: ${ok} reconciled, ${failed} failed, ${ambiguous.length} still ambiguous.`);
  console.log('Cross-check totals with: node scripts/backfill-summary.js');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Reconcile failed:', err);
  process.exit(1);
});
