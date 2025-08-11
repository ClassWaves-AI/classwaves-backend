/**
 * Analytics Monitoring Routes
 * 
 * Routes for monitoring analytics write performance and health.
 * Provides observability endpoints for analytics operations.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getAnalyticsPerformance,
  getAnalyticsLogs,
  getAnalyticsHealth,
  updateSampleRate,
  triggerCleanup,
  getCostAnalysis,
  setupPreAggregatedTables
} from '../controllers/analytics-monitoring.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

/**
 * GET /performance
 * Get comprehensive analytics operation performance metrics
 */
router.get('/performance', getAnalyticsPerformance);

/**
 * GET /logs
 * Get recent analytics operation logs with optional filtering
 * Query params: operation, table, sessionId, limit, since
 */
router.get('/logs', getAnalyticsLogs);

/**
 * GET /health
 * Get analytics system health status and recommendations
 */
router.get('/health', getAnalyticsHealth);

/**
 * POST /sample-rate
 * Update the analytics logging sample rate
 * Body: { sampleRate: number } (0-1)
 */
router.post('/sample-rate', updateSampleRate);

/**
 * POST /cleanup
 * Trigger analytics log cleanup for old entries
 * Body: { olderThanHours?: number } (default: 24)
 */
router.post('/cleanup', triggerCleanup);

/**
 * GET /cost-analysis
 * Get query cost analysis and optimization recommendations
 * Query params: timeframeHours (1-168, default: 24)
 */
router.get('/cost-analysis', getCostAnalysis);

/**
 * POST /setup-tables
 * Create pre-aggregated tables in Databricks
 * Admin-only endpoint for initial setup
 * 
 * Note: Job monitoring and triggering is now handled by Databricks Jobs UI
 */
router.post('/setup-tables', setupPreAggregatedTables);

export default router;
