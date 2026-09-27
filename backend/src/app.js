import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import config from './config/index.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { testConnection } from './db/index.js';

const app = express();

// ── Security ────────────────────────────────────
app.use(helmet());

// ── CORS ────────────────────────────────────────
const corsOptions = {
  origin: config.corsOrigin.split(',').map((origin) => origin.trim()),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

// ── Parsing ─────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ─────────────────────────────────────
if (config.nodeEnv !== 'test') {
  app.use(morgan(config.nodeEnv === 'production' ? 'combined' : 'dev'));
}

// ── Routes ──────────────────────────────────────
app.use('/api', routes);

// ── Root endpoint ───────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'Invisible Queue AI — API',
    version: '0.1.0',
    docs: '/api/health',
  });
});

// ── Error handling ──────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Start server ────────────────────────────────
const PORT = config.port;

app.listen(PORT, async () => {
  console.log(`\n🚀 Invisible Queue AI — Backend`);
  console.log(`   Environment : ${config.nodeEnv}`);
  console.log(`   Port        : ${PORT}`);
  console.log(`   Frontend    : ${config.frontendUrl}`);
  console.log(`   Health      : http://localhost:${PORT}/api/health\n`);

  // Test database connection on startup
  if (config.databaseUrl) {
    await testConnection();
  } else {
    console.warn('⚠️  DATABASE_URL not set — skipping database connection');
  }
});

export default app;
