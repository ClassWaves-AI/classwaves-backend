import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { generateSessionId } from '../utils/jwt.utils';
import { validateSchoolDomain } from '../utils/validation.schemas';
import { Teacher, School } from '../types/auth.types';
import { databricksService, isDatabricksMockEnabled } from '../services/databricks.service';
import { SecureJWTService } from '../services/secure-jwt.service';
import { SecureSessionService } from '../services/secure-session.service';
import { 
  verifyGoogleTokenWithTimeout,
  createAuthErrorResponse,
  storeSessionOptimized
} from '../utils/auth-optimization.utils';
// Removed resilientAuthService (GSI credential flow)
import { authHealthMonitor } from '../services/auth-health-monitor.service';
import { fail } from '../utils/api-response';
import { ErrorCodes, FeatureFlags } from '@classwaves/shared';
import { logger } from '../utils/logger';
import { recordAuthDevFallback } from '../metrics/auth.metrics';
import { getDevAuthFallbackDecision } from '../utils/auth-dev-fallback.utils';
import { isLocalDbEnabled } from '../config/feature-flags';
import { getCompositionRoot } from '../app/composition-root';

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

function buildDevAuthFallbackIdentity(): { teacher: Teacher; school: School } {
  const now = new Date();
  const schoolId = process.env.DEV_FALLBACK_SCHOOL_ID || '11111111-1111-1111-1111-111111111111';
  const schoolName = process.env.DEV_FALLBACK_SCHOOL_NAME || 'Dev School';
  const schoolDomain = process.env.DEV_FALLBACK_SCHOOL_DOMAIN || 'devschool.local';

  const school: School = {
    id: schoolId,
    name: schoolName,
    domain: schoolDomain,
    district_id: undefined,
    subscription_status: 'active',
    subscription_tier: 'basic',
    student_count: 0,
    teacher_count: 1,
    created_at: now,
    subscription_end_date: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  };

  const teacherId = process.env.DEV_FALLBACK_TEACHER_ID || '00000000-0000-0000-0000-000000000001';
  const teacherEmail = process.env.E2E_TEACHER_EMAIL || process.env.DEV_FALLBACK_TEACHER_EMAIL || 'teacher@example.com';
  const teacherName = process.env.DEV_FALLBACK_TEACHER_NAME || 'Dev Teacher';

  const teacher: Teacher = {
    id: teacherId,
    google_id: process.env.DEV_FALLBACK_TEACHER_GOOGLE_ID || `dev-google-${teacherId}`,
    email: teacherEmail,
    name: teacherName,
    picture: process.env.DEV_FALLBACK_TEACHER_AVATAR || '',
    school_id: schoolId,
    role: (process.env.DEV_FALLBACK_TEACHER_ROLE as Teacher['role']) || 'teacher',
    status: 'active',
    access_level: process.env.DEV_FALLBACK_TEACHER_ACCESS_LEVEL || 'full',
    max_concurrent_sessions: 3,
    current_sessions: 0,
    timezone: process.env.DEV_FALLBACK_TEACHER_TIMEZONE || 'UTC',
    login_count: 1,
    total_sessions_created: 0,
    created_at: now,
    updated_at: now,
  };

  return { teacher, school };
}

