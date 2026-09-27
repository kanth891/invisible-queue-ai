import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (backend/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Centralized application configuration.
 * All values come from environment variables — never hard-coded.
 */
const config = {
  // Server
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,

  // Database
  databaseUrl: process.env.DATABASE_URL,

  // Authentication
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',

  // URLs
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  apiUrl: process.env.API_URL || 'http://localhost:5000',

  // CORS
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};

export default config;
