/**
 * Health Monitoring Controller
 * 
 * REST endpoints for monitoring system health:
 * - GET /api/v1/health - Overall system health
 * - GET /api/v1/health/guidance - Teacher guidance system health
 * - GET /api/v1/health/components - Individual component health
 * - GET /api/v1/health/alerts - Active system alerts
 */

import { Request, Response } from 'express';
import { guidanceSystemHealthService } from '../services/guidance-system-health.service';
import { analyticsTrackingValidator } from '../services/analytics-tracking-validator.service';
import { AuthRequest } from '../types/auth.types';

// ============================================================================
// System Health Endpoints
// ============================================================================

/**
 * GET /api/v1/health
 * 
 * Basic health check endpoint with timeout protection
 */
export const getBasicHealth = async (req: Request, res: Response): Promise<Response> => {
  // Set timeout for this endpoint specifically
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Health check timeout')), 2000); // 2 second timeout
  });

  try {
    // Race between health check and timeout
    const health = await Promise.race([
      guidanceSystemHealthService.getSystemHealth(),
      timeoutPromise
    ]);
    
    const basicHealth = {
      status: health.overall.status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0'
    };

    // Return appropriate HTTP status based on health
    const statusCode = health.overall.status === 'healthy' ? 200 : 
                      health.overall.status === 'degraded' ? 200 : 503;

    return res.status(statusCode).json(basicHealth);
    
  } catch (error) {
    console.error('Health check failed:', error);
    
    // Return minimal health status if detailed check fails
    return res.status(200).json({
      status: 'degraded',
      error: error instanceof Error ? error.message : 'Health check failed',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      fallback: true
    });
  }
};

/**
 * GET /api/v1/health/guidance
 * 
 * Detailed teacher guidance system health
 */
export const getGuidanceHealth = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    // Verify user has admin access for detailed health info
    if (req.user?.role !== 'admin' && req.user?.role !== 'teacher') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Admin or teacher role required'
      });
    }

    const health = guidanceSystemHealthService.getSystemHealth();
    
    return res.json({
      success: true,
      health,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Guidance health check failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve guidance system health'
    });
  }
};

/**
 * GET /api/v1/health/components
 * 
 * Individual component health status
 */
export const getComponentHealth = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    // Verify user has admin access
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Admin role required'
      });
    }

    const health = guidanceSystemHealthService.getSystemHealth();
    const { component } = req.query;
    
    if (component && typeof component === 'string') {
      const componentHealth = guidanceSystemHealthService.getComponentHealth(component);
      if (!componentHealth) {
        return res.status(404).json({
          success: false,
          error: `Component '${component}' not found`
        });
      }
      
      return res.json({
        success: true,
        component,
        health: componentHealth,
        timestamp: new Date().toISOString()
      });
    }
    
    return res.json({
      success: true,
      components: health.components,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Component health check failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve component health'
    });
  }
};

/**
 * GET /api/v1/health/alerts
 * 
 * Active system alerts
 */
export const getSystemAlerts = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    // Verify user has admin access
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Admin role required'
      });
    }

    const activeAlerts = guidanceSystemHealthService.getActiveAlerts();
    const { level } = req.query;
    
    let filteredAlerts = activeAlerts;
    if (level && ['warning', 'critical'].includes(level as string)) {
      filteredAlerts = activeAlerts.filter(alert => alert.level === level);
    }
    
    return res.json({
      success: true,
      alerts: filteredAlerts,
      totalActive: activeAlerts.length,
      criticalCount: activeAlerts.filter(a => a.level === 'critical').length,
      warningCount: activeAlerts.filter(a => a.level === 'warning').length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Failed to retrieve system alerts:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve system alerts'
    });
  }
};

/**
 * GET /api/v1/health/trends
 * 
 * System performance trends
 */
export const getPerformanceTrends = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    // Verify user has admin access
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Admin role required'
      });
    }

    const { timeframe = 'hour' } = req.query;
    const validTimeframes = ['hour', 'day', 'week'];
    
    if (!validTimeframes.includes(timeframe as string)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid timeframe. Must be one of: hour, day, week'
      });
    }
    
    const trends = guidanceSystemHealthService.getPerformanceTrends(timeframe as any);
    
    return res.json({
      success: true,
      trends,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Failed to retrieve performance trends:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance trends'
    });
  }
};

/**
 * POST /api/v1/health/alerts/:alertId/resolve
 * 
 * Resolve a system alert
 */
export const resolveAlert = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    // Verify user has admin access
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Admin role required'
      });
    }

    const { alertId } = req.params;
    const { resolution } = req.body;
    
    if (!resolution || typeof resolution !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Resolution description is required'
      });
    }
    
    await guidanceSystemHealthService.resolveAlert(alertId, resolution);
    
    return res.json({
      success: true,
      message: 'Alert resolved successfully',
      alertId,
      resolvedBy: req.user.id,
      resolvedAt: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Failed to resolve alert:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to resolve alert'
    });
  }
};

/**
 * POST /api/v1/health/check
 * 
 * Force a comprehensive health check
 */
export const forceHealthCheck = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    // Verify user has admin access
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Admin role required'
      });
    }

    console.log(`🏥 Manual health check initiated by admin ${req.user.id}`);
    
    const health = await guidanceSystemHealthService.performHealthCheck();
    
    return res.json({
      success: true,
      message: 'Health check completed',
      health,
      initiatedBy: req.user.id,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Manual health check failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Health check failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * POST /api/v1/health/validate/analytics
 * 
 * Validate analytics tracking system
 */
export const validateAnalyticsTracking = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    // Verify user has admin access
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Admin role required'
      });
    }

    console.log(`📊 Analytics validation initiated by admin ${req.user.id}`);
    
    const validationReport = await analyticsTrackingValidator.validateAnalyticsTracking();
    
    // Cleanup test data
    await analyticsTrackingValidator.cleanup();
    
    return res.json({
      success: validationReport.overall.passed,
      message: 'Analytics validation completed',
      report: validationReport,
      initiatedBy: req.user.id,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Analytics validation failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Analytics validation failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * POST /api/v1/health/validate/analytics/:component
 * 
 * Validate specific analytics component
 */
export const validateAnalyticsComponent = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    // Verify user has admin access
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied: Admin role required'
      });
    }

    const { component } = req.params;
    
    console.log(`📊 Analytics component validation initiated by admin ${req.user.id}: ${component}`);
    
    const results = await analyticsTrackingValidator.testComponent(component);
    
    return res.json({
      success: results.every(r => r.passed),
      message: `Component validation completed: ${component}`,
      results,
      component,
      initiatedBy: req.user.id,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`Analytics component validation failed for ${req.params.component}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Component validation failed',
      component: req.params.component,
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
