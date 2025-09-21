import { Router } from 'express';
import { optimizedGoogleAuthHandler, generateTestTokenHandler, rotateTokens, secureLogout } from '../controllers/auth.controller';
import { validate } from '../middleware/validation.middleware';
import { googleAuthSchema, refreshTokenSchema, generateTestTokenSchema } from '../utils/validation.schemas';
import { authenticate } from '../middleware/auth.middleware';
import { generateCSRFToken } from '../middleware/csrf.middleware';
import { AuthRequest } from '../types/auth.types';
import { authHealthMonitor } from '../services/auth-health-monitor.service';
import { fail } from '../utils/api-response';
import { ErrorCodes } from '@classwaves/shared';
import { logger } from '../utils/logger';

const router = Router();

// Google OAuth callback (optimized)
if (process.env.NODE_ENV === 'production') {
  router.post('/google', validate(googleAuthSchema), optimizedGoogleAuthHandler);
} else {
  // In development, allow handler to engage dev fallback without strict validation
  router.post('/google', optimizedGoogleAuthHandler);
}

// Token refresh (now uses secure rotation under the hood)
router.post('/refresh', validate(refreshTokenSchema), rotateTokens);

// Logout (now uses secure implementation under the hood)
router.post('/logout', secureLogout);

// Get current user with fresh tokens (session validation)
router.get('/me', authenticate, async (req, res) => {
  const meStart = performance.now();
  logger.debug('👤 /auth/me ENDPOINT START');
  
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const school = authReq.school!;
    const currentSessionId = authReq.sessionId!; // Use EXISTING session ID
    
    // Generate fresh secure tokens for the CURRENT session (not a new one)
    const { SecureJWTService } = await import('../services/secure-jwt.service');
    
    const secureTokens = await SecureJWTService.generateSecureTokens(teacher, school, currentSessionId, req);
    
    const meTotal = performance.now() - meStart;
    logger.debug(`👤 /auth/me ENDPOINT COMPLETE - Total time: ${meTotal.toFixed(2)}ms`);
    
    // DO NOT set a new cookie - the session already exists and is valid
    // Just refresh the session TTL in Redis if needed
    
    res.json({
      success: true,
      teacher: {
        id: teacher.id,
        email: teacher.email,
        name: teacher.name,
        role: teacher.role,
        accessLevel: teacher.access_level,
      },
      school: {
        id: school.id,
        name: school.name,
        domain: school.domain,
        subscriptionTier: school.subscription_tier,
      },
      tokens: {
        accessToken: secureTokens.accessToken,
        refreshToken: secureTokens.refreshToken,
        expiresIn: secureTokens.expiresIn,
        refreshExpiresIn: secureTokens.refreshExpiresIn,
        tokenType: 'Bearer',
        deviceFingerprint: secureTokens.deviceFingerprint,
      },
    });
  } catch (error) {
    logger.warn('Session validation error', { error: (error as any)?.message || String(error) });
    return fail(res, ErrorCodes.AUTH_REQUIRED, 'Session validation failed', 401);
  }
});

// Get CSRF token (for SPAs)
router.get('/csrf-token', authenticate, async (req, res) => {
  const authReq = req as AuthRequest;
  const token = generateCSRFToken();
  
  // Token is already stored by csrfTokenGenerator middleware
  res.json({
    success: true,
    csrfToken: res.locals.csrfToken || token,
  });
});

// Generate test token for E2E testing (test environment only)
router.post('/generate-test-token', (req, res, next) => {
  logger.debug('Route /generate-test-token hit', { method: req.method });
  next();
}, validate(generateTestTokenSchema), generateTestTokenHandler);

// Simple test token endpoint for API audit system (development only)
router.post('/test-token', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Test tokens are not allowed in production', 403);
  }

  try {
    const { email = 'test@classwaves.ai', role = 'teacher', secretKey } = req.body;
    if (!process.env.E2E_TEST_SECRET || secretKey !== process.env.E2E_TEST_SECRET) {
      return fail(res, ErrorCodes.AUTH_REQUIRED, 'Invalid secret key for test token generation', 401);
    }
    
    // Create a test teacher and school for the token
    const testTeacher = {
      id: 'test-teacher-id',
      email: email,
      name: 'Test Teacher',
      role: role,
      access_level: 'full',
    };

    const testSchool = {
      id: 'test-school-id',
      name: 'Test School',
      domain: 'testschool.edu',
      subscription_tier: 'professional',
    };

    // Generate a real JWT token that will work with auth middleware
    const { generateAccessToken, generateSessionId } = require('../utils/jwt.utils');
    const sessionId = generateSessionId();
    const accessToken = generateAccessToken(testTeacher, testSchool, sessionId);
    
    res.json({
      success: true,
      token: accessToken,
      user: { email, role },
      sessionId: sessionId,
      expiresIn: 3600,
      message: 'Real JWT test token generated for API audit'
    });
  } catch (error) {
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to generate test token', 500);
  }
});

// ============================================================================
// Health Monitoring Endpoints
// ============================================================================

/**
 * GET /auth/health
 * 
 * Authentication system health check endpoint
 * Returns comprehensive health status of auth dependencies and metrics
 */
router.get('/health', async (req, res) => {
  try {
    logger.debug('🔍 Auth health check requested');
    const healthStatus = await authHealthMonitor.checkAuthSystemHealth();
    
    // Return appropriate HTTP status based on health
    const httpStatus = healthStatus.overall === 'healthy' ? 200 : 
                      healthStatus.overall === 'degraded' ? 206 : 503;
    
    res.status(httpStatus).json({
      success: true,
      data: healthStatus
    });
  } catch (error) {
    logger.error('❌ Auth health check failed:', error);
    res.status(503).json({
      success: false,
      error: 'HEALTH_CHECK_FAILED',
      message: 'Authentication health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /auth/health/metrics
 * 
 * Authentication performance metrics endpoint
 * Returns detailed performance and reliability metrics
 */
router.get('/health/metrics', authenticate, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    
    // Only allow admin access to detailed metrics
    if (user?.role !== 'admin' && user?.role !== 'super_admin') {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Admin access required for detailed metrics', 403);
    }
    
    const performanceReport = await authHealthMonitor.generatePerformanceReport();
    const alerts = authHealthMonitor.getAllAlerts();
    
    res.json({
      success: true,
      data: {
        performance: performanceReport,
        alerts: {
          active: alerts.filter(a => !a.resolved),
          total: alerts.length,
          recent: alerts.slice(-10) // Last 10 alerts
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Auth metrics retrieval failed', { error: (error as any)?.message || String(error) });
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to retrieve authentication metrics', 500);
  }
});

/**
 * POST /auth/health/alerts/:alertId/resolve
 * 
 * Resolve a specific alert (admin only)
 */
router.post('/health/alerts/:alertId/resolve', authenticate, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;
    const { alertId } = req.params;
    
    // Only allow admin access
    if (user?.role !== 'admin' && user?.role !== 'super_admin') {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Admin access required to resolve alerts', 403);
    }
    
    const resolved = authHealthMonitor.resolveAlert(alertId);
    
    if (resolved) {
      res.json({
        success: true,
        message: 'Alert resolved successfully',
        alertId
      });
    } else {
      return fail(res, ErrorCodes.NOT_FOUND, 'Alert not found or already resolved', 404);
    }
  } catch (error) {
    logger.error('Alert resolution failed', { error: (error as any)?.message || String(error) });
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to resolve alert', 500);
  }
});

export default router;
