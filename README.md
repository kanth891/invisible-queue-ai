# Invisible Queue AI — Smart Hospital Queue Management & Waiting-Time Prediction System

> An intelligent, real-time healthcare queue management and machine-learning waiting-time prediction platform that eliminates physical hospital waiting lines, relieves outpatient congestion, and empowers patients with live queue synchronization on their personal devices.

---

## Overview

**Invisible Queue AI** transforms the traditional hospital outpatient consultation experience. In standard hospital waiting rooms, patients are forced to remain physically tethered to crowded corridors and consultation waiting areas due to lack of visibility into actual queue progression and doctor consultation pacing.

Invisible Queue AI introduces a digital "invisible queue" model:
1. Patients register at hospital reception and receive a digital token along with a cryptographically secure, private tracking link and QR code.
2. Patients track their live queue position, estimated waiting time, and consultation status remotely on their mobile devices from hospital cafeterias, gardens, or nearby spaces.
3. Machine-learning models predict dynamic waiting times based on real-time queue length, doctor historical consultation speed, department specialty, and arrival dynamics.
4. Real-time bi-directional WebSockets (Socket.IO) notify patients when their turn is approaching and summon them when their token is called.
5. Clinical dashboards give receptionists, doctors, and hospital administrators real-time control, automated status progression, and operational telemetry.

---

## Problem Statement

Traditional outpatient department (OPD) queueing systems suffer from structural inefficiencies:
- **Corridor Crowding & Infection Risk**: Hundreds of patients and companions crowd tight waiting areas, increasing airborne transmission and environmental stress.
- **Unpredictable Waiting Times**: Static estimation rules (e.g., standard 10 minutes per patient) fail because different clinical specialties and physicians exhibit widely varying consultation distributions.
- **Lost Productivity & Anxiety**: Patients experience high anxiety because leaving the immediate room perimeter risks missing their turn.
- **Administrative Blind Spots**: Clinical administrators lack live telemetry on actual patient delays, department bottlenecks, doctor utilization, and no-show patterns.

---

## Solution

Invisible Queue AI decouples physical presence from queue position:
- **Virtual Queuing**: Secure token generation enables remote waiting with zero proprietary mobile app installation (pure responsive web application).
- **Intelligent Waiting-Time Prediction**: A dedicated Python/FastAPI microservice trained on empirical healthcare queueing data provides bounded estimation ranges with median fallback baselines.
- **Automated Pacing & Push Alerts**: Real-time Socket.IO synchronization provides push alerts for "Turn Approaching" (configurable threshold) and "Turn Called" with native browser notification support.
- **Clinical Governance**: Role-based portals for Receptionists (intake & triage), Doctors (one-click queue progression & patient status management), and Administrators (analytics, staff management, and ML accuracy tracking).

---

## Key Features

- **Decentralized Outpatient Tracking**: Mobile-first digital pass accessible via 128-bit cryptographic tokens with zero sensitive patient PII exposed on public routes.
- **Machine Learning Wait Estimation**: Gradient Boosting Regressor model evaluated across 10 temporal and clinical features, delivering bounded confidence intervals (e.g., `18–25 min`).
- **Real-Time Synchronization**: Bi-directional Socket.IO architecture with room isolation (`patient:{token}`, `doctor:{id}`, `admin`) and automatic REST fallback upon reconnection.
- **Idempotent Notification Engine**: Web Notification API and in-app toasts with client and server timestamp deduplication, preventing notification spam.
- **Strict Clinical State Machine**: Server-side transition validation enforcing legal workflow sequences (`WAITING -> CALLED -> IN_CONSULTATION -> COMPLETED / NO_SHOW / CANCELLED`).
- **Real Operational Telemetry**: Automated calculation of actual waiting minutes, consultation duration, and prediction error stored for continuous retraining.
- **Fully Responsive Clinical Design System**: Validated across 18 viewports (320px mobile to 1920px desktop) with minimum 44px touch targets and clinical typography.

