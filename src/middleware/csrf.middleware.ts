import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { redisService } from '../services/redis.service';
import { AuthRequest } from '../types/auth.types';

const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_EXPIRY = 3600; // 1 hour
const CSRF_HEADER_NAME = 'X-CSRF-Token';
const CSRF_COOKIE_NAME = 'csrf-token';

// Safe methods that don't require CSRF protection
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// Generate a secure CSRF token
export function generateCSRFToken(): string {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

// Store CSRF token in Redis
async function storeCSRFToken(sessionId: string, token: string): Promise<void> {
  const key = `csrf:${sessionId}`;
  await redisService.getClient().setex(key, CSRF_TOKEN_EXPIRY, token);
}

// Validate CSRF token from Redis
async function validateCSRFToken(sessionId: string, token: string): Promise<boolean> {
  const key = `csrf:${sessionId}`;
  const storedToken = await redisService.getClient().get(key);
  
  if (!storedToken || !token) {
    return false;
  }
  
  // Use timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(storedToken),
    Buffer.from(token)
  );
}

// Middleware to generate and attach CSRF token
export async function csrfTokenGenerator(req: Request, res: Response, next: NextFunction) {
  const authReq = req as AuthRequest;
  
  // Skip for unauthenticated requests
  if (!authReq.sessionId) {
    return next();
  }
  
  // Skip for safe methods
  if (SAFE_METHODS.includes(req.method)) {
    // Generate new token for GET requests to forms
    const token = generateCSRFToken();
    await storeCSRFToken(authReq.sessionId, token);
    
    // Attach token to response locals for template rendering
    res.locals.csrfToken = token;
    
    // Set CSRF token cookie (httpOnly: false so JS can read it)
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
      maxAge: CSRF_TOKEN_EXPIRY * 1000
    });
  }
  
  next();
}

// Middleware to validate CSRF token
export async function csrfProtection(req: Request, res: Response, next: NextFunction) {
  const authReq = req as AuthRequest;
  
  // Skip for unauthenticated requests
  if (!authReq.sessionId) {
    return next();
  }
  
  // Skip for safe methods
  if (SAFE_METHODS.includes(req.method)) {
    return next();
  }
  
  // Get token from header or body
  const token = req.headers[CSRF_HEADER_NAME.toLowerCase()] as string ||
                req.body?._csrf ||
                req.query?._csrf as string;
  
  if (!token) {
    return res.status(403).json({
      error: 'CSRF_TOKEN_MISSING',
      message: 'CSRF token is required for this request'
    });
  }
  
  // Validate token
  const isValid = await validateCSRFToken(authReq.sessionId, token);
  
  if (!isValid) {
    return res.status(403).json({
      error: 'CSRF_TOKEN_INVALID',
      message: 'Invalid CSRF token'
    });
  }
  
  // Token is valid, continue
  next();
}

// Helper function to get CSRF token for a session
export async function getCSRFToken(sessionId: string): Promise<string | null> {
  const key = `csrf:${sessionId}`;
  return await redisService.getClient().get(key);
}

// Helper function to invalidate CSRF token
export async function invalidateCSRFToken(sessionId: string): Promise<void> {
  const key = `csrf:${sessionId}`;
  await redisService.getClient().del(key);
}

// Middleware factory for selective CSRF protection
export function requireCSRF(options?: { 
  skipRoutes?: string[],
  customHeader?: string 
}) {
  const skipRoutes = options?.skipRoutes || [];
  const headerName = options?.customHeader || CSRF_HEADER_NAME;
  
  return async (req: Request, res: Response, next: NextFunction) => {
    // Skip if route is in skip list
    if (skipRoutes.some(route => req.path.startsWith(route))) {
      return next();
    }
    
    // Apply CSRF protection
    await csrfProtection(req, res, next);
  };
}