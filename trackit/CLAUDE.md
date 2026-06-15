# CLAUDE.md — Trackit Project Context

This file is read automatically by Claude Code at session start.
Read it fully before taking any action.

---

## What This Project Is

**Trackit** — a Wireless Emergency Telemedicine System (WETS).
A web application for emergency patient registration, record management,
real-time ECG monitoring, and ML-assisted cardiac condition classification.

Built by Caleb (final year CS, RSU Port Harcourt, Nigeria).
High-stakes academic project — potential C.A. grade, exam credit, and
a contract opportunity. Quality and correctness matter.

---

## Current Status (this session)

The backend and ML service are both built and running locally, verified
independently. Frontend integration and end-to-end testing are next.

### Backend (Spring Boot) — built, running on :8080
- `java.version` in `backend/pom.xml` is **17** (changed from 25 — Java 25
  bytecode broke `spring-boot-maven-plugin:3.3.0` with "Unsupported class
  file major version 69". 17 matches the original target and builds fine
  with the installed JDK 25 via `--release 17`)
- **Maven Wrapper added** (`backend/mvnw`, `mvnw.cmd`, `.mvn/wrapper/`,
  pinned to Maven 3.9.9) because `mvn` is not installed/on PATH on this
  machine. Always use `./mvnw` (or `mvnw.cmd`), never a bare `mvn`.
- Admin user auto-seeds on every startup (H2 is `create-drop`):
  `admin@trackit.com` / `Admin1234`
- `app.cors.allowed-origins` (application.properties) now includes
  `http://localhost:5500` in addition to `http://127.0.0.1:5500`,
  `http://localhost:3000`, and the Vercel domain

### ML Service (FastAPI) — built, running on :8000
- New directory: `ml-service/` (`main.py`, `ecg_processor.py`,
  `requirements.txt`)
- CORS open to all origins (internal service)
- `GET /health` → `{"status": "ok"}`
- `POST /predict` → accepts `{patientId, signal}` (signal = raw samples,
  treated as 360Hz), returns `{patientId, classification, confidence, leads}`
- Classification uses **neurokit2** R-peak detection → heart rate + R-R
  interval CV → Normal / Tachycardia / Bradycardia / Atrial Fibrillation /
  Chaotic / Unavailable (see `ecg_processor.py` for thresholds)
- `leads` is an **object keyed by lead name** (`I, II, III, aVR, aVL, aVF,
  V1-V6`), each an array of exactly 500 floats. Input signal is treated as
  Lead II; the other 11 leads are derived via Einthoven's law + Goldberger's
  augmented-lead formulas (limb leads) and stylised amplitude ratios
  (precordial leads) — see "ML Model" section below for why this differs
  from the originally-planned output shape
- Verified end-to-end with a synthetic 1000-sample ECG: returned
  `Normal` / `0.95` confidence, all 12 leads present at length 500,
  `I + III == II` holds exactly

### Restarting each service from scratch

**Backend:**
```bash
cd backend
./mvnw spring-boot:run        # Windows: mvnw.cmd spring-boot:run
```
Wait for `Started TrackitApplication` and the `Admin user seeded` banner
in stdout.

**ML service:**
```bash
cd ml-service
pip install -r requirements.txt   # first time / after requirements.txt changes
python main.py
```
Wait for `Uvicorn running on http://0.0.0.0:8000`.

### What's next
1. **End-to-end stack test** with both services running:
   - `POST /api/auth/login` with `admin@trackit.com` / `Admin1234` → JWT
   - `GET /api/patients` with `Authorization: Bearer <token>` → list
   - `POST /api/ecg/analyse` → confirm it relays to `ml-service` `/predict`
     and returns the classification + 12 leads
2. **Wire frontend JS to real API endpoints** — replace the localStorage
   placeholders in `js/login.js`, `js/new-patient.js`, `js/find-patient.js`,
   `js/patient-connection.js` with `fetch()` calls per the documented
   shapes
