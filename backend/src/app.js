import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import pool, { testConnection } from './db/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/auth.js';

// ── Route imports ──────────────────────────────────
import authRoutes from './routes/auth.js';
import departmentRoutes from './routes/departments.js';
import doctorRoutes from './routes/doctors.js';
import patientRoutes from './routes/patients.js';
import queueRoutes, { getPatientQueueAccess } from './routes/queue.js';
import userRoutes from './routes/users.js';

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

app.get('/', (req, res) => res.json({ name: 'Invisible Queue AI — API', version: '1.0.0' }));

// ── Public routes ─────────────────────────────────
app.use('/api/auth', authRoutes);

// Phase 2: Virtual Queue Patient Access (Public tracking by secure random token)
app.get('/api/queue/access/:accessToken', getPatientQueueAccess);

// ── Protected routes ──────────────────────────────
app.use('/api/departments', authenticate, departmentRoutes);
app.use('/api/doctors', authenticate, doctorRoutes);
app.use('/api/patients', authenticate, patientRoutes);
app.use('/api/queue', authenticate, queueRoutes);
app.use('/api/users', authenticate, userRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, async () => {
  console.log(`🚀 Invisible Queue AI — Backend | ${NODE_ENV} | :${PORT}`);
  if (process.env.DATABASE_URL) await testConnection();
  else console.warn('⚠️  DATABASE_URL not set');
});

export default app;