---

## User Roles

| Role | Access Level | Primary Responsibilities |
|---|---|---|
| **Patient** | Public / Secure Link | Remote queue tracking, viewing current serving token, position ahead, estimated wait time, receiving approaching alerts and turn call. |
| **Receptionist** | Authenticated (`RECEPTIONIST`) | Patient intake registration, token generation, printable pass creation, QR code generation, queue monitoring, and token cancellation. |
| **Doctor** | Authenticated (`DOCTOR`) | Calling next waiting patient, starting consultation, completing consultation, recording no-shows, and reviewing assigned room queue. |
| **Administrator** | Authenticated (`ADMIN`) | Hospital-wide queue telemetry, department management, doctor assignment, system user management, and ML model performance metrics. |

---

## System Workflow

```
[ Patient Arrives at Reception ]
               │
               ▼
[ Receptionist Registers Patient ] ──► System Generates Token (e.g., GM-004) & 128-bit Access Token
               │
               ├──► Printed Thermal Slip or QR Code Scanned
               │
               ▼
[ Patient Leaves Waiting Room ] ────► Opens Secure Pass on Mobile Browser
               │                      • Sees: Current Serving, Position Ahead, AI Wait Range
               │                      • Opts in to Live Device Alerts
               │
[ Doctor Completes Preceding Patient ]
               │
               ├──► Queue Recalculates Dynamics Across All Connected Clients
               ├──► ML Microservice Recalculates Wait Estimation Range
               │
[ Threshold Reached (e.g., 2 Ahead) ]
               │
               ▼
[ Approaching Turn Notification Dispatched to Patient Device ]
               │
               ├──► Patient Makes Way Back to Consultation Room
               │
[ Doctor Clicks 'Call Next Patient' ]
               │
               ▼
[ Real-Time 'Your Turn' Alert Rings on Patient Device ]
               │
               ▼
[ Doctor Clicks 'Start Consultation' ] ──► System Records consultation_started_at & actual_wait_minutes
               │
               ▼
[ Doctor Clicks 'Complete Consultation' ] ──► System Records consultation_completed_at & duration
               │
               ▼
[ Telemetry Logged to Database ] ────────► Admin Dashboard Analytics Updated in Real Time
```

---

## Architecture

The platform follows a decoupled, three-tier microservice architecture:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              CLIENT TIER                                │
│  React 19 + Vite 8 SPA                                                  │
│  • Patient Digital Pass (/queue/:accessToken)                           │
│  • Clinical Receptionist Console (/receptionist)                        │
│  • Doctor Consultation Room (/doctor)                                   │
│  • Administrator Management & Analytics Portal (/admin)                 │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ HTTP/REST + WebSocket (Socket.IO)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                             BACKEND TIER                                │
│  Node.js (v20+) + Express.js API Gateway & WebSocket Server             │
│  • JWT Authentication & Role Authorization Middleware                   │
│  • Queue State Machine & Transition Guards                              │
│  • Real-Time Room Router (patient, doctor, department, admin)           │
│  • Operational Telemetry & Duration Analytics Engine                    │
│  • ML Microservice HTTP Orchestrator (with Circuit Fallback)            │
└──────────────────────┬──────────────────────────────────┬───────────────┘
                       │ SQL                              │ HTTP (JSON)
                       ▼                                  ▼