async function upsertLocalDbIdentity(teacher: Teacher, school: School): Promise<void> {
  if (!isLocalDbEnabled()) return;

  try {
    const composition = getCompositionRoot();
    if (composition.getDbProvider() !== 'postgres') return;
    const db = composition.getDbPort();

    await db.upsert('users.schools', ['id'], {
      id: school.id,
      name: school.name,
      domain: school.domain,
      created_at: school.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db.upsert('users.teachers', ['id'], {
      id: teacher.id,
      email: teacher.email,
      name: teacher.name,
      school_id: teacher.school_id ?? school.id,
      created_at: teacher.created_at ?? new Date().toISOString(),
    });
  } catch (error) {
    logger.warn('Failed to upsert dev identity into local Postgres', {
      userId: teacher.id,
      schoolId: school.id,
      error: (error as Error)?.message || String(error),
    });
  }
}

async function handleDevAuthFallback(
  req: Request,
  res: Response,
  requestId: string,
  startTime: number,
  trigger: string | undefined,
): Promise<Response> {
  const fallbackStart = performance.now();
  const { teacher, school } = buildDevAuthFallbackIdentity();
  const sessionId = generateSessionId();

  logger.warn('dev auth fallback engaged', {
    requestId,
    trigger,
    teacherId: teacher.id,
    schoolId: school.id,
  });

  let secureTokens;
  try {
    secureTokens = await SecureJWTService.generateSecureTokens(teacher, school, sessionId, req);
  } catch (error) {
    logger.error('Failed to generate secure tokens during dev auth fallback', { error: (error as Error)?.message || String(error) });
    throw error;
  }

  try {
    await storeSessionOptimized(sessionId, teacher, school, req);
  } catch (error) {
    logger.error('Failed to store secure session during dev auth fallback', { error: (error as Error)?.message || String(error) });
  }

  if (isLocalDbEnabled()) {
    await upsertLocalDbIdentity(teacher, school);
  }

  if (isDatabricksMockEnabled()) {
    try {
      await databricksService.upsert(
        'classwaves.users.schools',
        { id: school.id },
        {
          id: school.id,
          name: school.name,
          domain: school.domain,
          subscription_status: school.subscription_status ?? 'active',
          subscription_tier: school.subscription_tier ?? 'basic',
          created_at: school.created_at ?? new Date(),
          updated_at: new Date(),
        },
      );

      await databricksService.upsert(
        'classwaves.users.teachers',
        { id: teacher.id },
        {
          id: teacher.id,
          email: teacher.email,
          name: teacher.name,
          role: teacher.role,
          status: teacher.status ?? 'active',
          school_id: teacher.school_id,
          google_id: teacher.google_id,
          access_level: teacher.access_level ?? 'full',
          login_count: teacher.login_count ?? 1,
          last_login: new Date(),
          updated_at: new Date(),
        },
      );
    } catch (error) {
      logger.warn('Failed to seed dev fallback identity into databricks mock', {
        error: (error as Error)?.message || String(error),
      });
    }
  }

  recordAuthDevFallback(trigger ?? 'unknown');

  const totalAuthTime = performance.now() - startTime;
  authHealthMonitor.recordAuthAttempt(true, totalAuthTime, requestId);
  authHealthMonitor.recordAuthEnd(requestId);

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
    degradedMode: true,
    provider: isLocalDbEnabled() ? 'postgres' : 'databricks',
    performance: {
      totalTime: performance.now() - fallbackStart,
      fallback: 'dev',
      trigger,
      requestId,
    },
  });
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
  
  logger.debug(`🚀 RESILIENT AUTH START - Google Auth Handler [${requestId}]`);
  
  // Record auth attempt start for monitoring
  authHealthMonitor.recordAuthStart(requestId);
  
  try {
    const { code, codeVerifier } = req.body ?? {};

    const devFallbackDecision = getDevAuthFallbackDecision(req);
    if (devFallbackDecision.shouldFallback) {
      return await handleDevAuthFallback(req, res, requestId, startTime, devFallbackDecision.trigger);
    }

    logger.debug(`🛡️ Using authorization code authentication [${requestId}]`);

    let authResult: {
      teacher: Teacher;
      school: School;
      tokens: { accessToken: string; refreshToken: string } | null;
      sessionId: string | null;
      degradedMode: boolean;
    } | null = null;

    if (code) {
      // Handle authorization code flow
      logger.debug(`🔑 Processing authorization code flow [${requestId}]`);
      logger.debug(`PKCE_ENABLED: true [${requestId}]`, { hasCodeVerifier: Boolean(codeVerifier) });
      const googleClient = getGoogleClient();
      
      try {
        if (!codeVerifier) {
          logger.warn(`PKCE_VERIFIER_MISSING_OR_INVALID [${requestId}]`);
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

        if (!batchResult || !batchResult.teacher || !batchResult.school) {
          throw new Error('Batch auth operation did not return teacher/school data');
        }

        authResult = {
          teacher: batchResult.teacher,
          school: batchResult.school,
          tokens: null,
          sessionId: null,
          degradedMode: false
        };
      } catch (error) {
        logger.error(`🚨 Authorization code authentication failed [${requestId}]:`, error);
        logger.error(`PKCE_EXCHANGE_FAILED [${requestId}]`);
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
    logger.debug(`⏱️ Authentication took ${authTime.toFixed(2)}ms [${requestId}]`);
    logger.debug(`PKCE_EXCHANGE_OK: true [${requestId}]`);
    
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
      logger.debug(`🔄 Generating tokens due to degraded mode or missing tokens [${requestId}]`);
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
      logger.error(`❌ Failed to store secure session [${requestId}]:`, storeErr);
    }
    
    logger.debug(`⏱️ Token processing took ${(performance.now() - tokenGenerationStart).toFixed(2)}ms [${requestId}]`);
    
    // Return success response FIRST (don't wait for audit log)
    const totalAuthTime = performance.now() - startTime;
    logger.debug(`🎉 RESILIENT AUTH COMPLETE - Auth time: ${totalAuthTime.toFixed(2)}ms [${requestId}]`);
    
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

    // Fire-and-forget audit enqueue
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: authResult.teacher.id,
      actorType: 'teacher',
      eventType: 'login',
      eventCategory: 'authentication',
      resourceType: 'session',
      resourceId: sessionId,
      schoolId: authResult.school.id,
      description: `teacher:${authResult.teacher.id} login successful`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
      sessionId,
    }).catch(() => {});

    return response;
    
  } catch (error) {
    const authTime = performance.now() - startTime;
    logger.error(`Resilient Google auth error [${requestId}]:`, error);
    
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
  logger.debug('TOKEN ROTATION START');
  
  try {
    const { refreshToken } = req.body;
    
    // Validate input
    if (!refreshToken) {
      return fail(res, ErrorCodes.INVALID_INPUT, 'Refresh token is required for token rotation', 400);
    }
    
    logger.debug('Validating refresh token for rotation');
    
    // ATOMIC OPERATION: Rotate tokens and update session
    logger.debug('Starting atomic token rotation');
    const newTokens = await SecureJWTService.rotateTokens(refreshToken, req);
    
    if (!newTokens) {
      const rotationTime = performance.now() - rotationStart;
      logger.warn('TOKEN ROTATION FAILED', { durationMs: Number(rotationTime.toFixed(2)) });
      return fail(res, ErrorCodes.INVALID_TOKEN, 'Invalid or expired refresh token', 401, {
        performance: {
          rotationTime: rotationTime,
        }
      });
    }
    
    const rotationTime = performance.now() - rotationStart;
    logger.debug('TOKEN ROTATION COMPLETE', { durationMs: Number(rotationTime.toFixed(2)) });
    
    // CRITICAL: Set new session cookie atomically with token generation
    // This ensures the session cookie matches the device fingerprint in Redis
    logger.debug('Setting updated session cookie with new device fingerprint');
    res.cookie('session_id', newTokens.deviceFingerprint, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
      maxAge: newTokens.expiresIn * 1000,
      path: '/'
    });
    
    logger.debug('Session cookie updated successfully');
    
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
    logger.error('Token rotation failed', { error: (error as any)?.message || String(error) });
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to rotate tokens', 500);
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
  logger.debug('🚪 SECURE LOGOUT START');
  
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
        
        logger.debug(`🔒 All tokens and sessions revoked for user: ${payload.userId}`);
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
    logger.debug(`🎉 SECURE LOGOUT COMPLETE - Time: ${logoutTime.toFixed(2)}ms`);
    
    return res.json({
      success: true,
      message: 'Successfully logged out',
      performance: {
        logoutTime: logoutTime,
        timestamp: new Date().toISOString(),
      }
    });
    
  } catch (error) {
    logger.error('❌ Secure logout failed:', error);
    
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
  logger.debug('Starting generateTestTokenHandler');
  
  // Allow in test and development environments
  if (process.env.NODE_ENV === 'production') {
    logger.warn('Test token endpoint hit in production');
    return fail(res, ErrorCodes.NOT_FOUND, 'Endpoint not available in production environment', 404);
  }
  logger.debug('Environment check passed for test token endpoint');

  try {
    const { secretKey } = req.body;
    logger.debug('Test token request received', { hasSecretKey: !!secretKey });
    
    // Verify secret key (simple validation for testing)
    if (secretKey !== process.env.E2E_TEST_SECRET) {
      logger.warn('Test token secret key validation failed');
      return fail(res, ErrorCodes.AUTH_REQUIRED, 'Invalid secret key for test token generation', 401);
    }
    logger.debug('Test token secret key validation passed');

    // Create a test teacher and school for the token
    const useLocalDb =
      (process.env.DB_PROVIDER || '').toLowerCase() === 'postgres' ||
      (process.env[FeatureFlags.DB_USE_LOCAL_POSTGRES] || '').toLowerCase() === '1' ||
      (process.env.CW_DB_USE_LOCAL_POSTGRES || '').toLowerCase() === '1' ||
      (process.env.USE_LOCAL_DB || '').toLowerCase() === '1';

    const testTeacher = useLocalDb
      ? {
          id: '00000000-0000-0000-0000-000000000001',
          email: process.env.E2E_TEACHER_EMAIL || 'teacher@example.com',
          name: 'Dev Teacher',
          role: 'teacher',
          access_level: 'full',
        }
      : {
          id: 'test-teacher-id',
          email: 'test.teacher@testschool.edu',
          name: 'Test Teacher',
          role: 'teacher',
          access_level: 'full',
        };

    const testSchool = useLocalDb
      ? {
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Dev School',
          domain: 'devschool.local',
          subscription_tier: 'development',
        }
      : {
          id: 'test-school-id',
          name: 'Test School',
          domain: 'testschool.edu',
          subscription_tier: 'professional',
        };
    logger.debug('Test teacher and school objects created');

    // Generate secure tokens for testing
    logger.debug('Starting session ID generation');
    const sessionId = generateSessionId();
    logger.debug('Session ID generated');
    
    logger.debug('Starting secure token generation');
    
    const secureTokens = await SecureJWTService.generateSecureTokens(
      testTeacher as Teacher, 
      testSchool as School, 
      sessionId, 
      req
    );
    logger.debug('Secure tokens generated successfully');

    // Store a secure session so cookie-based auth works in E2E
    logger.debug('Starting secure session storage');
    try {
      await SecureSessionService.storeSecureSession(
        sessionId,
        testTeacher as Teacher,
        testSchool as School,
        req
      );
      logger.debug('Secure session storage completed successfully');
    } catch (e) {
      logger.error('Failed to store secure test session', { error: (e as any)?.message || String(e) });
    }

    // Set session cookie for convenience (Playwright also sets it, but this makes API usage consistent)
    logger.debug('Setting session cookie');
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
    });

    logger.debug('Preparing successful response');
    const response = {
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
    };
    
    logger.debug('generateTestTokenHandler completed successfully');
    return res.json(response);

  } catch (error) {
    logger.error('FATAL ERROR in generateTestTokenHandler', { error: (error as any)?.message || String(error) });
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to generate test authentication token', 500);
  }
}
