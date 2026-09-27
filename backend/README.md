# Invisible Queue AI — Backend

Express.js API server for the Invisible Queue AI hospital management system.

## Quick Start

```bash
# Install dependencies
npm install

# Create local environment file
cp ../.env.example .env
# Edit .env with your Supabase DATABASE_URL

# Development (with hot-reload)
npm run dev

# Production
npm start
```

## API Endpoints

| Method | Endpoint       | Description          |
|--------|----------------|----------------------|
| GET    | `/`            | API info             |
| GET    | `/api/health`  | Health check + DB    |

## Project Structure

```
src/
├── app.js              # Express application entry point
├── config/             # Environment configuration
├── controllers/        # Route handler logic
├── db/                 # Database connection layer
├── middleware/         # Express middleware
├── routes/             # API route definitions
└── services/           # Business logic (Phase 1+)
```
