#!/usr/bin/env node
// Integration tests for the whole payment layer (initiate-payment + fossapay-webhook)
// against the Firestore emulator. No live Firebase or FossaPay credentials needed.
//
// Run:
//   1. firebase emulators:start --only firestore   (any port; default below is 8686)
//   2. FIRESTORE_EMULATOR_HOST=127.0.0.1:8686 node test-payment-layer.js
//
// The suite calls the REAL request handlers in api/ with mocked req/res objects,
// and captures Google Sheets logging with a local HTTP server so it can assert
// WHOSE information gets logged for each deposit.

'use strict';

const crypto = require('crypto');
const http   = require('http');
const { Readable } = require('stream');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is not set. Start the Firestore emulator and re-run:');
  console.error('  FIRESTORE_EMULATOR_HOST=127.0.0.1:8686 node test-payment-layer.js');
  process.exit(1);
}

// ── Environment for the handlers (must be set before requiring them) ────────
const PROJECT_ID     = 'demo-fyb';
const WEBHOOK_SECRET = 'test-webhook-secret';

// Throwaway RSA key so admin.credential.cert() has a parseable private key.
// The emulator never validates it.
const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
});

process.env.FIREBASE_PROJECT_ID        = PROJECT_ID;
process.env.FIREBASE_CLIENT_EMAIL      = 'test@demo-fyb.iam.gserviceaccount.com';
process.env.FIREBASE_PRIVATE_KEY       = privateKey;
process.env.FOSSAPAY_WEBHOOK_SECRET    = WEBHOOK_SECRET;
// Lets admin.auth().verifyIdToken() accept the unsigned test tokens built below.
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const admin           = require('firebase-admin');
const webhookHandler  = require('./api/fossapay-webhook');
const initiateHandler = require('./api/initiate-payment');
const db              = admin.firestore();

// ── Sheets capture server ────────────────────────────────────────────────────
const sheetRows = [];
const sheetsServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    try { sheetRows.push(JSON.parse(body)); } catch { sheetRows.push({ raw: body }); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
});

// ── Mock req/res helpers ─────────────────────────────────────────────────────
function mockRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; },
    end() { return this; },
  };
  return res;
}

// The webhook reads the raw body off the request stream itself.
async function callWebhook(payload, { sign = true, signature } = {}) {
  const rawBody = JSON.stringify(payload);
  const sig = signature !== undefined
    ? signature
    : (sign
        ? crypto.createHmac('sha256', WEBHOOK_SECRET)
            .update(JSON.stringify(payload.data)).digest('hex')
        : 'deadbeef');
  const req = Readable.from([rawBody]);
  req.method  = 'POST';
  req.headers = { 'x-fossapay-signature': sig };
  const res = mockRes();
  await webhookHandler(req, res);
  return res;
}

// initiate-payment gets a pre-parsed body (Vercel's default bodyParser).
async function callInitiate(body) {
  const req = { method: 'POST', headers: { origin: 'http://localhost:3000' }, body };
  const res = mockRes();
  await initiateHandler(req, res);
  return res;
}

// Unsigned JWT accepted by verifyIdToken in emulator mode.
function makeIdToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: PROJECT_ID,
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    sub: uid,
    user_id: uid,
    auth_time: now - 10,
    iat: now - 10,
    exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: 'google.com' },
  })).toString('base64url');
  return `${header}.${payload}.`;
}

async function clearDb() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(`http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, {
    method: 'DELETE',
  });
  sheetRows.length = 0;
}

async function seedConfig() {
  await db.collection('config').doc('fossapay').set({
    customerId:    'cust_test',
    walletId:      'wallet_test',
    accountNumber: '9990001111',
    accountName:   'NACOS FYB 2026',
    bankName:      'Test Bank',
    bankCode:      '999',
  });
}

// Seed a pending record the way initiate-payment writes it, with a controllable createdAt.
async function seedPending(uid, { subtotal, fee, name, createdAt, legacyOnly = false }) {
  const doc = {
    uid,
    name,
    matric: `MAT-${uid}`,
    email:  `${uid}@test.com`,
    phone:  '+2348012345678',
    gender: 'male',
    items:  [{ id: 'sash', name: 'Sash', price: subtotal }],
    jacketSize: null,
    subtotal,
    fee,
    displayAmount:  subtotal + fee,
    expectedAmount: subtotal,
    accountNumber: '9990001111',
    bankName: 'Test Bank',
    bankCode: '999',
    status: 'pending',
    createdAt: createdAt
      ? admin.firestore.Timestamp.fromDate(createdAt)
      : admin.firestore.FieldValue.serverTimestamp(),
  };
  if (!legacyOnly) doc.expectedGross = subtotal + fee;
  await db.collection('pendingPayments').doc(uid).set(doc);
}

function deposit(txnId, amount) {
  return {
    eventId:   `evt_${txnId}`,
    eventType: 'deposit.completed',
    data: {
      transactionId: txnId,
      customerId: 'cust_test',
      amount: String(amount),
      currency: 'NGN',
      reference: `ref_${txnId}`,
      status: 'completed',
      transactionType: 'deposit',
      timestamp: new Date().toISOString(),
    },
  };
}

// ── Tiny test runner ─────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];
function check(cond, label) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else      { failed++; failures.push(label); console.error(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n── ${name}`); }

