# TRACKIT — Project Context Brief

---

## Who I Am

I'm Caleb, a final year CS student at Rivers State University (RSU) in Port Harcourt, Nigeria. I build products independently, using AI as my dev team. My background is Python/Flask backends, PostgreSQL, and vanilla JS frontends. I communicate casually and prefer direct, honest advice over hedged answers.

This is a group project but realistically it's just me doing all the technical work. Some group members are eager but lack the skill level to contribute meaningfully right now.

---

## What This Project Is

**Trackit** — a Wireless Emergency Telemedicine System (WETS). It's a web application that allows medical staff to register emergency patients, search and manage patient records, and monitor live ECG and vital signs.

This is actually a project my lecturer is working on himself. He gave it to students as a challenge — the group that executes it best gets it as their C.A., possibly exam grades, and a potential contract involving a trip to South Africa. The stakes are real.

---

## Current State — Frontend is COMPLETE

The entire frontend has been built with Bootstrap 5 + Vanilla JavaScript. It is fully functional with working JS on every page.

### Tech Stack
- HTML5, CSS3
- Bootstrap 5.3 (CDN)
- Bootstrap Icons 1.11 (CDN)
- Vanilla JavaScript (ES6+)
- No build tools, no Node, no bundler — pure static files

### File Structure
```
trackit/
├── index.html              — Landing page (hero, animated stats, feature cards)
├── login.html              — Login (email regex validation, show/hide password, remember me)
├── new-patient.html        — Patient registration form (full validation, photo upload)
├── find-patient.html       — Patient search (live search, sort, filter, CSV export, modal)
├── patient-connection.html — ECG monitoring (animated canvas ECG, vital signs, connect)
├── css/
│   └── styles.css          — Shared design tokens + Bootstrap overrides
└── js/
    ├── data.js             — 15 dummy Nigerian patient records (DEFAULT_PATIENTS global)
    ├── index.js            — Landing page counter animation
    ├── login.js            — Login validation + localStorage remember me
    ├── new-patient.js      — Form validation, photo upload, contacts, localStorage save
    ├── find-patient.js     — Search, filter, sort, CSV export, patient detail modal
    └── patient-connection.js — ECG canvas animation, vitals fluctuation, connect logic
```

### Design System
- Primary green: `#1a6b3c` (dark), `#2e9e60` (main), `#d6f0e0` (light)
- All pages use a `page-shell` div with `position:relative; overflow:hidden`
- Wave SVG decorations: top-right light green, bottom dark green
- Shared navbar across all pages

### Key JS Features Built
- **login.js** — Email regex `/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/`, password min 8 chars, show/hide toggle, remember me via localStorage, loading spinner on submit
- **new-patient.js** — 16-field validation with regex per field, Nigerian states dropdown (37 states), photo FileReader preview, dynamic contacts add/remove, auto patient ID generation (TRK-016 onwards), localStorage save, toast + redirect
- **find-patient.js** — Merges DEFAULT_PATIENTS + localStorage patients, live search across name/ID/NIN/department, 3 filter dropdowns (dept/gender/status), column sort (asc/desc with icons), CSV export, patient detail modal, XSS escaping
- **patient-connection.js** — Real ECG waveform canvas (P wave + QRS complex + T wave interpolated from control points), vital signs that fluctuate realistically (BPM synced to ECG speed), connect by name or patient ID, pause/resume/stop/save controls

### Data Shape (patient object)
```javascript
{
  id: "TRK-001",           // auto-generated
  nationalId: "11165435916",
  firstName: "John",
  lastName: "Doe",
  gender: "Male",
  age: 25,
  dob: "2000-09-11",       // YYYY-MM-DD
  mobile: "09015344428",
  telephone: null,         // optional
  email: "johndoe@gmail.com",
  bloodType: "O+",
  genotype: "AA",          // AA, AS, SS, AC only (bug in original group's code — fixed)
  department: "Orthopedic",
  maritalStatus: "Single",
  doctor: null,            // optional
  country: "Nigeria",
  state: "Rivers State",
  city: "Port Harcourt",
  street: "10 Haven Avenue",
  zip: "500001",
  contacts: [],            // [{type, detail}] — dynamic contact persons
  status: "Active",
  registeredDate: "2024-01-15",
  photo: null              // base64 or null
}
```

### localStorage Keys
- `trackit_patients` — array of patient objects registered via new-patient.html
- `trackit_remember_email` — remembered email for login
- `trackit_logged_in` — boolean flag after login

---

## GitHub Repository

- Repo: `trackit-cms418` on Caleb's GitHub (@calebawani on X)
- Branch strategy: `main` (protected) + `development` (working branch)
- Branch protection: PRs required, 1 approval, dismiss stale, block force push, Copilot review
- Has: README.md, CONTRIBUTING.md, PR template, issue templates (bug + feature), .gitignore, LICENSE (GPL v3)
- All frontend code is committed to `development`, not yet merged to `main`

