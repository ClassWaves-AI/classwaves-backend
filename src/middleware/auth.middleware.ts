import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '../utils/jwt.utils';
import { AuthRequest } from '../types/auth.types';
import { SecureJWTService } from '../services/secure-jwt.service';
import { SecureSessionService } from '../services/secure-session.service';
import { fail } from '../utils/api-response';
import { ErrorCodes } from '@classwaves/shared';
import { logger } from '../utils/logger';
import { parseClaims, type AuthContext, hasAnyRole } from '../utils/auth-claims';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authStart = performance.now();
  logger.debug('AUTH MIDDLEWARE START');
  logger.debug('Auth request headers received', {
    hasAuthorization: !!req.headers.authorization,
    hasCookie: !!req.headers.cookie,
  });
  
  try {
    const authHeader = req.headers.authorization;
    let token: string | null = null;
    let sessionId: string | null = null;

    // Try to get token from Authorization header first
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7); // Remove 'Bearer ' prefix
    } 
    // Fallback: Check for session cookie (for session restoration)
    else if (req.cookies?.session_id) {
      sessionId = req.cookies.session_id;
      logger.debug('🍪 Using session cookie for authentication');
    } 
    else {
      return fail(res, ErrorCodes.AUTH_REQUIRED, 'No valid authorization token provided', 401);
    }
    
    try {
      let effectiveSessionId: string;

      if (token) {
        // Basic sanity check: JWT should contain two dots
        const looksLikeJwt = token.split('.').length === 3;
        try {
          if (!looksLikeJwt) {
            throw new Error('Token does not look like a JWT');
          }
          
          let payload: JWTPayload;
          
          // In test mode with E2E_TEST_SECRET, use basic JWT verification
          if (process.env.NODE_ENV === 'test' && process.env.E2E_TEST_SECRET) {
            logger.debug('Using test mode JWT verification');
            payload = verifyToken(token) as JWTPayload;
          } else {
            // Verify JWT token with enhanced security
            const securePayload = await SecureJWTService.verifyTokenSecurity(token, req, 'access');
            if (!securePayload) {
              return fail(res, ErrorCodes.INVALID_TOKEN, 'Invalid or expired token', 401);
            }
            // Convert SecureJWTPayload to JWTPayload
            payload = {
              userId: securePayload.userId,
              email: securePayload.email,
              schoolId: securePayload.schoolId,
              role: securePayload.role,
              sessionId: securePayload.sessionId,
              type: securePayload.type
            };
          }
          if (payload.type !== 'access') {
            return fail(res, ErrorCodes.INVALID_TOKEN, 'Invalid token type', 401);
          }
          // PREFER session cookie if present, since it represents the current active session
          // The JWT sessionId might be from a previous session that got rotated
          effectiveSessionId = req.cookies?.session_id || payload.sessionId;

          // Test-mode fallback: populate req.user directly from token when Redis is not part of unit tests
          if (process.env.NODE_ENV === 'test') {
            (req as AuthRequest).user = {
              id: payload.userId,
              email: payload.email,
              school_id: payload.schoolId,
              role: payload.role,
              status: 'active',
              access_level: payload.role === 'admin' ? 'admin' : 'teacher',
              max_concurrent_sessions: 5,
              current_sessions: 1,
              timezone: 'UTC',
            } as any;
            (req as AuthRequest).school = { id: payload.schoolId } as any;
            (req as AuthRequest).sessionId = effectiveSessionId;
            ;(req as any).authContext = parseClaims({ ...payload, roles: (payload as any)?.roles ?? [payload.role], sub: payload.userId }) as AuthContext;
            return next();
          }
        } catch (e) {
          // Fallback to cookie-based session if available
          if (req.cookies?.session_id) {
            logger.warn('Authorization token invalid; falling back to session cookie');
            effectiveSessionId = req.cookies.session_id;
          } else {
            logger.warn('Token verification error', { error: (e as any)?.message || String(e) });
            return fail(res, ErrorCodes.INVALID_TOKEN, 'Invalid or expired token', 401);
          }
        }
      } else {
        // Use session ID from cookie directly
        effectiveSessionId = sessionId!;
      }

      // Check if session exists using secure session service
      const sessionLookupStart = performance.now();
      const sessionData = await SecureSessionService.getSecureSession(effectiveSessionId, req);
      logger.debug('Secure session lookup timing', { durationMs: Number((performance.now() - sessionLookupStart).toFixed(2)) });
      
      if (!sessionData) {
        // Enhanced logging for rotation debugging
        logger.warn('Session lookup failed', { sessionId: '[REDACTED]', tokenSource: token ? 'jwt' : 'cookie' });
        
        // For token rotation scenarios, provide a more specific error
        // This helps clients understand they may need to re-authenticate or retry
        return fail(res, ErrorCodes.AUTH_REQUIRED, 'Session has expired or been invalidated', 401);
      }

      // Add user info to request from Redis session
      (req as AuthRequest).user = sessionData.teacher;
      (req as AuthRequest).school = sessionData.school;
      (req as AuthRequest).sessionId = effectiveSessionId;

      // Attach derived AuthContext for RBAC helpers
      const roles = Array.isArray((sessionData.teacher as any)?.roles)
        ? (sessionData.teacher as any).roles
        : [sessionData.teacher.role]
      ;(req as any).authContext = {
        sub: sessionData.teacher.id,
        email: sessionData.teacher.email,
        schoolId: sessionData.school.id,
        roles,
        permissions: [],
      } as AuthContext;

      const authTotal = performance.now() - authStart;
      logger.debug('AUTH MIDDLEWARE COMPLETE', { durationMs: Number(authTotal.toFixed(2)) });
      
      next();
    } catch (tokenError) {
      logger.error('Authentication error', { error: (tokenError as any)?.message || String(tokenError) });
      return fail(res, ErrorCodes.INTERNAL_ERROR, 'An error occurred during authentication', 500);
    }
  } catch (error) {
    logger.error('Authentication error', { error: (error as any)?.message || String(error) });
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'An error occurred during authentication', 500);
  }
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    
    if (!authReq.user) {
      return fail(res, ErrorCodes.AUTH_REQUIRED, 'Authentication required', 401);
    }

    if (!roles.includes(authReq.user.role)) {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Insufficient permissions', 403, {
        required: roles,
        current: authReq.user.role,
      });
    }

    next();
  };
}

// New RBAC helpers
export function requireAnyRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = (req as any).authContext as AuthContext | undefined;
    if (!ctx || !hasAnyRole(ctx, roles)) {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Insufficient permissions', 403, {
        required: roles,
        current: ctx?.roles ?? [],
      });
    }
    next();
  };
}

export function requireSuperAdmin() {
  return requireAnyRole('super_admin');
}

export function requireSchoolMatch(paramKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    const ctx = (req as any).authContext as AuthContext | undefined;
    // super_admin bypasses tenant check
    if (ctx?.roles?.includes('super_admin')) return next();

    const targetId = (req.params as any)?.[paramKey] || (req.query as any)?.[paramKey];
    const currentSchoolId = authReq.school?.id || ctx?.schoolId;
    if (!targetId || !currentSchoolId || targetId !== currentSchoolId) {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Tenant boundary violation', 403, {
        requiredSchoolId: currentSchoolId,
        targetSchoolId: targetId,
      });
    }
    next();
  };
}

export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token provided, continue without authentication
    return next();
  }

  // If token is provided, validate it
  authenticate(req, res, next);
}
