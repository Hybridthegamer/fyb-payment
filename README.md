# FYB-Outfit-Payment-Portal

NACOS RSU FYB Week outfit payment portal, powered by FossaPay virtual bank accounts and Firebase.

## Architecture

- **Frontend**: `index.html` — static page served by Vercel
- **Backend**: `api/initiate-payment.js` — creates FossaPay customer + virtual account, stores pending record in Firestore
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

## Payment Flow

1. Student selects items → fills in details → clicks **Generate Payment Account**
2. Frontend calls `POST /api/initiate-payment` with a verified Firebase ID token
3. Backend verifies the token, creates a FossaPay customer + virtual account, stores a `pendingPayments` record in Firestore, and returns the bank account details
4. Frontend shows the transfer details screen and attaches a Firestore `onSnapshot` listener on the pending document
5. Student transfers the exact amount to the virtual account
6. FossaPay fires `deposit.completed` → `POST /api/fossapay-webhook`
7. Webhook verifies HMAC signature, checks idempotency, verifies amount (±₦1), updates `payments/{uid}` and marks `pendingPayments/{accountNumber}` as completed — atomically
8. Firestore snapshot fires on the frontend → receipt screen shown automatically
9. Webhook also logs the transaction to Google Sheets asynchronously