┌───────────────────────────────────────┐  ┌──────────────────────────────┐
│            DATABASE TIER              │  │        ML MICROSERVICE       │
│  PostgreSQL (Supabase Cloud)          │  │  Python 3.12 + FastAPI       │
│  • users, departments, doctors        │  │  • Gradient Boosting Model   │
│  • patients, queue_entries            │  │  • Scikit-Learn Pipeline     │
│  • predictions (audit log)            │  │  • Historical Median Fallback│
└───────────────────────────────────────┘  └──────────────────────────────┘
```

---

## Technology Stack

### Frontend
- **Framework**: React 19 (React Router v7)
- **Build Tool**: Vite 8
- **Styling**: Vanilla CSS Design Tokens (Apollo Clinical Design System)
- **Real-Time Client**: Socket.IO Client v4
- **QR Generation**: QRCode.react

### Backend
- **Runtime**: Node.js v20 LTS
- **Framework**: Express.js v4
- **Real-Time Engine**: Socket.IO v4
- **Database Driver**: pg (node-postgres with connection pooling)
- **Security**: Helmet, CORS, Bcryptjs, JSONWebToken (JWT)

### Machine Learning Microservice
- **Framework**: Python 3.12 / 3.14 + FastAPI + Uvicorn
- **ML Libraries**: Scikit-Learn, NumPy, Pandas, Joblib
- **Data Validation**: Pydantic v2
- **Testing**: Pytest, Starlette TestClient

### Infrastructure & Database
- **Database**: PostgreSQL 15 (Supabase Cloud)
- **Containers**: Docker & Multi-stage Dockerfiles
- **Testing**: Node Test Runner, Puppeteer Core, Pytest

---

## Project Structure

```
invisible-queue-ai/
├── backend/
│   ├── src/
│   │   ├── app.js                 # Express server & socket initialization
│   │   ├── db/
│   │   │   ├── index.js           # PostgreSQL connection pool
│   │   │   ├── migrate.js         # DDL schema runner & demo seed script
│   │   │   └── autoMigrate.js     # Runtime schema verification
│   │   ├── middleware/
│   │   │   ├── auth.js            # JWT role-based access control
│   │   │   └── errorHandler.js    # Structured API error responses
│   │   ├── routes/
│   │   │   ├── auth.js            # Staff authentication
│   │   │   ├── departments.js     # Department CRUD
│   │   │   ├── doctors.js         # Doctor profiles & assignments
│   │   │   ├── patients.js        # Patient intake records
│   │   │   ├── queue.js           # Queue lifecycle & public pass access
│   │   │   ├── users.js           # Staff account administration
│   │   │   └── analytics.js       # Live department status & KPI overview
│   │   ├── services/
│   │   │   └── mlClient.js        # Resilient HTTP client for ML service
│   │   └── socket/
│   │       └── index.js           # Socket.IO rooms, events & security
│   ├── tests/
│   │   ├── api.test.js            # REST API integration tests
│   │   ├── e2e-server.js          # In-memory mock server for offline QA
│   │   ├── e2e-workflow.test.js   # Complete multi-role lifecycle test
│   │   ├── phase2.test.js         # Virtual queue & security tests
│   │   ├── phase3.test.js         # ML integration & benchmark tests
│   │   ├── phase3-multi-queue-simulation.test.js # 14-patient simulation
│   │   └── phase4.test.js         # Real-time Socket.IO & analytics tests
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.css                # Clinical SaaS layout & components
│   │   ├── App.jsx                # Route declarations & role guards
│   │   ├── index.css              # CSS custom properties & design tokens
│   │   ├── components/
│   │   │   └── Icons.jsx          # SVG icon library
│   │   ├── context/
│   │   │   ├── AuthContext.jsx    # Session management & token storage
│   │   │   └── NotificationContext.jsx # Toast & Web Notification manager
│   │   ├── layouts/
│   │   │   └── DashboardLayout.jsx# Top header & mobile navigation drawer
│   │   ├── pages/
│   │   │   ├── admin/             # Analytics, departments, staff portals
│   │   │   ├── auth/              # Professional staff login portal
│   │   │   ├── doctor/            # Consultation desk & patient call queue
│   │   │   ├── patient/           # Public mobile pass & live status
│   │   │   └── receptionist/      # Intake, token issuance, slip printing
│   │   └── services/
│   │       ├── api.js             # Axios-free Fetch API client
│   │       └── socket.js          # Socket.IO connection & listener manager
│   └── package.json
├── ml-service/
│   ├── app/
│   │   ├── main.py                # FastAPI endpoints & CORS
│   │   ├── schemas.py             # Pydantic input/output schemas
│   │   └── services/
│   │       └── predictor.py       # Scikit-learn inference & baseline fallback
│   ├── data/
│   │   ├── generate_dataset.py    # Synthetic hospital dataset generator
│   │   └── synthetic_training_data.csv # 5,000 historical consultations
│   ├── models/
│   │   ├── waiting_time_model.joblib # Serialized Gradient Boosting model
│   │   └── metrics.json           # Model validation metrics & weights
│   ├── tests/
│   │   └── test_ml.py             # Pytest endpoint validation suite
│   ├── train.py                   # Model training & benchmark script
│   ├── Dockerfile
│   └── requirements.txt
├── scripts/
│   └── audit_responsive.js        # Automated 18-viewport Puppeteer auditor
├── .env.example
├── docker-compose.yml
└── README.md
```

---

## Phase-wise Development

### Phase 0 — Cloud Infrastructure & CI/CD Pipeline
- Containerized environments with Docker and Docker Compose.
- Automated GitHub Actions CI workflow covering linting, builds, and automated unit tests.
- Cloud database deployment on Supabase PostgreSQL.

### Phase 1 — Hospital Queue Foundation & Authentication
- Relational schema covering users, departments, doctors, patients, and queue entries.
- Role-Based Access Control (RBAC) with JWT tokens for Admins, Doctors, and Receptionists.
- Core queue generation and sequential progression APIs.

### Phase 2 — Virtual Queue & Cryptographic Patient Pass
- Token generation with 128-bit cryptographic hex entropy (`queue_access_token`).
- Dedicated mobile-friendly outpatient pass route (`/queue/:accessToken`) with zero login requirements.
- Zero PII exposure on public tracking endpoints (no patient phone numbers, names, or internal IDs).

### Phase 3 — Intelligent Waiting-Time Prediction
- Python/FastAPI microservice trained on 5,000 empirical healthcare consultation records.
- Benchmark comparison of four algorithms: Historical Median Baseline, Ridge Regression, Random Forest, and Gradient Boosting Regressor.
- Dynamic waiting-time estimation with upper and lower bound confidence intervals.

### Phase 4 — Real-Time Intelligent Queue Management
- Bi-directional WebSockets (Socket.IO v4) with strict room isolation.
- Push alerts for approaching turns (`patientsAhead <= 2`) and turn arrival.
- State machine enforcement preventing out-of-order queue jumps.
- Operational hospital telemetry tracking actual waiting times and consultation durations.
- Live administrative analytics and department operational summaries.

---

## AI Waiting-Time Prediction

### Training Dataset & Clinical Features
The prediction engine utilizes a dataset of 5,000 consultation records across four medical specialties (General Medicine, Cardiology, Pediatrics, and Orthopedics). Features strictly exclude post-arrival future information to prevent temporal data leakage:

1. `token_position`: Sequential position in the daily intake line.
2. `patients_ahead`: Number of patients currently waiting ahead of this token.
3. `hour_of_day`: Arrival hour (capturing OPD peak periods, 9:00 AM – 1:00 PM).
4. `day_of_week`: Day of the week (capturing weekday load shifts).
5. `department_id`: Medical specialty identifier.
6. `doctor_id`: Physician identifier.
7. `doctor_avg_duration`: Historical median consultation duration for the assigned doctor.
8. `dept_avg_duration`: Specialty-wide median consultation duration.
9. `patient_age`: Patient age group.
10. `queue_length_at_arrival`: Total active load across the department at arrival time.

### Model Benchmarks
Four model architectures were trained and evaluated on an independent test split (80/20 train-test split):

| Model Architecture | Mean Absolute Error (MAE) | Root Mean Squared Error (RMSE) | R-squared (R²) |
|---|---|---|---|
| **Baseline (Department/Doctor Median)** | 8.89 min | 12.77 min | 0.9150 |
| **Linear Regression (Ridge)** | 9.89 min | 12.76 min | 0.9151 |
| **Random Forest Regressor** | 8.46 min | 10.95 min | 0.9375 |
| **Gradient Boosting Regressor (Selected)** | **7.92 min** | **10.20 min** | **0.9458** |

### Feature Importance Weights
Inference analysis reveals the key factors driving outpatient delay:
- `token_position`: 53.5%
- `patients_ahead`: 25.9%
- `doctor_avg_duration`: 18.5%
- `doctor_id`: 1.1%
- `hour_of_day` & others: < 1.0%

### Fallback Baseline Resilience
If the ML microservice is unreachable, the Node.js backend automatically applies an in-process heuristic:
$$\text{Estimated Wait} = \max(2, \text{patientsAhead} \times \text{doctorAvgDuration})$$
The returned payload flags `is_fallback: true` so the UI transparently notes: `Model: Historical Median Baseline`.

---

## Real-Time Queue Management

### Socket.IO Room Security
To protect patient privacy, sockets are segregated into dedicated communication channels:
- `patient:{queueAccessToken}`: Restricted to the individual token holder. Receives only position updates and turn calls.
- `doctor:{doctorId}`: Delivers updates for the doctor's active consultation line.
- `department:{departmentId}`: Aggregates departmental intake for front-desk operators.
- `admin`: Delivers hospital-wide operational summaries.

### Queue State Machine
Strict transition rules guarantee data integrity:

```
WAITING ──────► CALLED ──────► IN_CONSULTATION ──────► COMPLETED
   │               │
   ├───────────────┼─────────► NO_SHOW
   │
   └─────────────────────────► CANCELLED
