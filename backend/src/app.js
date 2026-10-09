import dotenv from 'dotenv';
dotenv.config({ path: '../.env' });
import http from 'http';
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
import queueRoutes, {
  getPatientQueueAccess,
  getPatientPrediction,
  patientCancelQueue,
  patientRejoinQueue,
  getPatientRescheduleOptions,
  patientRescheduleQueue,
} from './routes/queue.js';
import userRoutes from './routes/users.js';
import analyticsRoutes from './routes/analytics.js';
import { autoMigrate } from './db/autoMigrate.js';
import { initSocket } from './socket/index.js';
import { startMissedTokenWorker } from './services/missedTokenReconciler.js';

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

app.use(helmet());
const allowedOrigins = CORS_ORIGIN.split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      allowedOrigins.includes('*') ||
      origin.endsWith('.onrender.com') ||
      origin.endsWith('.vercel.app') ||
      origin.includes('localhost') ||
      origin.includes('127.0.0.1')
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
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

app.get('/', (req, res) => res.json({ name: 'Invisible Queue AI - API', version: '1.0.0' }));

// ── Public routes ─────────────────────────────────
app.use('/api/auth', authRoutes);

// Public Patient Virtual Queue Access & Patient Queue Control
app.get('/api/queue/access/:accessToken', getPatientQueueAccess);
app.get('/api/queue/access/:accessToken/prediction', getPatientPrediction);
app.post('/api/queue/access/:accessToken/cancel', patientCancelQueue);
app.post('/api/queue/access/:accessToken/rejoin', patientRejoinQueue);
app.get('/api/queue/access/:accessToken/reschedule-options', getPatientRescheduleOptions);
app.post('/api/queue/access/:accessToken/reschedule', patientRescheduleQueue);

// Aliases for /api/queue/patient/* endpoints
app.post('/api/queue/patient/cancel', patientCancelQueue);
app.post('/api/queue/patient/rejoin', patientRejoinQueue);
app.get('/api/queue/patient/reschedule-options', getPatientRescheduleOptions);
app.post('/api/queue/patient/reschedule', patientRescheduleQueue);

// ── Protected routes ──────────────────────────────
app.use('/api/departments', authenticate, departmentRoutes);
app.use('/api/doctors', authenticate, doctorRoutes);
app.use('/api/patients', authenticate, patientRoutes);
app.use('/api/queue', authenticate, queueRoutes);
app.use('/api/users', authenticate, userRoutes);
app.use('/api/analytics', authenticate, analyticsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

// ── Initialize Socket.IO ──────────────────────────
initSocket(server, allowedOrigins);

server.listen(PORT, async () => {
  console.log(`[START] Invisible Queue AI - Backend | ${NODE_ENV} | :${PORT} (HTTP + Socket.IO)`);
  if (process.env.DATABASE_URL) {
    const ok = await testConnection();
    if (ok) {
      await autoMigrate();
      startMissedTokenWorker(15000);
    }
  } else {
    console.warn('[WARN] DATABASE_URL not set');
  }
});

export { app, server };
export default app;
