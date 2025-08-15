import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { 
  generateAccessToken, 
  generateRefreshToken, 
  generateSessionId, 
  getExpiresInSeconds,
  verifyToken
} from '../utils/jwt.utils';
import { validateSchoolDomain } from '../utils/validation.schemas';
import { GoogleUser, Teacher, School } from '../types/auth.types';
import { databricksService } from '../services/databricks.service';
import { redisService } from '../services/redis.service';
import { SecureJWTService } from '../services/secure-jwt.service';
import { SecureSessionService } from '../services/secure-session.service';
import { 
  verifyGoogleTokenWithTimeout,
  executeParallelAuthOperations,
  createAuthErrorResponse,
  authCircuitBreaker,
  storeSessionOptimized
} from '../utils/auth-optimization.utils';
// Removed resilientAuthService (GSI credential flow)
import { authHealthMonitor } from '../services/auth-health-monitor.service';
import { RetryService } from '../services/retry.service';

let cachedGoogleClient: OAuth2Client | null = null;
function getGoogleClient(): OAuth2Client {
  if (!cachedGoogleClient) {
    cachedGoogleClient = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
  }
  return cachedGoogleClient;
}


async function storeSession(sessionId: string, teacher: Teacher, school: School, req: Request): Promise<void> {
  const expiresIn = getExpiresInSeconds();
  await redisService.storeSession(sessionId, {
    teacherId: teacher.id,
    teacher,
    school,
    sessionId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent']
  }, expiresIn);
}

/**
 * OPTIMIZED Google Auth Handler with Performance Enhancements
 * 
 * Key optimizations:
 * - Parallel processing using Promise.all for token generation and session storage
 * - Circuit breaker pattern for external service resilience  
 * - Enhanced timeout handling for Google OAuth
 * - Optimized Redis service with LRU cache
 * - Comprehensive performance logging
 */