```

Attempts to transition from `COMPLETED` back to `IN_CONSULTATION` or skip `CALLED` directly to `COMPLETED` are rejected with `400 Bad Request`.

---

## Notifications

Invisible Queue AI supports multi-channel notification dispatch:
1. **In-App Toast Alerts**: High-visibility clinical alerts styled according to priority (Info, Warning, Turn Call).
2. **Web Notifications API**: Native operating-system-level alerts that sound and display even when the patient minimizes the browser or locks their phone screen.
3. **Idempotency & Deduplication**: All notifications generate a deterministic deduplication key (`${accessToken}_APPROACHING`, `${accessToken}_TURN`). Sockets reconnecting after signal loss verify against dispatched keys to guarantee zero alert spam.

---

## Analytics

The Administrative Console provides live metrics derived from empirical consultation records:
- **Patients Served Today**: Real-time count of completed visits.
- **Average Waiting Time**: Elapsed minutes between ticket issuance and consultation start.
- **Average Consultation Duration**: Elapsed minutes between consultation start and completion.
- **Queue Volume & No-Show Rate**: Percentage of patients failing to appear when called.
- **Live Department Status**: Active vs. Idle departments with current serving tokens.
- **ML Model Telemetry**: Live Mean Absolute Error calculated from actual vs. predicted consultation times.

---

## Database Design

The relational database runs on PostgreSQL:

```sql
-- Departments
CREATE TABLE departments (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(10) UNIQUE NOT NULL,
    description TEXT,
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

-- Users (Staff)
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'RECEPTIONIST', 'DOCTOR')),
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