3. **Deploy** — frontend to Vercel (confirm existing deployment), backend +
   ML service to a host that can run both processes (switch backend to
   `application-prod.properties` / Postgres via `DATABASE_URL`, etc.)

---

## Repository Structure

```
/
├── CLAUDE.md                  ← you are here
├── index.html, login.html, new-patient.html,
│   find-patient.html, patient-connection.html  ← frontend pages, repo root
│                                                  (NOT /frontend — see Frontend section)
├── css/
│   └── styles.css
├── js/
│   ├── data.js            ← 15 dummy patients (DEFAULT_PATIENTS global)
│   ├── index.js
│   ├── login.js
│   ├── new-patient.js
│   ├── find-patient.js
│   └── patient-connection.js
├── backend/                   ← Spring Boot 3.3 / Java 17. Built & running on
│   │                             :8080 (see "Current Status")
│   ├── mvnw, mvnw.cmd, .mvn/   ← Maven Wrapper — use this, not `mvn`
│   ├── pom.xml
│   └── src/main/java/...
├── ml-service/                ← FastAPI ML service. Built & running on :8000
│   ├── main.py                  (see "Current Status")
│   ├── ecg_processor.py
│   └── requirements.txt
├── model/
│   ├── ours/                  ← empty placeholder for a future custom 12-lead model
│   └── theirs/                ← single-lead wearable notebook from another group,
│                                  audited, NOT used (see "ML Model" section)
└── PROJECT_DESCRIPTION.md     ← Full requirements document
```

---

## Architecture (confirmed with lecturer)

```
Frontend (Vercel — static HTML/JS/CSS)
    ↕ HTTPS + JWT Bearer token
Java Spring Boot REST API (backend/)
    ↕ Internal HTTP
Python FastAPI ML Service (wraps model/theirs/)
    ↕
PostgreSQL Database
```

- Frontend and backend are **fully decoupled**
- All communication via JSON REST APIs
- JWT for authentication
- Frontend is already deployed or will be deployed to Vercel

---

## Frontend — COMPLETE, DO NOT MODIFY

Tech stack: HTML5, Bootstrap 5.3 CDN, Bootstrap Icons, Vanilla JS ES6+.
No build tools, no Node, no bundler.

### What works:
- Login with email regex validation, show/hide password, remember me
- Patient registration with 16-field validation, photo upload, Nigerian states
- Patient search with live filter, column sort, CSV export, detail modal
- Patient connection page with animated ECG canvas (P/QRS/T waveform),
  vital signs fluctuation, connect by name or patient ID

### localStorage as API placeholder:
Every localStorage call is a placeholder for a real fetch() call.
The swap is the key integration task. Example:

```javascript
// Current (placeholder in new-patient.js)
localStorage.setItem('trackit_patients', JSON.stringify(list));

// Target (after backend integration)
const res = await fetch('/api/patients', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + localStorage.getItem('trackit_token')
  },
  body: JSON.stringify(patient)
});
```

### Patient data shape (must match backend API exactly):
```javascript
{
  id: "TRK-001",
  nationalId: "11165435916",   // 11 digits
  firstName: "John",
  lastName: "Doe",
  gender: "Male",
  age: 25,
  dob: "2000-09-11",           // YYYY-MM-DD
  mobile: "09015344428",
  telephone: null,             // optional
  email: "johndoe@gmail.com",
  bloodType: "O+",
  genotype: "AA",              // AA | AS | SS | AC only
  department: "Orthopedic",
  maritalStatus: "Single",
  doctor: null,                // optional
  country: "Nigeria",
  state: "Rivers State",
  city: "Port Harcourt",
  street: "10 Haven Avenue",
  zip: "500001",
  contacts: [],                // [{type: string, detail: string}]
  status: "Active",            // Active | Inactive
  registeredDate: "2024-01-15", // YYYY-MM-DD
  photo: null                  // base64 string or null
}
```

