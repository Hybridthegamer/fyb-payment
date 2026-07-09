# FYB-Outfit-Payment-Portal

NACOS RSU FYB Week outfit payment portal, powered by FossaPay virtual bank accounts and Firebase.

## Architecture

- **Frontend**: `index.html` — static page served by Vercel
- **Backend**: `api/initiate-payment.js` — reads the pre-stored organizer FossaPay account from Firestore (config/fossapay), saves the student's pending payment record keyed by their Firebase UID, and returns the shared bank account details. No FossaPay API calls happen at checkout time.
- **Webhook**: `api/fossapay-webhook.js` — receives `deposit.completed` events from FossaPay, verifies HMAC signature, updates Firestore atomically, logs to Google Sheets
- **Auth**: Firebase Authentication (Google Sign-In)
- **Database**: Firebase Firestore

---

## Deployment

### Vercel Setup

1. Go to [vercel.com](https://vercel.com) → **Add New Project** → **Import** your GitHub repo
2. **Framework preset**: Other (static + serverless)
3. Add all environment variables from `.env.example` in the Vercel dashboard **before** deploying
4. Click **Deploy** — Vercel auto-detects `/api` functions and serves `index.html` statically

### Environment Variables

Set these in the Vercel dashboard (Settings → Environment Variables):

| Variable | Description |
|---|---|
| `FOSSAPAY_SECRET_KEY` | Live secret key from FossaPay dashboard |
| `FOSSAPAY_WEBHOOK_SECRET` | Webhook signing secret from FossaPay dashboard |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | Service account email |
| `FIREBASE_PRIVATE_KEY` | Service account private key (paste with literal `\n`) |
| `GOOGLE_SHEETS_WEBHOOK` | Google Apps Script web app URL |

---

### Firebase Setup

1. Go to **Firebase Console** → **Project Settings** → **Service Accounts**
2. Click **Generate New Private Key** → download the JSON file
3. Copy values from the JSON into the three `FIREBASE_*` env vars:
   - `FIREBASE_PROJECT_ID` → `project_id`
   - `FIREBASE_CLIENT_EMAIL` → `client_email`
   - `FIREBASE_PRIVATE_KEY` → `private_key` (paste the full key including `-----BEGIN/END PRIVATE KEY-----`)
4. Go to **Firebase Console** → **Authentication** → **Settings** → **Authorized Domains**
5. Add your Vercel production domain (e.g. `your-project.vercel.app`)

#### Firestore Rules

Ensure `payments` (read by authenticated user, write by backend only) and `pendingPayments` (read by authenticated user, write by backend only) are locked down appropriately. The frontend only reads these collections; all writes go through the serverless functions using the Admin SDK.

---

### FossaPay Setup

1. Log in to the FossaPay dashboard → **Settings** → **API Keys**
2. Copy your **live secret key** → set as `FOSSAPAY_SECRET_KEY`
3. Go to **Webhooks** → add a new webhook:
   - **URL**: `https://your-project.vercel.app/api/fossapay-webhook`
   - **Events**: `deposit.completed` only
4. Copy the **webhook secret** → set as `FOSSAPAY_WEBHOOK_SECRET`

---

## One-Time Organizer Account Setup

Run this once after the initial deployment before any student uses the portal.

1. Set the SETUP_SECRET, ORGANIZER_EMAIL, and ORGANIZER_PHONE environment variables in Vercel (Settings → Environment Variables). Redeploy after adding them.
2. Make one POST request to your live endpoint:
     curl -X POST https://<your-vercel-domain>/api/setup-account \
       -H "x-setup-secret: <your SETUP_SECRET value>"
3. The response will include accountNumber, accountName, and bankName. Verify these match what you see in your FossaPay dashboard.
4. Confirm the document config/fossapay now exists in Firestore with a valid accountNumber field.
5. Do not call this endpoint again. It will return 409 if called a second time.

Alternative: If you already have the account details from the FossaPay dashboard, manually create the Firestore document config/fossapay via the Firebase Console with these fields: accountNumber (string), accountName (string), bankName (string), bankCode (string). The setup endpoint is then unnecessary.

## Admin Dashboard

The admin dashboard is available at /admin. Only the email address set in ADMIN_EMAIL can access it.

Features:
- Account balance, total deposits, and total withdrawals (from the summary/fossapay ledger), plus the live FossaPay wallet balance for reference
- Full list of student payments, with search and filters by gender, item paid for, and date
- Full transaction history (deposits + withdrawals) with search, type, and date filters
- FossaPay transaction feed (deposit-only view)
- Initiate withdrawals directly from the dashboard

Setup:
1. Add ADMIN_EMAIL to Vercel environment variables (Settings → Environment Variables). Set it to your Google account email.
2. Redeploy after adding the variable.
3. Visit https://fyb-payment.vercel.app/admin and sign in with your Google account.
4. Any other Google account will be shown Access Denied and signed out immediately.

Note on withdrawal endpoint: FossaPay's withdrawal API endpoint may differ from what is documented. If a withdrawal attempt returns an error, check Vercel logs for the raw FossaPay response (logged before parsing) and update the URL in api/admin-withdraw.js accordingly.

### Balances by provider

The dashboard reconciles balances from the actual transaction rows, split by provider:

- **FossaPay balance** = FossaPay deposits + unmatched deposits − withdrawals. This is the withdrawable figure.
- **Paystack deposits** — legacy payments collected via Paystack before the FossaPay portal went live (identified by the `PAYSTACK_REFS` list in `admin.html` and `scripts/backfill-summary.js`). That money never touched the FossaPay wallet, so it is excluded from the FossaPay balance and shown as its own stat.
- **Unmatched deposits** — wallet credits the webhook verified but could not attribute to any pending payment. They are recorded in the `unmatchedDeposits` collection, counted into the FossaPay balance, and surfaced as a stat tile when present so they can be resolved manually.

### Ledger (summary/fossapay)

The webhook and admin-withdraw endpoint atomically maintain a `summary/fossapay` Firestore document (`totalDeposits`, `totalWithdrawals`, `depositCount`, `withdrawalCount`, plus `paystackDeposits`/`paystackCount` and `unmatchedDeposits`/`unmatchedCount` after backfill). The dashboard computes its displayed balances from the full transaction rows it already loads; the ledger doc remains as a cheap cross-check.

If you're deploying this after already having existing payments/withdrawals data, run the one-time backfill script once so historical totals aren't zeroed out:

```
FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
  node scripts/backfill-summary.js
```

It's safe to re-run — it recomputes the totals from scratch each time rather than incrementing.

### Reconciling stuck pending payments

If a deposit reached the FossaPay wallet but the payer's `pendingPayments` record stayed `pending` (webhook delivery failed, or the deposit landed in `unmatchedDeposits`), run the reconciliation script. It cross-references stuck pending records against both `unmatchedDeposits` and the live FossaPay transaction history (anything with no `processedEvents` doc), proposes conservative amount-based matches, and — only with `--apply` — replays the exact writes the webhook would have made (credit `payments/{uid}`, mark the pending record completed, record the event, fix the ledger):

```bash
# Dry run — prints stuck pendings, unclaimed deposits, and proposed matches
FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
FOSSAPAY_SECRET_KEY=... node scripts/reconcile-pending.js

# Execute the proposed matches; resolve ambiguous ones explicitly
node scripts/reconcile-pending.js --apply --match TXNID=UID
```

Deposits are auto-matched only when exactly one stuck pending record fits the amount and no other deposit competes for it; everything else is listed for manual `--match` pairing. Cross-check afterwards with `scripts/backfill-summary.js`.

---

## Firestore Indexes

The webhook requires two composite indexes on pendingPayments (one per match key).
The createdAt direction MUST be Descending — the matcher orders newest-first, and
Firestore composite indexes are direction-sensitive:
- status (Ascending) → expectedAmount (Ascending) → createdAt (Descending)
- status (Ascending) → expectedGross (Ascending) → createdAt (Descending)

Deploy them with: `firebase deploy --only firestore:indexes` (they are defined in
`firestore.indexes.json`). If the expectedGross index is missing the webhook logs an
error and returns 500 for deposits it can't match, so FossaPay redelivers the event
after the index is deployed instead of the deposit being lost.

## Testing the payment layer

`test-payment-layer.js` runs the real initiate-payment and webhook handlers against the
Firebase emulators — no live credentials, no FossaPay account, and no `vercel dev` needed.
It covers matching (net, gross, ±1 rounding, legacy records), the stale-record hijack
regression, idempotent redelivery, unmatched-deposit recording, signature rejection, and
initiate-payment validation:

```
npx firebase-tools emulators:start --only firestore,auth   # firestore on 8686, auth on 9099
FIRESTORE_EMULATOR_HOST=127.0.0.1:8686 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  node test-payment-layer.js
```

(`test-webhook.js` is the older smoke test that posts to a running `vercel dev` against
your real Firebase project.)

---

## Payment Flow

1. Student selects items → fills in details → clicks **Generate Payment Account**
2. Frontend calls `POST /api/initiate-payment` with a verified Firebase ID token
3. Backend verifies the token, **recomputes every item price from its own server-side catalog** (client-sent prices/amounts are never trusted — a mismatch is rejected), reads the pre-stored organizer FossaPay account from config/fossapay in Firestore, saves a pendingPayments/{uid} record for the student, and returns the shared bank account details
4. Frontend shows the transfer details screen (displaying the organizer's account name, bank, and account number) and attaches a Firestore `onSnapshot` listener on pendingPayments/{uid}
5. Student transfers the exact amount to the virtual account
6. FossaPay fires `deposit.completed` → `POST /api/fossapay-webhook`
7. Webhook verifies HMAC signature, then — inside a single Firestore transaction — checks idempotency, matches the deposit to a pending record, updates payments/{uid}, marks pendingPayments/{uid} as completed, and increments the ledger. Matching rules: only records created within the last 24 hours are considered (override with the `PENDING_MATCH_WINDOW_HOURS` env var), newest first, against both stored match keys — `expectedAmount` (the net FossaPay credits, == subtotal) and `expectedGross` (the gross the student transfers, == subtotal + fee) — exact first, then ±1 for top-tier rounding. The freshness window is what stops an old, never-completed pending record from swallowing a new student's deposit (which previously logged the wrong person and left the actual payer stuck on "pending"). The transaction closes the race where two same-amount deposits could both claim one pending record. Deposits with no matching pending record are recorded in `unmatchedDeposits` so the money still shows up in the reconciled balance
8. Firestore snapshot fires on the frontend → receipt screen shown automatically
9. Webhook also logs the transaction to Google Sheets asynchronously