-- Doctors
CREATE TABLE doctors (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    department_id INT REFERENCES departments(id),
    specialization VARCHAR(100),
    avg_consultation_time INT DEFAULT 15,
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

-- Patients
CREATE TABLE patients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    age INT NOT NULL,
    gender VARCHAR(10) NOT NULL,
    phone VARCHAR(20) NOT NULL
);

-- Queue Entries
CREATE TABLE queue_entries (
    id SERIAL PRIMARY KEY,
    patient_id INT REFERENCES patients(id),
    doctor_id INT REFERENCES doctors(id),
    department_id INT REFERENCES departments(id),
    token_number VARCHAR(20) NOT NULL,
    queue_access_token VARCHAR(64) UNIQUE NOT NULL,
    queue_date DATE DEFAULT CURRENT_DATE,
    status VARCHAR(20) DEFAULT 'WAITING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    called_at TIMESTAMP,
    consultation_started_at TIMESTAMP,
    consultation_completed_at TIMESTAMP,
    actual_wait_minutes NUMERIC(6,2),
    consultation_duration_minutes NUMERIC(6,2),
    prediction_error_minutes NUMERIC(6,2),
    approaching_notified_at TIMESTAMP,
    turn_notified_at TIMESTAMP
);
```

---

## API Overview

### Authentication
- `POST /api/auth/login` — Authenticate staff member with email and password. Returns JWT token and user profile.
- `GET /api/auth/me` — Verify active session and retrieve authenticated profile.

### Public Virtual Queue
- `GET /api/queue/access/:accessToken` — Fetch public queue pass (token number, current serving, position ahead, approaching flag, estimated wait time). Zero authentication required.

### Queue Management
- `GET /api/queue` — List queue entries (filtered by department, doctor, or status).
- `POST /api/queue/token` — Issue digital token and generate secure 128-bit access pass.
- `GET /api/queue/doctor/:doctorId` — Fetch current room queue for assigned physician.
- `POST /api/queue/:id/call` — Advance token to `CALLED`. Emits real-time turn notification.
- `POST /api/queue/:id/start` — Advance token to `IN_CONSULTATION`. Logs start timestamp and calculates actual waiting duration.
- `POST /api/queue/:id/complete` — Advance token to `COMPLETED`. Logs completion timestamp and calculates visit duration.
- `POST /api/queue/:id/no-show` — Mark patient as `NO_SHOW`.
- `POST /api/queue/:id/cancel` — Cancel queue entry.

### Analytics & AI Telemetry
- `GET /api/analytics/overview` — Hospital-wide daily KPIs (served, average wait, duration, no-shows).
- `GET /api/analytics/live-status` — Real-time department load and active status.
- `GET /api/queue/stats` — Operational summary counts.
- `GET /api/queue/prediction-metrics` — Machine learning test benchmarks and feature weights.

---

## Real-Time Socket Events

| Event Name | Direction | Payload Details |
|---|---|---|
| `join:patient` | Client → Server | `{ accessToken }` — Subscribes client to private patient room. |
| `join:doctor` | Client → Server | `{ doctorId }` — Subscribes physician to room queue updates. |
| `join:admin` | Client → Server | Authenticated staff join operational analytics channel. |
| `queue.updated` | Server → All | Broadcast indicating queue shift; triggers client state reconciliation. |
| `queue.token_called` | Server → Patient/Doc | Sent to target patient socket when token is called. |
| `queue.consultation_started` | Server → Patient/Doc | Sent when consultation commences. |
| `queue.consultation_completed`| Server → Patient/Doc | Sent when visit is finalized. |
| `queue.patient_approaching` | Server → Patient | Dispatched when patient reaches approaching threshold. |
| `queue.patient_turn` | Server → Patient | High-priority your-turn alert payload. |
| `queue.wait_time_updated` | Server → Patient | Updated ML wait time estimation. |

---

## Security

1. **Cryptographic Entropy**: Public access passes use 128-bit hex tokens (`crypto.randomBytes(16).toString('hex')`) with $3.4 \times 10^{38}$ possible values, rendering brute-force enumeration impossible.
2. **Zero PII Leakage**: The public `/api/queue/access/:accessToken` endpoint returns strictly sanitized fields. Patient phone numbers, names, and internal foreign keys are withheld.
3. **Role-Based Guards**: Backend middleware enforces role authorization (`ADMIN`, `RECEPTIONIST`, `DOCTOR`). Staff endpoints reject unauthorized tokens with `403 Forbidden`.
4. **Socket Authorization**: Sockets authenticate via JWT handshakes or secure access token verification before admitting connections into clinical rooms.
5. **Sanitized Error Handling**: Internal database traces and connection strings are suppressed in production mode to avoid leaking environment topology.

---

## Responsive Design

The frontend adheres to strict clinical SaaS usability standards:
- **18 Viewport Verification**: Validated across all mobile devices (320px iPhone SE to 430px iPhone Pro Max), tablets (768px iPad to 1024px Landscape), and desktop monitors (1280px to 1920px FHD).
- **Zero Horizontal Overflow**: All screens pass automated assertions with zero horizontal scrolling.
- **Adaptive Tables**: Tables automatically transform into readable card lists on mobile viewports (< 768px).
- **Accessible Touch Targets**: All interactive buttons, form controls, and toggles provide minimum 44px $\times$ 44px tap targets.
- **Prevent Auto-Zoom**: Form inputs use 16px minimum font size, preventing iOS Safari auto-zoom issues.

---

## Installation

### Prerequisites
- Node.js (version 20 LTS or higher)
- Python (version 3.10 to 3.14)
- Git
- PostgreSQL or Supabase cloud account

### Clone Repository
```bash
git clone https://github.com/kanth891/invisible-queue-ai.git
cd invisible-queue-ai
```

### Install Backend Dependencies
```bash
cd backend
npm install
```

### Install Frontend Dependencies
```bash
cd ../frontend
npm install
```

### Install ML Service Dependencies
```bash
cd ../ml-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Application Configuration
NODE_ENV=development
PORT=5000

