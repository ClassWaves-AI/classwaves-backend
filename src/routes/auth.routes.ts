import { Router } from 'express';
import { googleAuthHandler, refreshTokenHandler, logoutHandler, generateTestTokenHandler } from '../controllers/auth.controller';
import { validate } from '../middleware/validation.middleware';
import { googleAuthSchema, refreshTokenSchema, generateTestTokenSchema } from '../utils/validation.schemas';
import { authenticate } from '../middleware/auth.middleware';
import { generateCSRFToken } from '../middleware/csrf.middleware';
import { AuthRequest } from '../types/auth.types';

const router = Router();

// Google OAuth callback
router.post('/google', validate(googleAuthSchema), googleAuthHandler);

// Refresh token
router.post('/refresh', validate(refreshTokenSchema), refreshTokenHandler);

// Logout
router.post('/logout', authenticate, logoutHandler);

// Get current user with fresh tokens (session validation)
router.get('/me', authenticate, async (req, res) => {
  const meStart = performance.now();
  console.log('👤 /auth/me ENDPOINT START');
  
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const school = authReq.school!;
    
    // Generate fresh tokens for the current session
    const { 
      generateAccessToken, 
      generateRefreshToken, 
      generateSessionId, 
      getExpiresInSeconds 
    } = await import('../utils/jwt.utils');
    
    const sessionId = generateSessionId();
    const accessToken = generateAccessToken(teacher, school, sessionId);
    const refreshToken = generateRefreshToken(teacher, school, sessionId);
    const expiresIn = getExpiresInSeconds();
    
    const meTotal = performance.now() - meStart;
    console.log(`👤 /auth/me ENDPOINT COMPLETE - Total time: ${meTotal.toFixed(2)}ms`);
    
    // Refresh session cookie
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: expiresIn * 1000,
      path: '/'
    });

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
        accessToken,
        refreshToken,
        expiresIn,
        tokenType: 'Bearer',
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

export default router;