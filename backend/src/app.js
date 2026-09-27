import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import pool, { testConnection } from './db/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use(helmet());
app.use(cors({
  origin: CORS_ORIGIN.split(',').map(o => o.trim()),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
if (NODE_ENV !== 'test') app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// ── Health check ──────────────────────────────────
app.get('/api/health', async (req, res) => {
  const dbOk = await testConnection();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: NODE_ENV,
    services: { database: dbOk ? 'connected' : 'disconnected', server: 'running' },
  });
});

app.get('/', (req, res) => res.json({ name: 'Invisible Queue AI — API', version: '0.1.0' }));

// Phase 1+ routes will be mounted here: app.use('/api', routes)

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, async () => {
  console.log(`🚀 Invisible Queue AI — Backend | ${NODE_ENV} | :${PORT}`);
  if (process.env.DATABASE_URL) await testConnection();
  else console.warn('⚠️  DATABASE_URL not set');
});

export default app;
