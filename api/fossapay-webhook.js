// Required environment variables:
// FOSSAPAY_WEBHOOK_SECRET   — Webhook signing secret from FossaPay dashboard
// FIREBASE_PROJECT_ID       — Firebase project ID
// FIREBASE_CLIENT_EMAIL     — Firebase service account email
// FIREBASE_PRIVATE_KEY      — Firebase private key (with \n as literal backslash-n in Vercel dashboard)
// GOOGLE_SHEETS_WEBHOOK     — Google Apps Script web app URL

const crypto = require('crypto');
const admin  = require('firebase-admin');

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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Collect raw body as string for signature verification before any parsing
  let rawBody = '';
  await new Promise((resolve, reject) => {
    req.on('data', chunk => { rawBody += chunk.toString(); });
    req.on('end', resolve);
    req.on('error', reject);
  });

  // Parse body once — needed for sig verification and event processing
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (!payload || typeof payload !== 'object' || payload.data === undefined) {
    return res.status(400).json({ error: 'Missing data property' });
  }

  // A missing secret must fail closed — an empty-string HMAC key would let
  // anyone who knows the scheme forge valid signatures.
  const webhookSecret = process.env.FOSSAPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[Webhook] FOSSAPAY_WEBHOOK_SECRET is not set — rejecting all webhooks');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  // Verify HMAC-SHA256 signature — sign only the `data` property
  const receivedSig = req.headers['x-fossapay-signature'] || '';
  const data = payload.data;
  const dataString = JSON.stringify(data);
  const hash = crypto
    .createHmac('sha256', webhookSecret)
    .update(dataString)
    .digest('hex');
  // Guard against malformed/empty signatures: timingSafeEqual throws if the two
  // buffers differ in length, which would 500 instead of cleanly rejecting.
  const expectedBuf = Buffer.from(hash, 'hex');
  const receivedBuf = Buffer.from(receivedSig, 'hex');
  const match =
    expectedBuf.length === receivedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, receivedBuf);

  if (!match) {
    console.error('[Webhook] Signature mismatch — possible tampered or replayed request');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // FossaPay sends camelCase field names — eventType, eventId, not event, event_id
  const eventType = payload.eventType || payload.event;
  const eventId   = payload.eventId   || payload.event_id || null;

  // Only process deposit.completed — acknowledge everything else immediately
  if (eventType !== 'deposit.completed') {
    return res.status(200).json({ received: true });
  }

  const receivedAmount     = data?.amount;
  // FossaPay uses camelCase — try both forms
  const fossaTransactionId = data?.transactionId || data?.transaction_id;

  // Without a transaction id we can't dedupe or key the processed-events doc;
  // acknowledge so FossaPay stops retrying, but take no action.
  if (!fossaTransactionId || typeof fossaTransactionId !== 'string') {
    console.warn('[Webhook] Missing transactionId on deposit.completed. Event ID:', eventId);
    return res.status(200).json({ received: true });
  }

  const parsedAmount = parseFloat(receivedAmount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    console.warn(`[Webhook] Unparseable amount "${receivedAmount}" on ${fossaTransactionId}. Event ID: ${eventId}`);
    return res.status(200).json({ received: true });
  }

  // Round receivedAmount to the nearest integer before querying so a "4500.00"
  // string matches the integer match keys stored by initiate-payment.
  const queryAmount = Math.round(parsedAmount);

  // With the shared-account model all students pay to the same organizer account,
  // so the deposit amount is the ONLY signal linking a deposit to a student.
  // initiate-payment stores two match keys per pending record:
  //   expectedAmount — the subtotal (what FossaPay credits NET of its fee; the
  //                    fee markup is sized so net == subtotal, ±1 on the 1.2% tier)
  //   expectedGross  — subtotal + fee (what the student actually transfers, in
  //                    case FossaPay reports the gross figure instead)
  // Production logs have been read both ways at different times (see the
  // expectedAmount flip-flop commits), so match against BOTH keys — exact first,
  // then ±1 to absorb top-tier rounding. Whichever figure FossaPay reports, the
  // payer's own record matches.
  const matchKeys = [];
  for (const delta of [0, -1, 1]) {
    matchKeys.push({ field: 'expectedAmount', value: queryAmount + delta });
    matchKeys.push({ field: 'expectedGross',  value: queryAmount + delta });
  }

  // Only match records created recently. Without a time bound, any record that
  // never got matched (abandoned checkout, or an amount-reporting mismatch)
  // sits in the queue as 'pending' forever, and the old oldest-first matching
  // handed each new deposit to the OLDEST stale record of that amount — the
  // previous person got logged and the actual payer stalled, shifting the whole
  // queue by one on every payment. The window keeps stale records from ever
  // hijacking a new deposit; they simply age out.
  const MATCH_WINDOW_HOURS = parseFloat(process.env.PENDING_MATCH_WINDOW_HOURS) || 24;
  const windowStart = admin.firestore.Timestamp.fromMillis(
    Date.now() - MATCH_WINDOW_HOURS * 60 * 60 * 1000
  );

  const processedEventsRef = db.collection('processedEvents').doc(fossaTransactionId);
  const summaryRef         = db.collection('summary').doc('fossapay');
  const unmatchedRef       = db.collection('unmatchedDeposits').doc(fossaTransactionId);

  // Everything — idempotency check, pending-payment match, and all writes —
  // runs inside ONE Firestore transaction. This closes two races the old
  // query-then-batch flow had:
  //   1. Two deliveries of the same event both passing the processedEvents
  //      exists-check before either wrote it (double credit).
  //   2. Two DIFFERENT deposits of the same amount both matching the same
  //      pending doc before either marked it completed (one student credited
  //      twice, the other's money lost). The transaction retries on conflict
  //      and re-runs the query, so the loser picks the next pending record.
  let outcome;
  try {
    outcome = await db.runTransaction(async (t) => {
      const processedSnap = await t.get(processedEventsRef);
      if (processedSnap.exists) return { status: 'duplicate' };

      // Newest-first within the window: the payer almost always initiated
      // minutes before their transfer lands, so the most recent same-amount
      // record is the most likely owner — and an abandoned record from hours
      // ago can never shadow the student who is actually paying right now.
      let matchSnap = null;
      let skippedKeys = 0;
      for (const { field, value } of matchKeys) {
        const q = db.collection('pendingPayments')
          .where('status', '==', 'pending')
          .where(field, '==', value)
          .where('createdAt', '>=', windowStart)
          .orderBy('createdAt', 'desc')
          .limit(1);
        let snap;
        try {
          snap = await t.get(q);
        } catch (err) {
          // A missing composite index (FAILED_PRECONDITION) on one key must not
          // wedge every payment — log loudly and keep trying the other keys,
          // which use the long-deployed expectedAmount index.
          if (err.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(String(err.message))) {
            console.error(`[Webhook] Missing Firestore index for ${field} match — ` +
              'run `firebase deploy --only firestore:indexes`. Skipping this key.');
            skippedKeys++;
            continue;
          }
          throw err;
        }
        if (!snap.empty) { matchSnap = snap.docs[0]; break; }
      }

      if (!matchSnap && skippedKeys > 0) {
        // Some match keys couldn't even be queried. Don't record this deposit
        // as unmatched (that would mark the event processed forever) — fail so
        // FossaPay redelivers after the index is deployed.
        throw new Error('Match queries skipped due to missing index — retry after deploying indexes');
      }

      if (!matchSnap) {
        // No pending record matches this deposit — but the money IS in the
        // FossaPay wallet. Record it so the ledger (and the admin dashboard's
        // reconciled balance) still reflects reality, and mark the event
        // processed so a redelivery can't double-count it.
        t.set(processedEventsRef, {
          eventId,
          matched:     false,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        t.set(unmatchedRef, {
          transactionId: fossaTransactionId,
          eventId,
          amount:        parsedAmount,
          reference:     typeof data.reference === 'string' ? data.reference : null,
          receivedAt:    admin.firestore.FieldValue.serverTimestamp(),
        });
        t.set(summaryRef, {
          unmatchedDeposits: admin.firestore.FieldValue.increment(parsedAmount),
          unmatchedCount:    admin.firestore.FieldValue.increment(1),
          updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        return { status: 'unmatched' };
      }

      const pendingDoc = matchSnap.data();

      // Items were validated and priced server-side in initiate-payment, but
      // guard against malformed legacy docs so one bad record can't wedge the
      // webhook in a retry loop (arrayUnion throws on undefined/no args).
      const paidItemIds = (Array.isArray(pendingDoc.items) ? pendingDoc.items : [])
        .map(i => i && i.id)
        .filter(id => typeof id === 'string' && id.length > 0);

      const txn = {
        ref:      fossaTransactionId,
        items:    Array.isArray(pendingDoc.items) ? pendingDoc.items : [],
        amount:   parsedAmount,
        subtotal: pendingDoc.subtotal ?? parsedAmount,
        fee:      pendingDoc.fee      ?? 0,
        date:     new Date().toISOString(),
        provider: 'fossapay',
      };

      const paymentUpdate = {
        name:         pendingDoc.name   ?? null,
        matric:       pendingDoc.matric ?? null,
        email:        pendingDoc.email  ?? null,
        phone:        pendingDoc.phone  ?? null,
        gender:       pendingDoc.gender ?? null,
        totalPaid:    admin.firestore.FieldValue.increment(parsedAmount),
        transactions: admin.firestore.FieldValue.arrayUnion(txn),
        paidAt:       admin.firestore.FieldValue.serverTimestamp(),
      };
      if (paidItemIds.length > 0) {
        paymentUpdate.paidItems = admin.firestore.FieldValue.arrayUnion(...paidItemIds);
      }
      if (pendingDoc.jacketSize != null) {
        paymentUpdate.jacketSize = pendingDoc.jacketSize;
      }

      t.set(processedEventsRef, {
        eventId,
        matched:     true,
        uid:         pendingDoc.uid ?? matchSnap.id,
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      t.set(db.collection('payments').doc(pendingDoc.uid ?? matchSnap.id), paymentUpdate, { merge: true });
      t.set(summaryRef, {
        totalDeposits: admin.firestore.FieldValue.increment(parsedAmount),
        depositCount:  admin.firestore.FieldValue.increment(1),
        updatedAt:     admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      t.update(matchSnap.ref, {
        status:         'completed',
        completedAt:    admin.firestore.FieldValue.serverTimestamp(),
        // The client receipt screen reads transactionRef off this doc — persist it
        // here so the student sees their reference instead of a "—" placeholder.
        transactionRef: fossaTransactionId,
      });

      return { status: 'matched', pendingDoc };
    });
  } catch (err) {
    console.error('[Webhook] Transaction failed for event', eventId + ':', err);
    return res.status(500).json({ error: 'Internal error' });
  }

  if (outcome.status === 'duplicate') {
    console.log('[Webhook] Duplicate event, already processed:', fossaTransactionId);
    return res.status(200).json({ received: true, duplicate: true });
  }

  if (outcome.status === 'unmatched') {
    console.warn(
      `[Webhook] No pending payment found for amount ${receivedAmount} ` +
      `(tried expectedAmount/expectedGross == ${queryAmount}±1 within ` +
      `${MATCH_WINDOW_HOURS}h). Event ID: ${eventId}. ` +
      `Recorded in unmatchedDeposits/${fossaTransactionId}.`
    );
    return res.status(200).json({ received: true, unmatched: true });
  }

  const { pendingDoc } = outcome;

  try {
    const sheetsPayload = {
      timestamp: new Date().toISOString(),
      name: pendingDoc.name,
      matric: pendingDoc.matric,
      email: pendingDoc.email,
      phone: pendingDoc.phone,
      gender: pendingDoc.gender,
      items: (pendingDoc.items || []).map(i => i.name).join(', '),
      subtotal: pendingDoc.subtotal,
      fee: pendingDoc.fee,
      totalPaid: pendingDoc.displayAmount,
      // Net amount FossaPay actually credited to the wallet — what the
      // Firestore ledger counts. totalPaid above is the gross the student
      // transferred (subtotal + fee); keep both so the sheet reconciles
      // against either figure.
      creditedAmount: parsedAmount,
      transactionRef: fossaTransactionId,
      paidAt: new Date().toISOString()
    };

    await Promise.race([
      fetch(process.env.GOOGLE_SHEETS_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sheetsPayload)
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Sheets timeout')), 5000)
      )
    ]);
    console.log('[Sheets] Logged successfully');
  } catch (err) {
    console.error('[Sheets] Logging failed:', err.message);
  }

  return res.status(200).json({ received: true });
};

module.exports.config = { api: { bodyParser: false } };