async function getDoc(coll, id) {
  const snap = await db.collection(coll).doc(id).get();
  return snap.exists ? snap.data() : null;
}

// ── Tests ────────────────────────────────────────────────────────────────────
async function run() {
  await new Promise(r => sheetsServer.listen(0, '127.0.0.1', r));
  process.env.GOOGLE_SHEETS_WEBHOOK =
    `http://127.0.0.1:${sheetsServer.address().port}/sheet`;

  // 1 ─ initiate-payment happy path
  section('initiate-payment: happy path stores both match keys');
  await clearDb(); await seedConfig();
  // The Auth emulator's verifyIdToken checks the user record exists.
  await admin.auth().createUser({ uid: 'uid-init-1', email: 'ada@test.com' }).catch(() => {});
  let res = await callInitiate({
    idToken: makeIdToken('uid-init-1'),
    name: 'Ada Obi', matric: 'RSU/2021/001', email: 'ada@test.com',
    phone: '08012345678', gender: 'male',
    items: [{ id: 'sash' }], amount: 4500, jacketSize: null,
    senatorYards: null, ankaraOption: null,
  });
  check(res.statusCode === 200, `returns 200 (got ${res.statusCode}: ${JSON.stringify(res.body)})`);
  check(res.body?.subtotal === 4500 && res.body?.fee === 60 && res.body?.totalWithFee === 4560,
    'server-priced subtotal 4500, fee 60, total 4560');
  let pend = await getDoc('pendingPayments', 'uid-init-1');
  check(pend?.status === 'pending', 'pending record created');
  check(pend?.expectedAmount === 4500, 'expectedAmount = subtotal (net)');
  check(pend?.expectedGross === 4560, 'expectedGross = subtotal + fee (gross)');

  // 2 ─ initiate-payment rejects tampered amounts
  section('initiate-payment: rejects tampered amount');
  res = await callInitiate({
    idToken: makeIdToken('uid-init-2'),
    name: 'Tam Per', matric: 'RSU/2021/002', email: 'tam@test.com',
    phone: '08012345678', gender: 'male',
    items: [{ id: 'sash' }], amount: 100, jacketSize: null,
    senatorYards: null, ankaraOption: null,
  });
  check(res.statusCode === 400, `tampered amount rejected with 400 (got ${res.statusCode})`);

  // 3 ─ initiate-payment rejects a bad token
  section('initiate-payment: rejects invalid token');
  res = await callInitiate({
    idToken: 'not-a-jwt',
    name: 'No Auth', matric: 'RSU/2021/003', email: 'na@test.com',
    phone: '08012345678', gender: 'male',
    items: [{ id: 'sash' }], amount: 4500, jacketSize: null,
    senatorYards: null, ankaraOption: null,
  });
  check(res.statusCode === 401, `invalid token rejected with 401 (got ${res.statusCode})`);

  // 4 ─ webhook rejects bad signatures
  section('webhook: rejects invalid signature');
  await clearDb();
  res = await callWebhook(deposit('txn-sig', '4500.00'), { sign: false });
  check(res.statusCode === 401, `bad signature rejected with 401 (got ${res.statusCode})`);
  check((await getDoc('processedEvents', 'txn-sig')) === null, 'nothing written for rejected event');

  // 5 ─ deposit reported as NET (subtotal) matches the payer's own record
  section('webhook: net-amount deposit matches the payer');
  await clearDb();
  await seedPending('uid-net', { subtotal: 4500, fee: 60, name: 'Net Payer' });
  res = await callWebhook(deposit('txn-net', '4500.00'));
  check(res.statusCode === 200, `returns 200 (got ${res.statusCode})`);
  pend = await getDoc('pendingPayments', 'uid-net');
  check(pend?.status === 'completed', 'pending record marked completed');
  check(pend?.transactionRef === 'txn-net', 'transactionRef persisted for the receipt');
  let pay = await getDoc('payments', 'uid-net');
  check(pay?.totalPaid === 4500, `payments.totalPaid = 4500 (got ${pay?.totalPaid})`);
  check(sheetRows.length === 1 && sheetRows[0].name === 'Net Payer',
    'Sheets row logged with the payer\'s own name');

  // 6 ─ deposit reported as GROSS (subtotal + fee) also matches the payer
  section('webhook: gross-amount deposit matches the payer (regression: gross/net flip-flop)');
  await clearDb();
  await seedPending('uid-gross', { subtotal: 4500, fee: 60, name: 'Gross Payer' });
  res = await callWebhook(deposit('txn-gross', '4560.00'));
  check(res.statusCode === 200, `returns 200 (got ${res.statusCode})`);
  pend = await getDoc('pendingPayments', 'uid-gross');
  check(pend?.status === 'completed', 'pending record matched via expectedGross');
  check((await getDoc('unmatchedDeposits', 'txn-gross')) === null, 'not recorded as unmatched');

  // 7 ─ THE REPORTED BUG: a stale pending record must not swallow a new deposit
  section('webhook: stale pending record cannot hijack a new payer\'s deposit');
  await clearDb();
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  await seedPending('uid-stale', { subtotal: 4500, fee: 60, name: 'Old Stale', createdAt: eightDaysAgo });
  await seedPending('uid-fresh', { subtotal: 4500, fee: 60, name: 'Fresh Payer' });
  res = await callWebhook(deposit('txn-hijack', '4500.00'));
  check(res.statusCode === 200, `returns 200 (got ${res.statusCode})`);
  check((await getDoc('pendingPayments', 'uid-fresh'))?.status === 'completed',
    'the FRESH payer\'s record is completed');
  check((await getDoc('pendingPayments', 'uid-stale'))?.status === 'pending',
    'the stale record stays pending (aged out of matching)');
  check(sheetRows.length === 1 && sheetRows[0].name === 'Fresh Payer',
    `Sheets logs the fresh payer, not the stale one (got "${sheetRows[0]?.name}")`);

  // 8 ─ duplicate delivery is idempotent
  section('webhook: duplicate delivery does not double-credit');
  await clearDb();
  await seedPending('uid-dup', { subtotal: 4500, fee: 60, name: 'Dup Payer' });
  await callWebhook(deposit('txn-dup', '4500.00'));
  res = await callWebhook(deposit('txn-dup', '4500.00'));
  check(res.statusCode === 200 && res.body?.duplicate === true, 'second delivery flagged duplicate');
  pay = await getDoc('payments', 'uid-dup');
  check(pay?.totalPaid === 4500, `totalPaid still 4500 after redelivery (got ${pay?.totalPaid})`);
  const summary = await getDoc('summary', 'fossapay');
  check(summary?.depositCount === 1 && summary?.totalDeposits === 4500,
    'ledger counted the deposit exactly once');

  // 9 ─ deposit matching nothing is recorded as unmatched
  section('webhook: unmatched deposit recorded for reconciliation');
  await clearDb();
  res = await callWebhook(deposit('txn-none', '7777.00'));
  check(res.statusCode === 200 && res.body?.unmatched === true, 'acknowledged as unmatched');
  const un = await getDoc('unmatchedDeposits', 'txn-none');
  check(un?.amount === 7777, 'unmatchedDeposits row written');
  check((await getDoc('summary', 'fossapay'))?.unmatchedDeposits === 7777,
    'ledger unmatched total incremented');

  // 10 ─ two concurrent same-amount payers both get credited
  section('webhook: two same-amount payers each get one credit');
  await clearDb();
  await seedPending('uid-two-a', { subtotal: 12000, fee: 200, name: 'Payer A',
    createdAt: new Date(Date.now() - 10 * 60 * 1000) });
  await seedPending('uid-two-b', { subtotal: 12000, fee: 200, name: 'Payer B' });
  await callWebhook(deposit('txn-two-1', '12000.00'));
  await callWebhook(deposit('txn-two-2', '12000.00'));
  check((await getDoc('pendingPayments', 'uid-two-a'))?.status === 'completed', 'payer A completed');
  check((await getDoc('pendingPayments', 'uid-two-b'))?.status === 'completed', 'payer B completed');
  check(sheetRows.length === 2, 'two Sheets rows logged');

  // 11 ─ top 1.2% tier rounding tolerance (net = subtotal + 1)
  section('webhook: top-tier rounding (net = subtotal + 1) still matches');
  await clearDb();
  await seedPending('uid-tier', { subtotal: 30000, fee: 365, name: 'Big Spender' });
  res = await callWebhook(deposit('txn-tier', '30001.00'));
  check((await getDoc('pendingPayments', 'uid-tier'))?.status === 'completed',
    'matched within the ±1 tolerance');

  // 12 ─ legacy pending record (no expectedGross) written before this deploy still matches
  section('webhook: legacy record without expectedGross still matches on net');
  await clearDb();
  await seedPending('uid-legacy', { subtotal: 4500, fee: 60, name: 'Legacy Doc', legacyOnly: true });
  res = await callWebhook(deposit('txn-legacy', '4500.00'));
  check((await getDoc('pendingPayments', 'uid-legacy'))?.status === 'completed',
    'legacy record matched via expectedAmount');

  // ── Result ──
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\nFailures:');
    for (const f of failures) console.error('  •', f);
  }
  sheetsServer.close();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('[Test] Unexpected error:', err);
  process.exit(1);
});