### Auth response shape expected by frontend:
```javascript
{
  token: "eyJhbGci...",   // JWT — stored as localStorage.getItem('trackit_token')
  user: {
    id: 1,
    email: "admin@trackit.com",
    name: "Dr. Adeyemi"
  }
}
```

---

## Backend — Built & Running (audited and completed this session)

Located at `/backend`. Fully implemented: JWT auth, patient CRUD, ECG
endpoints, validation, global exception handling, H2 (dev) / PostgreSQL
(prod) profiles, admin auto-seed. Runs on **port 8080**. See "Current
Status" near the top of this file for restart instructions and recent
fixes (java.version, Maven Wrapper, CORS).

**Backend stack (as built):**
- Java 17
- Spring Boot 3.3.0
- Spring Web (REST controllers)
- Spring Data JPA (database layer)
- Spring Security + JJWT 0.12.3 (JWT authentication)
- H2 (dev, in-memory) / PostgreSQL (prod)
- Maven, via Maven Wrapper (`./mvnw` — `mvn` is not installed on this machine)

**Required API endpoints:**
```
POST   /api/auth/login          → authenticate, return JWT
GET    /api/patients            → list all (supports ?search=, ?department=, ?status=)
POST   /api/patients            → create new patient
GET    /api/patients/{id}       → get single patient
PUT    /api/patients/{id}       → update patient
DELETE /api/patients/{id}       → delete patient
POST   /api/ecg/analyse         → relay ECG data to Python ML service, return result
GET    /api/ecg/leads/{id}      → get stored ECG lead data for a patient
```

**CORS must allow:** the Vercel frontend domain (and localhost:5500 for
development) — ✅ done, see "Current Status"

---

## ML Model (`/model/theirs`) — Audited, NOT Used

`/model/theirs` contains a single file: `ecg_wearable_triage.ipynb`. Audit
findings:
- Single-lead **wearable triage** notebook (smartwatch-style ECG + PPG,
  256Hz/64Hz, 30s windows) — NOT a 12-lead clinical ECG model
- Mostly unexecuted (only 2 of ~20 code cells have run; one of those two
  errored with `NameError: name 'Tuple' is not defined`)
- No saved model weights/checkpoint exist anywhere in the repo
- Output schema (rhythm/stress/SpO2/severity tier) does not match the
  required `{classification, confidence, leads}` shape
- **Conclusion: not usable.** `/model/ours` is an empty placeholder for a
  future custom 12-lead model.

**What was built instead:** `ml-service/` (FastAPI), wrapping a
**neurokit2-based classifier** built from scratch — see "Current Status"
near the top of this file. It does not load or depend on `/model/theirs`
or `/model/ours` in any way.

**ML service stack (as built):**
- Python 3.12, FastAPI + Uvicorn
- `POST /predict` — accepts `{patientId, signal}`, returns classification
  + 12-lead data
- `GET /health` — returns `{"status": "ok"}`

**Actual ML output shape (verified):**
```json
{
  "patientId": "TRK-001",
  "classification": "Normal",
  "confidence": 0.95,
  "leads": {
    "I":   [0.1, 0.3, 0.8, "... 500 floats total"],
    "II":  [0.2, 0.4, 0.9, "..."],
    "III": ["..."],
    "aVR": ["..."], "aVL": ["..."], "aVF": ["..."],
    "V1": ["..."], "V2": ["..."], "V3": ["..."],
    "V4": ["..."], "V5": ["..."], "V6": ["..."]
  }
}
```

**Original target shape (superseded — kept for history):**
```json
{
  "classification": "Normal",
  "confidence": 0.94,
  "leads": [
    { "lead": "I",   "signal": [0.1, 0.3, 0.8, ...] },
    { "lead": "II",  "signal": [0.2, 0.4, 0.9, ...] },
    ...12 leads total
  ]
}
```
The actual shape uses an **object keyed by lead name** (not an array of
`{lead, signal}` objects) and includes `patientId`. The Spring Boot
`EcgService` relays the `ml-service` response as-is (`Map<?,?>`), so
`POST /api/ecg/analyse` returns the **actual** shape above — frontend
wiring should target that.

