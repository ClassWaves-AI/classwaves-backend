import { Request, Response, NextFunction } from 'express';
import { verifyToken, JWTPayload } from '../utils/jwt.utils';
import { AuthRequest } from '../types/auth.types';
import { redisService } from '../services/redis.service';

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
        // Verify JWT token and extract session ID
        const payload = verifyToken(token) as JWTPayload;
        
        if (payload.type !== 'access') {
          return res.status(401).json({
            error: 'INVALID_TOKEN_TYPE',
            message: 'Invalid token type',
          });
        }
        effectiveSessionId = payload.sessionId;
      } else {
        // Use session ID from cookie directly
        effectiveSessionId = sessionId!;
      }

      // Check if session exists in Redis
      const sessionLookupStart = performance.now();
      const sessionData = await redisService.getSession(effectiveSessionId);
      console.log(`⏱️  Session lookup took ${(performance.now() - sessionLookupStart).toFixed(2)}ms`);
      
      if (!sessionData) {
        return res.status(401).json({
          error: 'SESSION_EXPIRED',
          message: 'Session has expired or been invalidated',
        });
      }

      // Add user info to request from Redis session
      (req as AuthRequest).user = sessionData.teacher;
      (req as AuthRequest).school = sessionData.school;
      (req as AuthRequest).sessionId = effectiveSessionId;

      const authTotal = performance.now() - authStart;
      console.log(`🔐 AUTH MIDDLEWARE COMPLETE - Total time: ${authTotal.toFixed(2)}ms`);
      
      next();
    } catch (tokenError) {
      return res.status(401).json({
        error: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
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