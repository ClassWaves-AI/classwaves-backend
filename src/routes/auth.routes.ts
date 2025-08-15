import { Router } from 'express';
import { optimizedGoogleAuthHandler, generateTestTokenHandler, rotateTokens, secureLogout } from '../controllers/auth.controller';
import { validate } from '../middleware/validation.middleware';
import { googleAuthSchema, refreshTokenSchema, generateTestTokenSchema } from '../utils/validation.schemas';
import { authenticate } from '../middleware/auth.middleware';
import { generateCSRFToken } from '../middleware/csrf.middleware';
import { AuthRequest } from '../types/auth.types';
import { authHealthMonitor } from '../services/auth-health-monitor.service';

const router = Router();

// Google OAuth callback (optimized)
router.post('/google', validate(googleAuthSchema), optimizedGoogleAuthHandler);

// Token refresh (now uses secure rotation under the hood)
router.post('/refresh', validate(refreshTokenSchema), rotateTokens);

// Logout (now uses secure implementation under the hood)
router.post('/logout', secureLogout);

// Get current user with fresh tokens (session validation)
router.get('/me', authenticate, async (req, res) => {
  const meStart = performance.now();
  console.log('👤 /auth/me ENDPOINT START');
  
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const school = authReq.school!;
    const currentSessionId = authReq.sessionId!; // Use EXISTING session ID
    
    // Generate fresh secure tokens for the CURRENT session (not a new one)
    const { SecureJWTService } = await import('../services/secure-jwt.service');
    
    const secureTokens = await SecureJWTService.generateSecureTokens(teacher, school, currentSessionId, req);
    
    const meTotal = performance.now() - meStart;
    console.log(`👤 /auth/me ENDPOINT COMPLETE - Total time: ${meTotal.toFixed(2)}ms`);
    
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
    console.error('Session validation error:', error);
    res.status(401).json({
      success: false,
      error: 'INVALID_SESSION',
      message: 'Session validation failed',
    });
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
router.post('/generate-test-token', validate(generateTestTokenSchema), generateTestTokenHandler);

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
    console.log('🔍 Auth health check requested');
    const healthStatus = await authHealthMonitor.checkAuthSystemHealth();
    
    // Return appropriate HTTP status based on health
    const httpStatus = healthStatus.overall === 'healthy' ? 200 : 
                      healthStatus.overall === 'degraded' ? 206 : 503;
    
    res.status(httpStatus).json({
      success: true,
      data: healthStatus
    });
  } catch (error) {
    console.error('❌ Auth health check failed:', error);
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
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Admin access required for detailed metrics'
      });
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
    console.error('❌ Auth metrics retrieval failed:', error);
    res.status(500).json({
      success: false,
      error: 'METRICS_RETRIEVAL_FAILED',
      message: 'Failed to retrieve authentication metrics'
    });
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
      return res.status(403).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Admin access required to resolve alerts'
      });
    }
    
    const resolved = authHealthMonitor.resolveAlert(alertId);
    
    if (resolved) {
      res.json({
        success: true,
        message: 'Alert resolved successfully',
        alertId
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'ALERT_NOT_FOUND',
        message: 'Alert not found or already resolved'
      });
    }
  } catch (error) {
    console.error('❌ Alert resolution failed:', error);
    res.status(500).json({
      success: false,
      error: 'ALERT_RESOLUTION_FAILED',
      message: 'Failed to resolve alert'
    });
  }
});

export default router;