# Trackit — Wireless Emergency Telemedicine System
## Project Description & Requirements Document

---

## 1. Project Overview

Trackit is a web-based Wireless Emergency Telemedicine System designed to support medical staff in managing emergency patient care. The system provides a centralised platform for patient registration, record management, real-time ECG monitoring, and AI-assisted cardiac condition classification.

The application is built as a decoupled system — a responsive web frontend accessible from any modern browser, communicating with a Java-powered backend via REST APIs, and integrated with a Python-based machine learning service for ECG analysis.

The name "Trackit" reflects the system's core purpose: tracking patients, tracking vitals, and tracking conditions in real time.

---

## 2. Problem Statement

Emergency medical care in many healthcare settings suffers from fragmented patient information, delayed record retrieval, and limited access to real-time diagnostic data. Medical staff often lack a single unified interface to register incoming patients, retrieve existing records, and monitor a patient's cardiac activity simultaneously.

Trackit addresses this by providing:
- A fast, structured intake process for new emergency patients
- A searchable, filterable patient database accessible from any device
- A live ECG monitoring interface that connects to patient data and classifies cardiac conditions using machine learning

---

## 3. Target Users

| User Type | Description |
|---|---|
| Emergency Medical Staff | Doctors and nurses who register and monitor patients |
| Ward Staff | Personnel who retrieve and update patient records |
| System Administrators | Users who manage access and system configuration |

---

## 4. System Modules

The application is organised into five functional modules:

### Module 1 — Authentication
Controls access to the system. All features require a valid login session.

### Module 2 — Landing / Dashboard
The entry point of the system. Provides an overview of system activity including monitored patient count, emergency events, and pending notifications.

### Module 3 — Patient Registration
A structured intake form for registering new emergency patients with complete personal, medical, address, and contact information.

### Module 4 — Patient Records
A searchable, sortable database of all registered patients with filtering capabilities and detailed record viewing.

### Module 5 — Patient Connection & ECG Monitoring
A real-time monitoring interface that connects to a specific patient, displays a live ECG waveform across 12 leads, shows vital signs, and uses an ML model to classify the patient's cardiac condition.

---

## 5. Functional Requirements

Functional requirements describe what the system must do.

### 5.1 Authentication

| ID | Requirement |
|---|---|
| FR-01 | The system shall allow registered users to log in using a valid email address and password |
| FR-02 | The system shall validate the email format using regular expression before submission |
| FR-03 | The system shall reject passwords shorter than 8 characters |
| FR-04 | The system shall provide a show/hide toggle for the password field |
| FR-05 | The system shall offer a "Remember me" option that persists the user's email across sessions |
| FR-06 | The system shall display a loading indicator during authentication |
| FR-07 | The system shall redirect authenticated users to the patient records page upon successful login |

### 5.2 Patient Registration

| ID | Requirement |
|---|---|
| FR-08 | The system shall provide a form for registering new patients with the following fields: National Identity Number (NIN), First Name, Last Name, Gender, Age, Date of Birth, Mobile Number, Telephone, Email Address, Blood Type, Genotype, Department, Marital Status, Assigned Doctor, Country, State, City, ZIP Code, Street Address |
| FR-09 | The system shall validate all required fields before saving — empty fields shall be rejected with descriptive error messages |
| FR-10 | The system shall validate the NIN as exactly 11 numeric digits |
| FR-11 | The system shall validate the mobile number as a valid Nigerian mobile format (070, 080, 081, 090, 091 prefixes) |
| FR-12 | The system shall validate the email address using regular expression |
| FR-13 | The system shall validate that Date of Birth is not a future date |
| FR-14 | The system shall validate Age as a number between 0 and 150 |
| FR-15 | The system shall accept a patient photo upload with a preview before saving |
| FR-16 | The system shall populate the State dropdown with all 36 Nigerian states plus FCT |
| FR-17 | The system shall provide department name autocomplete suggestions |
| FR-18 | The system shall allow users to add multiple contact persons with contact type and detail |
| FR-19 | The system shall auto-generate a unique Patient ID (TRK-XXX format) for each new registration |
| FR-20 | The system shall display a success notification and redirect to the patient records page after saving |
| FR-21 | The system shall provide a Clear Form button that resets all fields, validation states, and the photo preview |
| FR-22 | The Genotype field shall only accept valid haematological genotypes: AA, AS, SS, AC |

