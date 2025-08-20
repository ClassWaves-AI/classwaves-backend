import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '../utils/jwt.utils';
import { AuthRequest } from '../types/auth.types';
import { redisService } from '../services/redis.service';
import { SecureJWTService } from '../services/secure-jwt.service';
import { SecureSessionService } from '../services/secure-session.service';

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const authStart = performance.now();
  console.log('🔐 AUTH MIDDLEWARE START');
  console.log('📋 Request headers:', JSON.stringify({
    authorization: req.headers.authorization ? 'Bearer ***' : 'none',
    cookie: req.headers.cookie || 'none'
  }, null, 2));
  console.log('🍪 Parsed cookies:', req.cookies);
  
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
      console.log('🍪 Using session cookie for authentication');
    } 
    else {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'No valid authorization token provided',
      });
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
          // Verify JWT token with enhanced security
          const payload = await SecureJWTService.verifyTokenSecurity(token, req, 'access');
          if (!payload) {
            return res.status(401).json({
              error: 'INVALID_TOKEN',
              message: 'Invalid or expired token',
            });
          }
          if (payload.type !== 'access') {
            return res.status(401).json({
              error: 'INVALID_TOKEN_TYPE',
              message: 'Invalid token type',
            });
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
            return next();
          }
        } catch (e) {
          // Fallback to cookie-based session if available
          if (req.cookies?.session_id) {
            console.warn('⚠️  Authorization token invalid; falling back to session cookie');
            effectiveSessionId = req.cookies.session_id;
          } else {
            console.error('Token verification error:', e);
            return res.status(401).json({
              error: 'INVALID_TOKEN',
              message: 'Invalid or expired token',
            });
          }
        }
      } else {
        // Use session ID from cookie directly
        effectiveSessionId = sessionId!;
      }

      // Check if session exists using secure session service
      const sessionLookupStart = performance.now();
      const sessionData = await SecureSessionService.getSecureSession(effectiveSessionId, req);
      console.log(`⏱️  Secure session lookup took ${(performance.now() - sessionLookupStart).toFixed(2)}ms`);
      
      if (!sessionData) {
        // Enhanced logging for rotation debugging
        console.warn(`🚨 Session lookup failed for session ID: ${effectiveSessionId}`);
        console.warn('🚨 This could be due to:');
        console.warn('   1. Session expired naturally');
        console.warn('   2. Token rotation in progress (deviceFingerprint mismatch)');
        console.warn('   3. Session invalidated by security policy');
        console.warn(`   4. JWT token source: ${token ? 'Bearer token' : 'session cookie'}`);
        
        // For token rotation scenarios, provide a more specific error
        // This helps clients understand they may need to re-authenticate or retry
        const errorResponse = {
          error: 'SESSION_EXPIRED',
          message: 'Session has expired or been invalidated',
          // Add rotation hint for debugging (development only)
          ...(process.env.NODE_ENV === 'development' && {
            debug: {
              sessionId: effectiveSessionId,
              tokenSource: token ? 'jwt' : 'cookie',
              hint: 'If this occurs during token rotation, the session may be updating'
            }
          })
        };
        
        return res.status(401).json(errorResponse);
      }

      // Add user info to request from Redis session
      (req as AuthRequest).user = sessionData.teacher;
      (req as AuthRequest).school = sessionData.school;
      (req as AuthRequest).sessionId = effectiveSessionId;

      const authTotal = performance.now() - authStart;
      console.log(`🔐 AUTH MIDDLEWARE COMPLETE - Total time: ${authTotal.toFixed(2)}ms`);
      
      next();
    } catch (tokenError) {
      console.error('Authentication error:', tokenError);
      return res.status(500).json({
        error: 'AUTHENTICATION_ERROR',
        message: 'An error occurred during authentication',
      });
    }
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).json({
      error: 'AUTHENTICATION_ERROR',
      message: 'An error occurred during authentication',
    });
  }
}

export function requireRole(roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    
    if (!authReq.user) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    if (!roles.includes(authReq.user.role)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Insufficient permissions',
        required: roles,
        current: authReq.user.role,
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