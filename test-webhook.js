#!/usr/bin/env node
// Run with: node test-webhook.js
// Requires: vercel dev running on localhost:3000, and .env.local with Firebase + FossaPay creds

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// Parse .env.local into process.env
const envPath = path.join(__dirname, '.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
} else {
  console.warn('[Test] .env.local not found — relying on already-set environment variables');
}

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

const TEST_UID      = 'test-uid-webhook-001';
const TEST_TXN_ID   = 'test-txn-001';
const TEST_AMOUNT   = '4500.00';
const WEBHOOK_URL   = 'http://localhost:3000/api/fossapay-webhook';

const payload = {
  eventId:   'test_evt_001',
  eventType: 'deposit.completed',
  data: {
    transactionId:   TEST_TXN_ID,
    customerId:      'test-customer',
    amount:          TEST_AMOUNT,
    currency:        'NGN',
    reference:       'test-ref-001',
    status:          'completed',
    transactionType: 'deposit',
    timestamp:       new Date().toISOString(),
  },
};

async function cleanup() {
  console.log('[Test] Cleaning up test documents...');
  const dels = [
    db.collection('pendingPayments').doc(TEST_UID).delete(),
    db.collection('payments').doc(TEST_UID).delete(),
    db.collection('processedEvents').doc(TEST_TXN_ID).delete(),
  ];
  await Promise.all(dels);
  console.log('[Test] Cleanup done.');
}

async function run() {
  try {
    // Step 1: seed the pending payment
    console.log('[Test] Creating test pendingPayments document...');
    await db.collection('pendingPayments').doc(TEST_UID).set({
      uid:            TEST_UID,
      expectedAmount: 4500,
      status:         'pending',
      name:           'Test Student',
      matric:         'TEST001',
      email:          'test@test.com',
      phone:          '+2348000000000',
      gender:         'male',
      items:          [{ id: 'sash', name: 'sash' }],
      subtotal:       4500,
      fee:            60,
      displayAmount:  4560,
      createdAt:      admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('[Test] Pending document created.');

    // Step 2: compute HMAC signature the way FossaPay does — over the
    // JSON-serialized `data` property only, NOT the full body. This matches
    // the verification in api/fossapay-webhook.js.
    const webhookSecret = process.env.FOSSAPAY_WEBHOOK_SECRET || '';
    const bodyString    = JSON.stringify(payload);
    const sigToSend     = crypto
      .createHmac('sha256', webhookSecret)
      .update(JSON.stringify(payload.data))
      .digest('hex');

    console.log('[Test] POSTing to', WEBHOOK_URL);
    console.log('[Test] Signature (first 20):', sigToSend.substring(0, 20) + '...');

    let httpRes;
    try {
      httpRes = await fetch(WEBHOOK_URL, {
        method:  'POST',
        headers: {
          'Content-Type':          'application/json',
          'x-fossapay-signature':  sigToSend,
        },
        body: bodyString,
      });
    } catch (e) {
      console.error('[Test] FAIL — could not reach', WEBHOOK_URL);
      console.error('[Test] Is `vercel dev` running? Error:', e.message);
      await cleanup();
      process.exit(1);
    }

    const responseText = await httpRes.text();
    console.log('[Test] HTTP status:', httpRes.status);
    console.log('[Test] Response body:', responseText);

    if (httpRes.status !== 200) {
      console.error('[Test] FAIL — webhook returned non-200 status');
      await cleanup();
      process.exit(1);
    }

    // Step 3: wait for Firestore writes to settle
    console.log('[Test] Waiting 3 seconds for Firestore writes...');
    await new Promise(r => setTimeout(r, 3000));

    // Step 4: verify Firestore state
    const [pendingSnap, paymentSnap] = await Promise.all([
      db.collection('pendingPayments').doc(TEST_UID).get(),
      db.collection('payments').doc(TEST_UID).get(),
    ]);

    let passed = true;
    const failures = [];

    // Check pendingPayments status
    const pendingData = pendingSnap.data();
    if (!pendingData || pendingData.status !== 'completed') {
      passed = false;
      failures.push(`pendingPayments/${TEST_UID}.status = ${pendingData?.status} (expected "completed")`);
    } else {
      console.log('[Test] ✓ pendingPayments status === "completed"');
    }

    // Check payments document
    if (!paymentSnap.exists) {
      passed = false;
      failures.push(`payments/${TEST_UID} does not exist`);
    } else {
      const pd = paymentSnap.data();
      if (pd.totalPaid !== 4500) {
        passed = false;
        failures.push(`payments/${TEST_UID}.totalPaid = ${pd.totalPaid} (expected 4500, type ${typeof pd.totalPaid})`);
      } else {
        console.log('[Test] ✓ payments totalPaid === 4500 (number)');
      }

      const txn = pd.transactions?.[0];
      if (!txn) {
        passed = false;
        failures.push('payments/${TEST_UID}.transactions is empty');
      } else if (typeof txn.amount !== 'number') {
        passed = false;
        failures.push(`transactions[0].amount type = ${typeof txn.amount} (expected number), value = ${txn.amount}`);
      } else {
        console.log('[Test] ✓ transactions[0].amount is a number:', txn.amount);
      }
    }

    // Step 5: clean up
    await cleanup();

    if (passed) {
      console.log('\n[Test] PASS — all assertions satisfied.');
      process.exit(0);
    } else {
      console.error('\n[Test] FAIL');
      for (const f of failures) console.error('  •', f);
      process.exit(1);
    }
  } catch (err) {
    console.error('[Test] Unexpected error:', err);
    try { await cleanup(); } catch (_) {}
    process.exit(1);
  }
}

run();
