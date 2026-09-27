import { Router } from 'express';
import { getHealthStatus } from '../controllers/healthController.js';

const router = Router();

/**
 * GET /api/health
 * Infrastructure health check endpoint.
 * Returns server and database connection status.
 */
router.get('/health', getHealthStatus);

export default router;
