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

### Ledger (summary/fossapay)

The webhook and admin-withdraw endpoint atomically maintain a `summary/fossapay` Firestore document (`totalDeposits`, `totalWithdrawals`, `depositCount`, `withdrawalCount`) so the dashboard reads one cheap doc for balance stats instead of scanning the full `payments` and `withdrawals` collections on every load.

If you're deploying this after already having existing payments/withdrawals data, run the one-time backfill script once so historical totals aren't zeroed out:

```
FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
  node scripts/backfill-summary.js
```

It's safe to re-run — it recomputes the totals from scratch each time rather than incrementing.

---

## Firestore Index

The webhook requires a composite index on pendingPayments. Create it in the Firebase Console:
- Collection: pendingPayments
- Fields: status (Ascending) → expectedAmount (Ascending) → createdAt (Ascending)
- Query scope: Collection

Or deploy it with: firebase deploy --only firestore:indexes

---

## Payment Flow

1. Student selects items → fills in details → clicks **Generate Payment Account**
2. Frontend calls `POST /api/initiate-payment` with a verified Firebase ID token
3. Backend verifies the token, reads the pre-stored organizer FossaPay account from config/fossapay in Firestore, saves a pendingPayments/{uid} record for the student, and returns the shared bank account details
4. Frontend shows the transfer details screen (displaying the organizer's account name, bank, and account number) and attaches a Firestore `onSnapshot` listener on pendingPayments/{uid}
5. Student transfers the exact amount to the virtual account
6. FossaPay fires `deposit.completed` → `POST /api/fossapay-webhook`
7. Webhook verifies HMAC signature, queries pendingPayments for the oldest pending record matching the received amount exactly, checks idempotency, updates payments/{uid} and marks pendingPayments/{uid} as completed — atomically in a Firestore batch write
8. Firestore snapshot fires on the frontend → receipt screen shown automatically
9. Webhook also logs the transaction to Google Sheets asynchronously