# Database Configuration (Supabase PostgreSQL)
DATABASE_URL=postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres

# Authentication
JWT_SECRET=your_jwt_secret_key_minimum_32_characters

# CORS & Client Origins
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173

# Machine Learning Service URL
ML_SERVICE_URL=http://localhost:8000

# Approaching Alert Threshold (Patients Ahead)
APPROACHING_THRESHOLD=2
```

---

## Local Development

### Running the ML Service
```bash
cd ml-service
source venv/bin/activate
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
*Health check: `http://localhost:8000/health`*

### Running the Backend
```bash
cd backend
npm run dev
```
*API Base: `http://localhost:5000`*

### Running the Frontend
```bash
cd frontend
npm run dev
```
*Application: `http://localhost:5173`*

---

## Database Setup

Run migrations and seed the initial hospital data:

```bash
cd backend
npm run migrate
```

### Default Demo Credentials

| Role | Email | Password |
|---|---|---|
| **Administrator** | `admin@hospital.com` | `admin123` |
| **Receptionist** | `receptionist1@hospital.com` | `recep123` |
| **Doctor (General Medicine)** | `dr.ravi@hospital.com` | `doctor123` |

---

## Testing

Execute all automated verification suites:

### 1. Backend & Real-Time Test Suite
```bash
cd backend
npm test
```
*Executes all 6 test suites covering Phase 2 cryptographic security, Phase 3 prediction algorithms, Phase 4 state machine validation, API endpoints, multi-client real-time synchronization, and complete multi-role simulations.*