### 5.3 Patient Records

| ID | Requirement |
|---|---|
| FR-23 | The system shall display all registered patients in a tabular format |
| FR-24 | The system shall support live search filtering across patient name, ID, NIN, and department |
| FR-25 | The system shall provide dropdown filters for Department, Gender, and Status |
| FR-26 | The system shall display a result count showing how many records match the current filters |
| FR-27 | The system shall support sorting by any column (ascending and descending) with visual sort indicators |
| FR-28 | The system shall provide a Clear Filters button that resets all active filters |
| FR-29 | The system shall display an empty state message when no records match the current filters |
| FR-30 | The system shall allow users to view full patient details in a modal dialog |
| FR-31 | The system shall support exporting the currently filtered patient list as a CSV file |
| FR-32 | The CSV export shall include all patient fields and be named with the current date |

### 5.4 Patient Connection & ECG Monitoring

| ID | Requirement |
|---|---|
| FR-33 | The system shall allow users to connect to a patient by searching by name or Patient ID |
| FR-34 | The system shall display patient information in a side panel upon successful connection |
| FR-35 | The system shall display a live ECG waveform upon connection, rendered on an HTML5 canvas |
| FR-36 | The ECG waveform shall display a clinically realistic cardiac cycle including P wave, QRS complex, and T wave |
| FR-37 | The system shall display the following vital signs in real time: Temperature (°C), Heart Rate (bpm), SPO2 (%), Blood Pressure (mmHg), Respiration (breaths/min) |
| FR-38 | The system shall update vital signs at regular intervals to reflect live monitoring |
| FR-39 | The system shall provide controls to Pause, Resume, Save, and Stop the monitoring session |
| FR-40 | The system shall provide a UDP toggle control for wireless data transmission mode |
| FR-41 | The system shall display a LIVE status indicator that activates on connection and deactivates on disconnect |
| FR-42 | The system shall allow disconnection from a patient, clearing the ECG display and vital signs |
| FR-43 | The system shall send ECG signal data to the ML service and display the returned cardiac classification |
| FR-44 | The system shall display 12 ECG lead waveforms based on the ML model's output |
| FR-45 | The ML model shall classify the patient's cardiac condition into one of the following categories: Normal, Stable, Unstable, Chaotic, or Critical |

### 5.5 Navigation

| ID | Requirement |
|---|---|
| FR-46 | The system shall provide a persistent navigation bar accessible from all pages |
| FR-47 | The navigation bar shall highlight the currently active page |
| FR-48 | The navigation bar shall collapse into a hamburger menu on mobile screens |

---

## 6. Non-Functional Requirements

Non-functional requirements describe how well the system performs its functions.

### 6.1 Performance

| ID | Requirement |
|---|---|
| NFR-01 | The system shall load any page within 3 seconds on a standard broadband connection |
| NFR-02 | The live search shall filter and display results within 100 milliseconds of user input |
| NFR-03 | The ECG waveform animation shall maintain a smooth frame rate of at least 30 frames per second |
| NFR-04 | The ML model inference shall return a classification result within 2 seconds of receiving ECG data |

### 6.2 Usability

| ID | Requirement |
|---|---|
| NFR-05 | The system shall display inline error messages adjacent to invalid form fields without requiring page reload |
| NFR-06 | All form fields shall validate in real time as the user moves between fields |
| NFR-07 | The system shall display toast notifications for all major user actions (save, export, connect, error) |
| NFR-08 | The patient registration form shall scroll automatically to the first invalid field on failed submission |
| NFR-09 | The system shall provide visual feedback (loading spinners, disabled buttons) during asynchronous operations |