---

## Architecture Decisions Made

### Frontend ↔ Backend: Decoupled REST API ✅
Confirmed by lecturer. Frontend and backend are separate projects communicating via HTTP/JSON + JWT tokens. Frontend will be deployed on Vercel. Backend will be a separate deployment.

### NOT using Java Servlets
Lecturer confirmed API approach is acceptable. Spring Boot REST API is the target, not JSP/Servlet monolith.

### localStorage as API placeholder
Every localStorage call in the JS is a deliberate placeholder for a real fetch() call. The data shapes are already defined. Swapping is clean:
```javascript
// Current (placeholder)
localStorage.setItem('trackit_patients', JSON.stringify(list));

// Future (real backend)
fetch('/api/patients', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify(patient)
});
```

---

## What's Needed Next (In Order)

### 1. Deploy Frontend to Vercel (15 minutes)
Pure static site — no build config needed. Connect GitHub repo, deploy, get live URL to share with lecturer.
Need a `vercel.json` in root:
```json
{ "cleanUrls": true, "trailingSlash": false }
```

### 2. Java Spring Boot Backend (2-3 days)
Caleb knows Python/Flask backend well — concepts transfer directly. Java/Spring Boot is new syntax only.

Key endpoints needed:
- `POST /api/auth/login` — returns JWT token
- `GET /api/patients` — list all patients (with search/filter params)
- `POST /api/patients` — register new patient
- `GET /api/patients/{id}` — get single patient
- `PUT /api/patients/{id}` — update patient
- `DELETE /api/patients/{id}` — delete patient
- `POST /api/ecg/analyse` — send ECG data to ML service, return classification

Stack: Spring Boot + Spring Data JPA + Spring Security (JWT) + PostgreSQL

Flask → Spring Boot mental model mapping:
```
Flask route decorator  →  @GetMapping / @PostMapping
jsonify()              →  ResponseEntity.ok()
SQLAlchemy model       →  @Entity class with JPA
Flask-JWT              →  Spring Security + JJWT library
requirements.txt       →  pom.xml (Maven)
app.py                 →  @SpringBootApplication main class
```

### 3. Connect Frontend to Backend (1 day)
Replace all localStorage calls with fetch() calls. Add JWT token handling. Update the patient connection page to send real ECG data.

### 4. Python ML Service for ECG (2-3 days)
**Context on the ML situation — important:**

The project involves a 12-lead ECG classification model. The ML model:
- Accepts raw ECG signal data as input
- Outputs a classification (Normal, Stable, Unstable, Chaotic, etc.)
- Drives the 12 waveform graphs on the patient connection page

Another group has a model we could borrow, but we are NOT doing that. Here's why: this project has major stakes (C.A. grade, potential exam grade, possible contract to South Africa). Using a competitor's model creates dependency on people with every reason to sabotage us. We build our own.

**Our ML plan:**
- Dataset: MIT-BIH Arrhythmia Database (free, public, well-documented)
- Model: 1D CNN or LSTM (Python, TensorFlow or PyTorch)
- Service: Wrap trained model in FastAPI
- Integration: Java backend calls Python FastAPI service → returns classification + signal data → frontend draws 12 leads

Neither Caleb nor any group member has ML background. Timeline is approximately one week to presentation. Recommendation discussed: use a published, citable pre-trained baseline model for the presentation demo, build our own in parallel, present the plan for our own model as part of the roadmap. This is defensible and shows engineering maturity.

**Current ECG page status:** The patient-connection page has a fully animated fake ECG (canvas-based, realistic P/QRS/T waveform). This is the placeholder that gets replaced with real model output.

---

## Presentation Timeline (approximately 1 week)

| Day | Task |
|-----|------|
| 1 | Deploy to Vercel. Scaffold Spring Boot project. |
| 2 | Spring Boot: auth + patient CRUD endpoints. |
| 3 | Connect frontend to backend. Replace localStorage. |
| 4 | Python FastAPI ML service setup. Baseline model integration. |
| 5 | End-to-end demo works. ECG page uses real data. |
| 6 | Presentation prep. Architecture slides. Model roadmap. |
| 7 | Buffer / polish. |

---

## Important Context About My Working Style

- I prefer direct answers, no hedging
- I'm comfortable with vibe coding — generate, test, iterate
- I will tell you when something doesn't look right or work — send screenshots
- I work file by file or section by section, not everything at once
- I commit to git at logical checkpoints (per feature, not per line)
- When I say "Begin" or "Yes" I mean proceed immediately, no more discussion

---

## Where We Left Off

Frontend is complete and committed to `development` branch on GitHub. Not yet merged to `main`. Not yet deployed to Vercel.

**First task in new conversation: Deploy to Vercel.**
