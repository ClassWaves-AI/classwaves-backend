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
import {
  getBasicHealth,
  getGuidanceHealth,
  getComponentHealth,
  getSystemAlerts,
  getPerformanceTrends,
  resolveAlert,
  forceHealthCheck,
  validateAnalyticsTracking,
  validateAnalyticsComponent
} from '../controllers/health.controller';

const router = Router();

// ============================================================================
// Public Health Endpoints
// ============================================================================

/**
 * GET /api/v1/health
 * Basic health check - no authentication required
 */
router.get('/', getBasicHealth);

// ============================================================================
// Authenticated Health Endpoints
// ============================================================================

/**
 * GET /api/v1/health/guidance
 * Detailed teacher guidance system health (teachers and admins)
 */
router.get('/guidance', authenticate, getGuidanceHealth as any);

// ============================================================================
// Admin-Only Health Endpoints
// ============================================================================

/**
 * GET /api/v1/health/components
 * Individual component health status (admin only)
 */
router.get('/components', authenticate, getComponentHealth as any);

/**
 * GET /api/v1/health/alerts
 * Active system alerts (admin only)
 */
router.get('/alerts', authenticate, getSystemAlerts as any);

/**
 * GET /api/v1/health/trends
 * System performance trends (admin only)
 */
router.get('/trends', authenticate, getPerformanceTrends as any);

/**
 * POST /api/v1/health/alerts/:alertId/resolve
 * Resolve a system alert (admin only)
 */
router.post('/alerts/:alertId/resolve', authenticate, resolveAlert as any);

/**
 * POST /api/v1/health/check
 * Force a comprehensive health check (admin only)
 */
router.post('/check', authenticate, forceHealthCheck as any);

/**
 * POST /api/v1/health/validate/analytics
 * Validate analytics tracking system (admin only)
 */
router.post('/validate/analytics', authenticate, validateAnalyticsTracking as any);

/**
 * POST /api/v1/health/validate/analytics/:component
 * Validate specific analytics component (admin only)
 */
router.post('/validate/analytics/:component', authenticate, validateAnalyticsComponent as any);

export default router;
