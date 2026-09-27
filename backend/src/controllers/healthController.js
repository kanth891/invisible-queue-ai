import pool, { testConnection } from '../db/index.js';

/**
 * Health check controller.
 * Tests database connectivity and returns system status.
 */
export async function getHealthStatus(req, res) {
  try {
    const dbConnected = await testConnection();

    const status = {
      status: dbConnected ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      services: {
        database: dbConnected ? 'connected' : 'disconnected',
        server: 'running',
      },
    };

    const httpStatus = dbConnected ? 200 : 503;
    return res.status(httpStatus).json(status);
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      services: {
        database: 'error',
        server: 'running',
      },
      message: err.message,
    });
  }
}