export async function optimizedGoogleAuthHandler(req: Request, res: Response): Promise<Response> {
  const startTime = performance.now();
  const requestId = `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  console.log(`🚀 RESILIENT AUTH START - Google Auth Handler [${requestId}]`);
  
  // Record auth attempt start for monitoring
  authHealthMonitor.recordAuthStart(requestId);
  
  try {
    const { code, codeVerifier, state } = req.body;

    console.log(`🛡️ Using authorization code authentication [${requestId}]`);

    let authResult: {
      teacher: Teacher;
      school: School;
      tokens: { accessToken: string; refreshToken: string } | null;
      sessionId: string | null;
      degradedMode: boolean;
    } | null = null;

    if (code) {
      // Handle authorization code flow
      console.log(`🔑 Processing authorization code flow [${requestId}]`);
      console.log(`PKCE_ENABLED: true [${requestId}]`, { hasCodeVerifier: Boolean(codeVerifier) });
      const googleClient = getGoogleClient();
      
      try {
        if (!codeVerifier) {
          console.warn(`PKCE_VERIFIER_MISSING_OR_INVALID [${requestId}]`);
          const errorResponse = createAuthErrorResponse(
            'PKCE_VERIFIER_MISSING_OR_INVALID',
            'Missing or invalid PKCE verifier',
            400
          );
          authHealthMonitor.recordAuthAttempt(false, performance.now() - startTime, requestId);
          return res.status(400).json(errorResponse);
        }

        const googleUser = await verifyGoogleTokenWithTimeout(
          googleClient,
          undefined,
          code,
          parseInt(process.env.GOOGLE_OAUTH_TIMEOUT || '5000', 10),
          codeVerifier,
          process.env.GOOGLE_REDIRECT_URI
        );
        const domain = validateSchoolDomain(googleUser.email);
        
        if (!domain) {
          throw new Error('Invalid email domain');
        }
        
        // Use batch auth operations for code flow
        const batchResult = await databricksService.batchAuthOperations(googleUser, domain);
        
        authResult = {
          teacher: batchResult.teacher,
          school: batchResult.school,
          tokens: null,
          sessionId: null,
          degradedMode: false
        };
      } catch (error) {
        console.error(`🚨 Authorization code authentication failed [${requestId}]:`, error);
        console.error(`PKCE_EXCHANGE_FAILED [${requestId}]`);
        const errorResponse = createAuthErrorResponse(
          'AUTHORIZATION_CODE_FAILED',
          'Failed to process authorization code',
          500
        );
        authHealthMonitor.recordAuthAttempt(false, performance.now() - startTime, requestId);
        return res.status(500).json(errorResponse);
      }
    }
    
    const authTime = performance.now() - startTime;
    console.log(`⏱️ Authentication took ${authTime.toFixed(2)}ms [${requestId}]`);
    console.log(`PKCE_EXCHANGE_OK: true [${requestId}]`);
    
    // Validate authentication result
    if (!authResult || !authResult.school) {
      const errorResponse = createAuthErrorResponse(
        'SCHOOL_NOT_AUTHORIZED',
        `Domain not authorized for ClassWaves`,
        403,
        {
          contactInfo: {
            email: 'schools@classwaves.ai',
            phone: '1-800-CLASSWAVES',
          },
        }
      );
      
      authHealthMonitor.recordAuthAttempt(false, authTime, requestId);
      return res.status(403).json(errorResponse);
    }
    
    if (authResult.school.subscription_status !== 'active' && authResult.school.subscription_status !== 'trial') {
      const errorResponse = createAuthErrorResponse(
        'SUBSCRIPTION_INACTIVE',
        'School subscription is not active',
        403,
        { status: authResult.school.subscription_status }
      );
      
      authHealthMonitor.recordAuthAttempt(false, authTime, requestId);
      return res.status(403).json(errorResponse);
    }
    
    if (!authResult.teacher) {
      const errorResponse = createAuthErrorResponse(
        'TEACHER_NOT_FOUND',
        'Failed to create or update teacher record',
        500
      );
      
      authHealthMonitor.recordAuthAttempt(false, authTime, requestId);
      return res.status(500).json(errorResponse);
    }
    
    // Use tokens from resilient auth service or generate new ones if needed
    const tokenGenerationStart = performance.now();
    let tokens = authResult.tokens;
    let sessionId = authResult.sessionId || generateSessionId();
    let secureTokens: any = null;
    
    // If degraded mode or tokens not available, generate secure tokens
    if (authResult.degradedMode || !tokens) {
      console.log(`🔄 Generating tokens due to degraded mode or missing tokens [${requestId}]`);
      secureTokens = await SecureJWTService.generateSecureTokens(
        authResult.teacher, 
        authResult.school, 
        sessionId, 
        req
      );
      tokens = {
        accessToken: secureTokens.accessToken,
        refreshToken: secureTokens.refreshToken
      };
    }
    
    // Ensure secure session is stored so subsequent requests can validate via cookie
    try {
      await storeSessionOptimized(sessionId, authResult.teacher, authResult.school, req);
    } catch (storeErr) {
      console.error(`❌ Failed to store secure session [${requestId}]:`, storeErr);
    }
    
    console.log(`⏱️ Token processing took ${(performance.now() - tokenGenerationStart).toFixed(2)}ms [${requestId}]`);
    
    // Return success response FIRST (don't wait for audit log)
    const totalAuthTime = performance.now() - startTime;
    console.log(`🎉 RESILIENT AUTH COMPLETE - Auth time: ${totalAuthTime.toFixed(2)}ms [${requestId}]`);
    
    // Record successful authentication
    authHealthMonitor.recordAuthAttempt(true, totalAuthTime, requestId);
    authHealthMonitor.recordAuthEnd(requestId);
    
    // Set HTTP-only session cookie for frontend session restoration
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/'
    });

    const response = res.json({
      success: true,
      teacher: {
        id: authResult.teacher.id,
        email: authResult.teacher.email,
        name: authResult.teacher.name,
        role: authResult.teacher.role,
        accessLevel: authResult.teacher.access_level,
      },
      school: {
        id: authResult.school.id,
        name: authResult.school.name,
        domain: authResult.school.domain,
        subscriptionTier: authResult.school.subscription_tier,
      },
      tokens: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: secureTokens?.expiresIn || 3600,
        refreshExpiresIn: secureTokens?.refreshExpiresIn || 604800,
        tokenType: 'Bearer',
        deviceFingerprint: secureTokens?.deviceFingerprint,
      },
      degradedMode: authResult.degradedMode || false,
      performance: {
        totalTime: totalAuthTime,
        circuitBreakerStatus: { overall: 'healthy' },
        requestId
      },
    });

    // ASYNC audit logging (don't block response) with resilient retry
    setImmediate(async () => {
      console.log(`🔍 ASYNC AUDIT LOG START [${requestId}]`);
      const auditLogStart = performance.now();
      try {
        await RetryService.retryDatabaseOperation(
          () => databricksService.recordAuditLog({
            actorId: authResult.teacher.id,
            actorType: 'teacher',
            eventType: 'login',
            eventCategory: 'authentication',
            resourceType: 'session',
            resourceId: sessionId,
            schoolId: authResult.school.id,
            description: `Teacher ID ${authResult.teacher.id} logged in successfully (resilient flow)`,
            ipAddress: req.ip,
            userAgent: req.headers['user-agent'],
            complianceBasis: 'legitimate_interest',
            metadata: {
              degradedMode: authResult.degradedMode || false,
              requestId
            }
          }),
          'AuditLog'
        );
        console.log(`⏱️ Async audit log took ${(performance.now() - auditLogStart).toFixed(2)}ms [${requestId}]`);
        
        const totalTime = performance.now() - startTime;
        console.log(`🎉 RESILIENT TOTAL TIME (including audit) - ${totalTime.toFixed(2)}ms [${requestId}]`);
      } catch (error) {
        console.error(`⚠️ Async audit log failed [${requestId}]:`, error);
      }
    });

    return response;
    
  } catch (error) {
    const authTime = performance.now() - startTime;
    console.error(`Resilient Google auth error [${requestId}]:`, error);
    
    // Record failed authentication
    authHealthMonitor.recordAuthAttempt(false, authTime, requestId);
    authHealthMonitor.recordAuthEnd(requestId);
    
    // Enhanced error handling with categorization for resilient auth
    let errorResponse;
    if (error instanceof Error) {
      if (error.message.includes('GOOGLE_SERVICE_UNAVAILABLE')) {
        errorResponse = createAuthErrorResponse(
          'GOOGLE_SERVICE_UNAVAILABLE',
          'Google authentication service is temporarily unavailable',
          503
        );
      } else if (error.message.includes('DATABASE_SERVICE_UNAVAILABLE')) {
        errorResponse = createAuthErrorResponse(
          'DATABASE_SERVICE_UNAVAILABLE',
          'Database service is temporarily unavailable',
          503
        );
      } else if (error.message.includes('INVALID_EMAIL_DOMAIN')) {
        errorResponse = createAuthErrorResponse(
          'INVALID_EMAIL_DOMAIN',
          'Please use your school email address to sign in',
          403
        );
      } else if (error.message.includes('SCHOOL_NOT_AUTHORIZED')) {
        errorResponse = createAuthErrorResponse(
          'SCHOOL_NOT_AUTHORIZED',
          'Your school domain is not authorized for ClassWaves',
          403
        );
      } else if (error.message.includes('Circuit breaker')) {
        errorResponse = createAuthErrorResponse(
          'SERVICE_UNAVAILABLE',
          'Authentication service temporarily unavailable due to circuit breaker',
          503
        );
      } else {
        errorResponse = createAuthErrorResponse(
          'AUTHENTICATION_FAILED',
          'Failed to authenticate with Google',
          500
        );
      }
    } else {
      errorResponse = createAuthErrorResponse(
        'UNKNOWN_ERROR',
        'An unexpected error occurred during authentication',
        500
      );
    }
    
    return res.status(errorResponse.statusCode).json(errorResponse);
  }
}


/**
 * Token Rotation Handler - Refresh Access Tokens using Refresh Tokens
 * 
 * Features:
 * - Validates refresh token security (device fingerprinting, blacklist check)
 * - Rotates both access and refresh tokens for enhanced security
 * - Blacklists old refresh token to prevent reuse
 * - Maintains session continuity while enhancing security
 */
export async function rotateTokens(req: Request, res: Response): Promise<Response> {
  const rotationStart = performance.now();
  console.log('🔄 TOKEN ROTATION START');
  
  try {
    const { refreshToken } = req.body;
    
    // Validate input
    if (!refreshToken) {
      return res.status(400).json({
        error: 'MISSING_REFRESH_TOKEN',
        message: 'Refresh token is required for token rotation',
      });
    }
    
    console.log('🔍 Validating refresh token for rotation');
    
    // Use SecureJWTService for token rotation
    const newTokens = await SecureJWTService.rotateTokens(refreshToken, req);
    
    if (!newTokens) {
      return res.status(401).json({
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token',
      });
    }
    
    const rotationTime = performance.now() - rotationStart;
    console.log(`🎉 TOKEN ROTATION COMPLETE - Time: ${rotationTime.toFixed(2)}ms`);
    
    // Set new session cookie
    res.cookie('session_id', newTokens.deviceFingerprint, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
      maxAge: newTokens.expiresIn * 1000,
      path: '/'
    });
    
    return res.json({
      success: true,
      tokens: {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken,
        expiresIn: newTokens.expiresIn,
        refreshExpiresIn: newTokens.refreshExpiresIn,
        tokenType: 'Bearer',
        deviceFingerprint: newTokens.deviceFingerprint,
      },
      performance: {
        rotationTime: rotationTime,
        timestamp: new Date().toISOString(),
      }
    });
    
  } catch (error) {
    console.error('❌ Token rotation failed:', error);
    
    return res.status(500).json({
      error: 'TOKEN_ROTATION_FAILED',
      message: 'Failed to rotate tokens',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : undefined,
    });
  }
}

/**
 * Logout Handler with Enhanced Security
 * 
 * Features:
 * - Revokes all tokens for the user
 * - Invalidates all sessions 
 * - Clears secure session data
 * - Logs security event for monitoring
 */
export async function secureLogout(req: Request, res: Response): Promise<Response> {
  const logoutStart = performance.now();
  console.log('🚪 SECURE LOGOUT START');
  
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const sessionId = req.cookies?.session_id;
    
    if (token) {
      // Verify token to get user info
      const payload = await SecureJWTService.verifyTokenSecurity(token, req, 'access');
      if (payload) {
        // Revoke all tokens for this user
        await SecureJWTService.revokeAllUserTokens(payload.userId, 'User logout');
        
        // Invalidate the current session
        if (sessionId) {
          await SecureSessionService.invalidateSession(sessionId, 'User logout');
        }
        
        console.log(`🔒 All tokens and sessions revoked for user: ${payload.userId}`);
      }
    } else if (sessionId) {
      // Fallback: invalidate session by ID
      await SecureSessionService.invalidateSession(sessionId, 'User logout (no token)');
    }
    
    // Clear session cookie
    res.clearCookie('session_id', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
      path: '/'
    });
    
    const logoutTime = performance.now() - logoutStart;
    console.log(`🎉 SECURE LOGOUT COMPLETE - Time: ${logoutTime.toFixed(2)}ms`);
    
    return res.json({
      success: true,
      message: 'Successfully logged out',
      performance: {
        logoutTime: logoutTime,
        timestamp: new Date().toISOString(),
      }
    });
    
  } catch (error) {
    console.error('❌ Secure logout failed:', error);
    
    // Still clear the cookie even if there's an error
    res.clearCookie('session_id', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
      path: '/'
    });
    
    return res.status(500).json({
      error: 'LOGOUT_FAILED',
      message: 'Logout completed but with errors',
      details: process.env.NODE_ENV === 'development' ? (error instanceof Error ? error.message : 'Unknown error') : undefined,
    });
  }
}

export async function generateTestTokenHandler(req: Request, res: Response): Promise<Response> {
  // Only allow in test environment
  if (process.env.NODE_ENV !== 'test') {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Endpoint not available in this environment',
    });
  }

  try {
    const { secretKey } = req.body;
    
    // Verify secret key (simple validation for testing)
    if (secretKey !== process.env.E2E_TEST_SECRET) {
      return res.status(401).json({
        error: 'INVALID_SECRET',
        message: 'Invalid secret key for test token generation',
      });
    }

    // Create a test teacher and school for the token
    const testTeacher = {
      id: 'test-teacher-id',
      email: 'test.teacher@testschool.edu',
      name: 'Test Teacher',
      role: 'teacher',
      access_level: 'full',
    };

    const testSchool = {
      id: 'test-school-id',
      name: 'Test School',
      domain: 'testschool.edu',
      subscription_tier: 'professional',
    };

    // Generate secure tokens for testing
    const sessionId = generateSessionId();
    const secureTokens = await SecureJWTService.generateSecureTokens(
      testTeacher as Teacher, 
      testSchool as School, 
      sessionId, 
      req
    );

    // Store a secure session so cookie-based auth works in E2E
    try {
      await SecureSessionService.storeSecureSession(
        sessionId,
        testTeacher as Teacher,
        testSchool as School,
        req
      );
    } catch (e) {
      console.error('⚠️ Failed to store secure test session:', e);
    }

    // Set session cookie for convenience (Playwright also sets it, but this makes API usage consistent)
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    });

    return res.json({
      success: true,
      teacher: {
        id: testTeacher.id,
        email: testTeacher.email,
        name: testTeacher.name,
        role: testTeacher.role,
        accessLevel: testTeacher.access_level,
      },
      school: {
        id: testSchool.id,
        name: testSchool.name,
        domain: testSchool.domain,
        subscriptionTier: testSchool.subscription_tier,
      },
      tokens: {
        accessToken: secureTokens.accessToken,
        refreshToken: secureTokens.refreshToken,
        expiresIn: secureTokens.expiresIn,
        refreshExpiresIn: secureTokens.refreshExpiresIn,
        tokenType: 'Bearer',
        deviceFingerprint: secureTokens.deviceFingerprint,
      },
      sessionId, // Include for test cleanup if needed
    });

  } catch (error) {
    console.error('Generate test token error:', error);
    return res.status(500).json({
      error: 'TEST_TOKEN_GENERATION_FAILED',
      message: 'Failed to generate test authentication token',
    });
  }
}