---

## Database Schema (target)

```sql
-- patients table
CREATE TABLE patients (
  id              SERIAL PRIMARY KEY,
  patient_code    VARCHAR(10) UNIQUE NOT NULL,  -- TRK-001 format
  national_id     VARCHAR(11) UNIQUE,
  first_name      VARCHAR(100) NOT NULL,
  last_name       VARCHAR(100) NOT NULL,
  gender          VARCHAR(10),
  age             INTEGER,
  dob             DATE,
  mobile          VARCHAR(15),
  telephone       VARCHAR(20),
  email           VARCHAR(255),
  blood_type      VARCHAR(5),
  genotype        VARCHAR(5),
  department      VARCHAR(100),
  marital_status  VARCHAR(20),
  doctor          VARCHAR(100),
  country         VARCHAR(100),
  state           VARCHAR(100),
  city            VARCHAR(100),
  street          VARCHAR(255),
  zip             VARCHAR(10),
  status          VARCHAR(20) DEFAULT 'Active',
  registered_date DATE DEFAULT CURRENT_DATE,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- users table (medical staff)
CREATE TABLE users (
  id           SERIAL PRIMARY KEY,
  email        VARCHAR(255) UNIQUE NOT NULL,
  password     VARCHAR(255) NOT NULL,  -- bcrypt hashed
  full_name    VARCHAR(200),
  role         VARCHAR(50) DEFAULT 'STAFF',
  created_at   TIMESTAMP DEFAULT NOW()
);

-- ecg_sessions table
CREATE TABLE ecg_sessions (
  id              SERIAL PRIMARY KEY,
  patient_id      INTEGER REFERENCES patients(id),
  classification  VARCHAR(50),
  confidence      DECIMAL(5,4),
  lead_data       JSONB,             -- stores the 12 lead signal arrays
  recorded_at     TIMESTAMP DEFAULT NOW()
);
```

---

## Environment Variables Needed

```
# backend/src/main/resources/application.properties
spring.datasource.url=jdbc:postgresql://localhost:5432/trackit
spring.datasource.username=your_db_user
spring.datasource.password=your_db_password
spring.jpa.hibernate.ddl-auto=update
jwt.secret=your_jwt_secret_key_min_256_bits
jwt.expiration=86400000
ml.service.url=http://localhost:8000

# Python ML service (.env)
MODEL_PATH=../model/theirs/
PORT=8000
```

---

## Git Workflow

- Main branch: `main` (protected — requires PR)
- Working branch: `development`
- Always work on `development`
- Commit after each logical unit of work
- Commit message format: `type: description`
  - `feat:` new feature
  - `fix:` bug fix
  - `chore:` setup, config, dependencies
  - `docs:` documentation

---

## How Caleb Works

- Prefers direct, honest responses — no hedging
- Comfortable with vibe coding — generate, test, iterate
- Will test and report back with screenshots or error messages
- Works file by file, not everything at once
- When he says "Begin", "Yes", or "Go" — proceed immediately
- When he says "Talk to me" — he wants discussion not code

---

## Session Priority — Progress

1. ✅ Audit /backend — done (see "Backend" section)
2. ✅ Audit /model/theirs — done (see "ML Model" section)
3. ✅ Backend fixed/completed — running on :8080 (see "Current Status")
4. ✅ ML service built (`ml-service/`, FastAPI + neurokit2) — running on :8000
5. ⬜ Connect frontend localStorage calls to real API calls
6. ⬜ End-to-end demo working

**Remaining work is items 5-6 — see "What's next" under "Current Status"
near the top of this file for the concrete next steps.**