### 6.3 Responsiveness

| ID | Requirement |
|---|---|
| NFR-10 | The system shall be fully functional on desktop screens (1024px and above) |
| NFR-11 | The system shall adapt its layout for tablet screens (768px to 1023px) |
| NFR-12 | The system shall provide a usable mobile experience on screens below 768px |
| NFR-13 | The patient registration form shall stack to a single column on mobile screens |
| NFR-14 | The navigation bar shall collapse to a hamburger menu on screens below 992px |

### 6.4 Security

| ID | Requirement |
|---|---|
| NFR-15 | The system shall authenticate all API requests using JSON Web Tokens (JWT) |
| NFR-16 | JWT tokens shall have a defined expiry period and be invalidated on logout |
| NFR-17 | All user-generated content rendered in the interface shall be escaped to prevent XSS attacks |
| NFR-18 | Passwords shall never be stored or transmitted in plain text |
| NFR-19 | The system shall enforce HTTPS for all communications in production |

### 6.5 Reliability

| ID | Requirement |
|---|---|
| NFR-20 | The system shall handle API errors gracefully and display user-friendly error messages rather than raw error codes |
| NFR-21 | The ECG monitoring page shall degrade gracefully if the ML service is unavailable, displaying the waveform without classification |
| NFR-22 | The system shall preserve partially completed patient registration data in the event of a network interruption |

### 6.6 Maintainability

| ID | Requirement |
|---|---|
| NFR-23 | The frontend, backend, and ML service shall be developed as independent deployable units |
| NFR-24 | All JavaScript functions shall include a descriptive comment explaining their purpose |
| NFR-25 | The codebase shall follow consistent naming conventions throughout |
| NFR-26 | The system shall use environment variables for all configuration values (database credentials, API URLs, JWT secrets) |

### 6.7 Compatibility

| ID | Requirement |
|---|---|
| NFR-27 | The system shall be compatible with the latest versions of Chrome, Firefox, Edge, and Safari |
| NFR-28 | The system shall not require any browser plugins or extensions to function |
| NFR-29 | The CSV export feature shall produce files compatible with Microsoft Excel and Google Sheets |

---

## 7. System Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│               CLIENT (Browser)                       │
│   HTML5 + CSS3 + Bootstrap 5 + Vanilla JavaScript   │
│   Deployed on Vercel                                 │
└──────────────────┬──────────────────────────────────┘
                   │ HTTPS + JWT
                   ▼
┌─────────────────────────────────────────────────────┐
│          BACKEND (Java Spring Boot)                  │
│   REST API — Patient CRUD, Auth, ECG relay           │
│   Spring Security + JPA + PostgreSQL                 │
└──────────────────┬──────────────────────────────────┘
                   │ Internal HTTP
                   ▼
┌─────────────────────────────────────────────────────┐
│         ML SERVICE (Python FastAPI)                  │
│   ECG Signal Analysis — 1D CNN / LSTM Model         │
│   Dataset: MIT-BIH Arrhythmia Database              │
│   Output: Classification + 12-lead signal values    │
└─────────────────────────────────────────────────────┘
```

---

## 8. Constraints

- The system must function without requiring patients or staff to install any software
- The frontend must be accessible from any device with a modern web browser
- The ML model must be trained on publicly available, ethically sourced ECG data
- All patient data handling must comply with applicable data protection regulations

---

## 9. Assumptions

- Users have a stable internet connection sufficient for real-time data transmission
- ECG signal data is transmitted from hardware sensors to the system via UDP protocol
- The system will be deployed in a hospital or clinical environment with controlled network access
- An administrator will manage user account creation outside the self-registration flow

---

*Document prepared for CMS 418 — Rivers State University*
*System: Trackit — Wireless Emergency Telemedicine System*