### 2. Machine Learning Unit Tests
```bash
pytest ml-service/tests
```
*Validates prediction schemas, boundary validation, and fallback baseline logic.*

### 3. Responsive UI/UX Viewport Audit
```bash
node scripts/audit_responsive.js
```
*Runs an automated Puppeteer audit across 90 viewport combinations checking for zero horizontal scrolling and touch target accessibility.*

---

## Production Build

### Frontend Production Bundle
```bash
cd frontend
npm run build
```
Generates optimized assets inside `frontend/dist/`.

### Backend Verification
```bash
cd backend
npm start
```

---

## Deployment

### Recommended Cloud Topology
- **Frontend**: Deployed on Vercel with single-page application rewrite configuration.
- **Backend**: Deployed on Render (Node.js Web Service) with WebSockets enabled.
- **Database**: PostgreSQL hosted on Supabase Cloud.
- **ML Microservice**: Deployed on Render (Python Web Service) or containerized via Docker.

### Docker Deployment
Run all services using Docker Compose:
```bash
docker compose up --build -d
```

---

## Git Workflow

The project follows a phase-driven branch workflow:
- `main`: Production-ready release branch.
- `develop`: Ongoing integration branch.
- `phase-1-foundation`: Core hospital schema and authentication.
- `phase-2-virtual-queue`: Virtual queue and cryptographic pass.
- `phase-3-ai-prediction`: Python ML prediction microservice.
- `phase-4-realtime`: Real-time Socket.IO synchronization, analytics, and final product polish.

