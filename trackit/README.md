# Trackit — Wireless Emergency Telemedicine System

> CMS 418 · Group Project · Rivers State University

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat&logo=css3&logoColor=white)
![Bootstrap](https://img.shields.io/badge/Bootstrap_5-7952B3?style=flat&logo=bootstrap&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?style=flat&logo=javascript&logoColor=black)

Trackit is a web-based telemedicine management interface that streamlines emergency patient intake, search, and records management. This repository contains a fully interactive frontend . HTML, CSS, and vanilla JavaScript built on Bootstrap 5.

---

## Table of Contents

- [Trackit — Wireless Emergency Telemedicine System](#trackit--wireless-emergency-telemedicine-system)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Tech Stack](#tech-stack)
  - [Pages](#pages)
  - [Project Structure](#project-structure)
  - [Local Setup](#local-setup)
    - [Prerequisites](#prerequisites)
    - [Steps](#steps)
    - [Alternative (without VS Code)](#alternative-without-vs-code)
  - [Branch Workflow](#branch-workflow)
    - [Step-by-step for contributors](#step-by-step-for-contributors)
  - [Contributing](#contributing)
  - [Demo Credentials](#demo-credentials)
  - [Team](#team)
  - [License](#license)

---

## Overview

Trackit provides medical staff with a fast, clean interface to:

- Register new emergency patients with full personal and address information
- Search and filter the patient database with live results
- Sort patient records by any column and export to CSV
- Manage records locally with browser-based storage (simulating a real backend which has not been implemented yet lol)

---

## Tech Stack

| Technology | Purpose |
|---|---|
| HTML5 | Page structure and semantics |
| CSS3 + Custom Properties | Design tokens, layout, responsive adjustments |
| Bootstrap 5.3 | Grid system, components, utilities |
| Bootstrap Icons 1.11 | Icon library |
| Vanilla JavaScript (ES6+) | Form validation, table logic, localStorage, CSV export |

No build tools, no package manager, no Node.js required.

---

## Pages

| File | Description |
|---|---|
| `index.html` | Landing page — hero section with system tagline and CTAs |
| `login.html` | Login — email + password with regex validation, remember me, show/hide password |
| `new-patient.html` | Patient registration — validated form, photo upload preview, localStorage save |
| `find-patient.html` | Patient search — live search, filter dropdowns, sortable table, CSV export, patient detail modal |

---

## Project Structure

```
trackit/
├── index.html
├── login.html
├── new-patient.html
├── find-patient.html
│
├── css/
│   └── styles.css          # Shared design tokens + Bootstrap overrides
│
├── js/
│   ├── data.js             # Default dummy patient JSON (15 records)
│   ├── login.js            # Login form validation logic
│   ├── new-patient.js      # Registration form + localStorage save
│   └── find-patient.js     # Search, filter, sort, export, modal
│
└── .github/
    ├── PULL_REQUEST_TEMPLATE.md
    └── ISSUE_TEMPLATE/
        ├── bug_report.md
        └── feature_request.md
```

---

## Local Setup

### Prerequisites

- [Git](https://git-scm.com/downloads) installed on your machine
- A code editor — [VS Code](https://code.visualstudio.com/) is recommended
- The **Live Server** VS Code extension (search "Live Server" by Ritwick Dey in the Extensions tab)

### Steps

**1. Clone the repository**

```bash
git clone https://github.com/awanicaleb/trackit.git
```

**2. Move into the project folder**

```bash
cd trackit
```

**3. Open in VS Code**

```bash
code .
```

**4. Start Live Server**

- Right-click `index.html` in the VS Code file explorer
- Select **Open with Live Server**
- Your browser will open at `http://127.0.0.1:5500`

> ⚠️ Do **not** open HTML files by double-clicking them in File Explorer. Always use Live Server or a local server — direct file:// paths break relative links between pages.

### Alternative (without VS Code)

If you have Node.js installed:

```bash
npx serve .
```

Then open `http://localhost:3000` in your browser.

---

## Branch Workflow

We follow a simple, protected branch strategy. **Nobody pushes directly to `main` or `develop` — everything goes through a Pull Request.**

```
main            ← stable, production-ready only (protected)
development     ← integration branch, all features land here first (protected)
  ├── feature/login-page
  ├── feature/new-patient-form
  ├── fix/table-sort-bug
  └── docs/update-contributing
```

### Step-by-step for contributors

**1. Always start from the latest `development`**

```bash
git checkout development
git pull origin development
```

**2. Create your feature branch**

Use this naming convention:

```bash
# New feature or page
git checkout -b feature/your-feature-name

# Bug fix
git checkout -b fix/what-you-are-fixing

# Documentation update
git checkout -b docs/what-you-are-updating
```

Examples:
```bash
git checkout -b feature/find-patient-table
git checkout -b fix/login-validation-error
git checkout -b docs/update-local-setup
```

**3. Make your changes, then commit**

Keep commits small and descriptive. Use this format:

```
type: short description of change

Examples:
feat: add sortable columns to patient table
fix: correct email regex on login form
style: update navbar active link colour
docs: add branch workflow to README
```

```bash
git add .
git commit -m "feat: add sortable columns to patient table"
```

**4. Push your branch**

```bash
git push origin feature/your-feature-name
```

**5. Open a Pull Request on GitHub**

- Go to the repository on GitHub
- You will see a prompt to open a PR for your recently pushed branch
- Set the **base branch to `development`** (not `main`)
- Fill out the PR template completely
- Assign the label that best fits your change
- Request a review from the project maintainer

**6. Wait for review**

Do not merge your own PR. The maintainer will review, request changes if needed, and merge it.

---

## Contributing

Please read [CONTRIBUTING.md](CONTRIBUTING.md) before making any changes to this repository.

---

## Demo Credentials

For testing the login page, use any valid email format and a password of at least 8 characters. Example:

- Email: `admin@trackit.com`
- Password: `password123`

---

## Team
1. Awani Torishetosan Caleb

CMS 418 — Rivers State University

> Design reference: [Group 5 Figma](https://www.figma.com/design/bzWCTeyq946GYyc3GkmDNK/Group-5---UI-DESIGN)

---

## License

Please see the [LICENSE](LICENSE.md) file for more information.
