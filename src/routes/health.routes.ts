/**
 * Health Monitoring Routes
 * 
 * REST endpoints for system health monitoring:
 * - Basic health checks (public)
 * - Detailed system health (authenticated)
 * - Component health monitoring (admin)
 * - Alert management (admin)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireAnyAdmin } from '../middleware/admin-route-security.middleware';
import { healthController } from '../controllers/health.controller';

const router = Router();

// ============================================================================
// Public Health Endpoints
// ============================================================================

/**
 * GET /api/v1/health
 * Basic health check - no authentication required
 */
router.get('/', healthController.getHealthCheck.bind(healthController));

/**
 * GET /api/v1/health/detailed
 * Detailed system health check
 */
router.get('/detailed', healthController.getHealthCheck.bind(healthController));

/**
 * GET /api/v1/health/websocket
 * WebSocket namespace health check - no authentication required
 */
router.get('/websocket', healthController.getWebSocketHealth.bind(healthController));

/**
 * GET /api/v1/health/errors
 * Error summary and logs
 */
router.get('/errors', healthController.getErrorSummary.bind(healthController));

/**
 * GET /api/v1/health/redis
 * Redis health probe (ping + short-lived RW)
 */
router.get('/redis', healthController.getRedisHealthDetailed.bind(healthController));
/**
 * GET /api/v1/health/databricks
 * Databricks health probe (fast, strict timeout)
 */
router.get('/databricks', healthController.getDatabricksHealthDetailed.bind(healthController));

/**
 * GET /api/v1/health/components
 * Provider-aware component status report (admin-only)
 */
router.get('/components', authenticate, requireAnyAdmin, healthController.getComponentsHealth.bind(healthController));

/**
 * POST /api/v1/health/errors/clear
 * Clear error logs (admin only)
 */
router.post('/errors/clear', authenticate, requireAnyAdmin, healthController.clearErrorLogs.bind(healthController));

export default router;