---

## Screens / Application Modules

1. **Staff Authentication Portal (`/login`)**: Clean, clinical authentication with one-click demo credentials for administrators, doctors, and receptionists.
2. **Outpatient Digital Pass (`/queue/:accessToken`)**: Patient-facing responsive pass with live sync indicator, serving token, position ahead, AI waiting-time range, and one-tap device alert activation.
3. **Receptionist Intake Console (`/receptionist`)**: Rapid patient intake, automatic token generation, printable thermal slips, and modal QR codes.
4. **Doctor Consultation Room (`/doctor`)**: Speed-optimized desk showing active patient, one-click consultation lifecycle controls (Call Next, Start, Complete, No-Show), and waiting queue list.
5. **Administrator Console (`/admin`)**: Operational dashboard with live department statuses, system KPI summaries, staff directories, and ML research benchmark telemetry.

---

## Research / Academic Context

This system was conceived and engineered as a **B.Tech Computer Science & Engineering Final Year Capstone Project**. It demonstrates the practical intersection of:
- **Operations Research**: Queuing theory (M/M/c queuing models) applied to clinical consultation environments.
- **Applied Machine Learning**: Supervised gradient boosting regression applied to temporal hospital consultation dynamics.
- **Distributed Real-Time Systems**: Event-driven WebSockets with room segregation and connection reconciliation.
- **Healthcare Informatics**: Patient privacy preservation and human-centered clinical UX design.

---

## Limitations

- **Historical Data Dependency**: Machine-learning prediction accuracy directly correlates with historical consultation data volume. In newly created departments with fewer than 3 completed consultations, the system transparently utilizes the department median baseline.
- **Browser Notification Permissions**: Remote alerts rely on the user granting notification permissions in their mobile browser. If denied, the application falls back to visual in-app badges and audio cues.
- **Network Disconnection**: Real-time push updates depend on active internet connectivity. In intermittent network scenarios, the client automatically performs REST reconciliation upon reconnection.

---

## Future Enhancements

- **SMS & WhatsApp Integration**: Native Twilio / WhatsApp Business messaging for patients without mobile internet access.
- **HL7 / FHIR Interoperability**: Seamless electronic medical record (EMR) intake integration with hospital information systems.
- **Automated Online Retraining**: Automated pipeline to periodically retrain Gradient Boosting weights as consultation records accumulate.
- **Multi-Hospital Federation**: Centralized multi-tenant administration for hospital chains with multi-campus routing.

---

## Project Status

| Phase | Milestone Description | Status |
|---|---|---|
| Phase 0 | Cloud Infrastructure & CI/CD Pipeline | Completed |
| Phase 1 | Hospital Core Queue & Role-Based Auth | Completed |
| Phase 2 | Virtual Invisible Queue & QR Pass | Completed |
| Phase 3 | AI Waiting-Time Prediction (Gradient Boosting) | Completed |
| Phase 4 | Real-Time Synchronization, Notifications & Analytics | Completed |
| Final Polish | Premium Healthcare UI/UX & Responsive QA Pass | Completed |

---

## License

This project is licensed under the MIT License. Built for healthcare operations research and clinical software engineering.
