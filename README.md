# 🏥 Invisible Queue AI

> **Smart AI-powered hospital queue management system** that eliminates physical waiting lines through invisible virtual queuing, AI-driven wait-time predictions, and real-time patient notifications — enabling patients to wait comfortably anywhere while maintaining their place in the queue.

[![CI — Build & Validate](https://github.com/kanth891/invisible-queue-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/kanth891/invisible-queue-ai/actions/workflows/ci.yml)

**B.Tech CSE Final Year Project**

---

## 🏗️ Architecture

```
                    ┌──────────────────────────────────────────────┐
                    │               React Frontend                 │
                    │   • Patient Virtual Pass  • Doctor Desk      │
                    │   • Receptionist Console  • Admin Analytics  │
                    └──────────────────────┬───────────────────────┘
                                           │ REST API + Socket.IO (WSS)
                                           ▼
                    ┌──────────────────────────────────────────────┐
                    │           Node / Express Backend             │
                    │   • State Machine         • Room Router      │
                    │   • JWT & Token Security  • Socket Server    │
                    │   • ML Client Orchestrator                   │
                    └──────────────┬────────────────┬──────────────┘
                                   │                │
                                   ▼                ▼
                    ┌──────────────────────┐  ┌────────────────────────┐
                    │ PostgreSQL Database  │  │   Python ML Service    │
                    │ (Supabase Cloud)     │  │   (FastAPI / Scikit)   │
                    │ • Telemetry Tracking │  │ • Gradient Boosting    │
                    │ • Queue Entries      │  │ • 94.6% Accuracy / MAE │
                    │ • Prediction Audits  │  │ • Baseline Fallback    │
                    └──────────────────────┘  └────────────────────────┘
```

## 🛠️ Technology Stack

| Layer       | Technology | Role |
|-------------|------------|------|
| Frontend    | React.js (Vite) + Tailwind CSS | Responsive dashboards, live connection badges, toasts |
| Backend     | Node.js + Express.js | Authoritative REST API, State Machine, Telemetry |
| Real-Time   | Socket.IO v4 | Instant bi-directional synchronization and room isolation |
| Database    | PostgreSQL (Supabase Cloud) | Normalized persistence, telemetry & audit indices |
| ML Service  | Python 3.12 + FastAPI + Scikit-Learn | Wait-time prediction (Gradient Boosting Regressor) |
| Notifications| Web Notifications API + In-App Toasts | Idempotent approaching and your-turn alerts |
| Containers  | Docker & Docker Compose | Multi-container local orchestration |
| Testing     | Node Test Suites & Puppeteer E2E | Phase 2, Phase 3, Phase 4 & Responsive UI audits |

---

## ⚡ Phase 4 — Real-Time Intelligent Queue Management

Phase 4 elevates Invisible Queue AI into an autonomous, real-time virtual hospital queue:

### 1. Socket.IO Room-Based Architecture
To ensure zero data leaks between waiting patients, Socket.IO uses strict room segmentation:
- `patient:{queueAccessToken}`: Cryptographically restricted room receiving ONLY that patient's status, dynamic queue position, and predictions.
- `doctor:{doctorId}`: Delivers incoming queue updates, called patient info, and consultation workflows.
- `department:{departmentId}`: Aggregates department-wide queue shifts for desk staff.
- `admin`: Broadcasts hospital-wide queue volumes and live department statuses.

### 2. Standardized Real-Time Event Catalog
| Event | Direction | Trigger / Payload |
|---|---|---|
| `queue.updated` | Server → All | Queue shift occurred; triggers client reconciliation |
| `queue.token_called` | Server → Patient/Doc | Doctor calls token; contains token, doc name, room |
| `queue.consultation_started` | Server → Patient/Doc | Patient enters room; logs consultation start time |
| `queue.consultation_completed`| Server → Patient/Doc | Doctor completes visit; records telemetry & durations |
| `queue.patient_no_show` | Server → Room | Patient failed to appear; removes from active line |
| `queue.patient_cancelled` | Server → Room | Ticket cancelled by patient or desk |
| `queue.wait_time_updated` | Server → Patient | ML-computed waiting-time range update |
| `queue.patient_approaching` | Server → Patient | Triggered when `patientsAhead <= APPROACHING_THRESHOLD` (default 2) |
| `queue.patient_turn` | Server → Patient | High-priority your-turn call with audible/visual alert |
| `notification.created` | Server → Client | Generic in-app notification payload |

### 3. Queue State Machine
Strict server-side validation enforces sequential patient progressions and prohibits illegal skips:
```
WAITING ──────► CALLED ──────► IN_CONSULTATION ──────► COMPLETED (Terminal)
   │               │
   ├───────────────┼─────────► NO_SHOW (Terminal)
   │
   └─────────────────────────► CANCELLED (Terminal)
```
- **Prohibited transitions**: `COMPLETED -> WAITING`, `NO_SHOW -> IN_CONSULTATION`, `CANCELLED -> COMPLETED`.
- Invalid status updates are rejected with `400 Bad Request`.

### 4. Dynamic Queue Calculation & Privacy
- Waiting position and `patientsAhead` are computed dynamically from active entries created before the target token.
- No public API or socket event exposes full names, phone numbers, or database IDs of other patients.
- Patients receive only: `token`, `status`, `currentToken`, `patientsAhead`, `position`, and `predictedWaitRange`.

### 5. Idempotent Patient Notification System
- **Approaching Alert**: Dispatched once when `patientsAhead <= 2`. Stamped with `approaching_notified_at`.
- **Your Turn Alert**: Dispatched upon doctor calling token. Stamped with `turn_notified_at`.
- Both in-app toasts and browser Web Notification API alerts check client-side deduplication keys so repeated socket reconnects never spam the patient.

### 6. Real ML Telemetry & Hospital Analytics
- On `IN_CONSULTATION`, backend computes:
  $$\text{actual\_wait\_minutes} = \frac{\text{consultation\_started\_at} - \text{created\_at}}{60000}$$
  $$\text{prediction\_error\_minutes} = |\text{predicted\_wait\_minutes} - \text{actual\_wait\_minutes}|$$
- On `COMPLETED`, backend computes:
  $$\text{consultation\_duration\_minutes} = \frac{\text{completed\_at} - \text{consultation\_started\_at}}{60000}$$
- **Admin Analytics Dashboard** (`/api/analytics/overview` and `/api/analytics/live-status`):
  - Real metrics: Patients served today, average wait time, average consultation duration, no-shows, cancellations, model MAE.
  - Zero fake numbers: Displays "Collecting more consultation telemetry..." if historical sample size is too low (< 3).

---

## 🚀 Local Setup

### Prerequisites

- **Node.js** ≥ 20.x
- **Python** ≥ 3.10
- **npm** ≥ 10.x
- **Git**

### Quick Start

```bash
# 1. Clone repository & install dependencies
git clone https://github.com/kanth891/invisible-queue-ai.git
cd invisible-queue-ai
npm run install:all

# 2. Configure .env
cp .env.example .env

# 3. Start Python ML Service (port 8000)
cd ml-service
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &

# 4. Start Node.js Backend with Socket.IO (port 5000)
cd ../backend
npm run dev &

# 5. Start Vite React Frontend (port 5173)
cd ../frontend
npm run dev
```

---

## 🧪 Testing & Verification

Run the comprehensive test suites:

```bash
# Run all backend & real-time test suites (Phases 2, 3, and 4)
cd backend
npm test

# Run End-to-End Multi-Client Phase 4 Simulation
node ../scripts/test_phase4_e2e.js

# Run Full Viewport Responsive Audit (320px to 1920px)
node ../scripts/audit_responsive.js
```

---

## 🔐 Environment Variables

| Variable | Description | Default |
|---|---|---|
| `PORT` | Backend server port | `5000` |
| `DATABASE_URL` | Supabase PostgreSQL URI | *(Required)* |
| `JWT_SECRET` | Secret key for JWT staff tokens | *(Required)* |
| `FRONTEND_URL` | Allowed frontend origin for CORS | `http://localhost:5173` |
| `ML_SERVICE_URL`| Python FastAPI ML service URL | `http://localhost:8000` |
| `APPROACHING_THRESHOLD` | Number of patients ahead triggering approaching alert | `2` |
| `VITE_SOCKET_URL` | Frontend Socket.IO connection target | `http://localhost:5000` |

---

## 🗺️ Project Status

| Phase | Milestone | Status |
|---|---|---|
| 0 | Cloud Infrastructure & CI/CD Pipeline | ✅ Complete |
| 1 | Hospital Core Queue & Role-Based Auth | ✅ Complete |
| 2 | Virtual Invisible Queue & QR Pass | ✅ Complete |
| 3 | AI Waiting-Time Prediction (Gradient Boosting) | ✅ Complete |
| 4 | Real-Time Synchronization, Notifications & Analytics | ✅ Complete |

---

## 📝 License
MIT License — Built as a B.Tech CSE Final Year Project (2026).

