# 🏥 Invisible Queue AI

> **Smart AI-powered hospital queue management system** that eliminates physical waiting lines through invisible virtual queuing, AI-driven wait-time predictions, and real-time patient notifications — enabling patients to wait comfortably anywhere while maintaining their place in the queue.

[![CI — Build & Validate](https://github.com/kanth891/invisible-queue-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/kanth891/invisible-queue-ai/actions/workflows/ci.yml)

**B.Tech CSE Final Year Project**

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────┐
│                  Client                       │
│              React.js (Vite)                  │
│          Deployed on Render                   │
└──────────────────┬───────────────────────────┘
                   │ HTTPS
                   ▼
┌──────────────────────────────────────────────┐
│              Backend API                      │
│          Express.js (Node.js)                 │
│          Deployed on Render                   │
└──────────┬───────────────────┬───────────────┘
           │                   │
           ▼                   ▼
┌──────────────────┐  ┌────────────────────────┐
│   PostgreSQL     │  │  ML Service (Phase 3)  │
│   (Supabase)     │  │  Python + FastAPI       │
└──────────────────┘  └────────────────────────┘
```

## 🛠️ Technology Stack

| Layer       | Technology                |
|-------------|---------------------------|
| Frontend    | React.js + Vite           |
| Backend     | Node.js + Express.js      |
| Database    | PostgreSQL (Supabase)     |
| ML Service  | Python + FastAPI (Phase 3)|
| Real-Time   | Socket.IO (Phase 4)       |
| Deployment  | Render (Frontend + Backend)|
| CI/CD       | GitHub Actions            |
| Containers  | Docker + Docker Compose   |

---

## 🚀 Local Setup

### Prerequisites

- **Node.js** ≥ 20.x
- **npm** ≥ 10.x
- **Git**
- **Docker** (optional, for containerized development)

### Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/kanth891/invisible-queue-ai.git
cd invisible-queue-ai

# 2. Run setup script
bash scripts/setup.sh

# 3. Configure environment variables
#    Edit .env with your Supabase DATABASE_URL
nano .env

# 4. Start development servers
npm run dev
```

### Manual Setup

```bash
# Install all dependencies
npm run install:all

# Start backend (port 5000)
cd backend && npm run dev

# Start frontend (port 5173) — in another terminal
cd frontend && npm run dev
```

### Docker

```bash
# Build and run all services
docker compose up --build

# Stop services
docker compose down
```

---

## 🔐 Environment Variables

Create a `.env` file in the project root by copying `.env.example`:

```bash
cp .env.example .env
```

| Variable       | Description                              | Required |
|----------------|------------------------------------------|----------|
| `NODE_ENV`     | Environment (`development` / `production`) | Yes    |
| `PORT`         | Backend server port (default: 5000)      | Yes      |
| `DATABASE_URL` | Supabase PostgreSQL connection string    | Yes      |
| `JWT_SECRET`   | Secret key for JWT token signing         | Yes      |
| `FRONTEND_URL` | Frontend URL for CORS                    | Yes      |
| `API_URL`      | Backend API URL                          | Yes      |
| `CORS_ORIGIN`  | Allowed CORS origins (comma-separated)   | Yes      |

> ⚠️ **Never commit `.env` to version control.** The `.gitignore` is configured to prevent this.

---

## 🌿 Git Workflow

We follow a structured branching strategy:

```
feature/your-feature
        ↓
    develop          ← active development
        ↓
    testing          ← pre-release validation
        ↓
      main           ← production deployments
```

### Branch Naming

| Branch Pattern             | Purpose                    |
|----------------------------|----------------------------|
| `main`                     | Production-ready code      |
| `develop`                  | Active development         |
| `phase-1-foundation`       | Phase 1 features           |
| `phase-2-virtual-queue`    | Phase 2 features           |
| `phase-3-ai`               | Phase 3 ML integration     |
| `phase-4-realtime`         | Phase 4 real-time features |

---

## 🌐 Deployment

### Frontend → Render (Static Site)

- **Auto-deploys** from `main` branch
- **Root Directory**: `frontend`
- **Build Command**: `npm install && npm run build`
- **Publish Directory**: `dist`
- **Environment Variable**: `VITE_API_URL` → Backend URL

### Backend → Render (Web Service)

- **Auto-deploys** from `main` branch
- **Root Directory**: `backend`
- **Build Command**: `npm install`
- **Start Command**: `node src/app.js`
- **Health Check**: `GET /api/health`
- **Environment Variables**: Set via Render Dashboard

### Database → Supabase

- **Cloud PostgreSQL** — no self-hosting required
- **Connection**: via `DATABASE_URL` environment variable

### Production URLs

| Service  | URL |
|----------|-----|
| Frontend | https://invisible-queue-ai-frontend.onrender.com |
| Backend  | https://invisible-queue-ai.onrender.com |

---

## 📋 API Endpoints

### Infrastructure

| Method | Endpoint       | Description                       |
|--------|----------------|-----------------------------------|
| GET    | `/`            | API information                   |
| GET    | `/api/health`  | Health check with DB status       |

*More endpoints will be added in Phase 1+.*

---

## 🗺️ Development Phases

| Phase | Name                        | Status      |
|-------|-----------------------------|-------------|
| 0     | Infrastructure Setup        | ✅ Complete |
| 1     | Hospital Queue Foundation   | 🔜 Next     |
| 2     | Virtual / Invisible Queue   | ⏳ Planned  |
| 3     | AI Waiting-Time Prediction  | ⏳ Planned  |
| 4     | Real-Time Updates & Analytics| ⏳ Planned |

---

## 📁 Project Structure

```
invisible-queue-ai/
├── frontend/                # React.js (Vite) frontend
│   ├── src/
│   │   ├── App.jsx         # Main application component
│   │   ├── App.css         # Component styles
│   │   ├── index.css       # Global styles & design tokens
│   │   └── main.jsx        # React entry point
│   ├── public/             # Static assets
│   ├── Dockerfile
│   └── package.json
│
├── backend/                 # Express.js backend API
│   ├── src/
│   │   ├── app.js          # Application entry point
│   │   ├── config/         # Environment configuration
│   │   ├── controllers/    # Route handlers
│   │   ├── db/             # Database connection
│   │   ├── middleware/     # Express middleware
│   │   ├── routes/         # API routes
│   │   └── services/       # Business logic
│   ├── Dockerfile
│   └── package.json
│
├── ml-service/              # Python ML service (Phase 3)
│   ├── README.md
│   └── requirements.txt
│
├── docs/                    # Project documentation
├── scripts/                 # Helper scripts
│
├── .github/workflows/       # CI/CD pipelines
├── .env.example             # Environment variables template
├── docker-compose.yml       # Local Docker setup
└── README.md
```

---

## 📝 License

MIT

---

*Built as a B.Tech CSE Final Year Project — 2026*
