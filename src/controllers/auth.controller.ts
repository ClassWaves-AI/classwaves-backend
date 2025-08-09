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

export async function googleAuthHandler(req: Request, res: Response): Promise<Response> {
  const startTime = performance.now();
  console.log('🚀 AUTH START - Google Auth Handler');
  
  try {
    const { code, credential } = req.body;
    
    console.log('🔍 GOOGLE TOKEN VERIFICATION START');
    const tokenStart = performance.now();
    let payload;
    
    try {
      const googleClient = getGoogleClient();
      if (credential) {
        // Handle ID token flow (from Google Sign-In JavaScript library)
        console.log('📱 Verifying Google ID token...');
        const ticket = await googleClient.verifyIdToken({
          idToken: credential,
          audience: process.env.GOOGLE_CLIENT_ID!,
        });
        payload = ticket.getPayload();
      } else if (code) {
        // Handle authorization code flow
        console.log('🔑 Exchanging authorization code...');
        const { tokens } = await googleClient.getToken(code);
        googleClient.setCredentials(tokens);
        
        // Get user information from Google
        const ticket = await googleClient.verifyIdToken({
          idToken: tokens.id_token!,
          audience: process.env.GOOGLE_CLIENT_ID!,
        });
        payload = ticket.getPayload();
      } else {
        return res.status(400).json({
          error: 'INVALID_REQUEST',
          message: 'Either code or credential must be provided',
        });
      }
      
      console.log(`⏱️  Google token verification took ${(performance.now() - tokenStart).toFixed(2)}ms`);
    } catch (error) {
      console.error('❌ Google token verification failed:', error);
      return res.status(400).json({
        error: 'INVALID_TOKEN',
        message: 'Failed to verify Google token',
      });
    }
    
    if (!payload) {
      return res.status(400).json({
        error: 'INVALID_TOKEN',
        message: 'Unable to verify Google token',
      });
    }
    
    const googleUser: GoogleUser = {
      id: payload.sub,
      email: payload.email!,
      verified_email: payload.email_verified || false,
      name: payload.name || '',
      given_name: payload.given_name || '',
      family_name: payload.family_name || '',
      picture: payload.picture || '',
      locale: payload.locale || 'en',
      hd: payload.hd,
    };
    
    // Extract and validate school domain
    const domain = validateSchoolDomain(googleUser.email);
    if (!domain) {
      return res.status(403).json({
        error: 'INVALID_EMAIL_DOMAIN',
        message: 'Please use your school email address to sign in',
      });
    }
    
    // Check if school is authorized (with improved error handling)
    console.log('🔍 SCHOOL LOOKUP START');
    const schoolQueryStart = performance.now();
    let school;
    try {
      school = await databricksService.getSchoolByDomain(domain);
      console.log(`⏱️  School lookup took ${(performance.now() - schoolQueryStart).toFixed(2)}ms`);
    } catch (error) {
      console.error('❌ School lookup failed:', error);
      return res.status(500).json({
        error: 'DATABASE_ERROR',
        message: 'Failed to verify school authorization',
      });
    }
    
    if (!school) {
      return res.status(403).json({
        error: 'SCHOOL_NOT_AUTHORIZED',
        message: `Domain ${domain} is not authorized for ClassWaves`,
        domain,
        contactInfo: {
          email: 'schools@classwaves.com',
          phone: '1-800-CLASSWAVES',
        },
      });
    }
    
    // Check school subscription status
    if (school.subscription_status !== 'active' && school.subscription_status !== 'trial') {
      return res.status(403).json({
        error: 'SUBSCRIPTION_INACTIVE',
        message: 'School subscription is not active',
        status: school.subscription_status,
      });
    }
    
    // Get or create teacher record (with improved error handling)
    console.log('🔍 TEACHER UPSERT START');
    const teacherQueryStart = performance.now();
    let teacher;
    try {
      teacher = await databricksService.upsertTeacher({
        google_id: googleUser.id,
        email: googleUser.email,
        name: googleUser.name,
        picture: googleUser.picture,
        school_id: school.id,
      });
      console.log(`⏱️  Teacher upsert took ${(performance.now() - teacherQueryStart).toFixed(2)}ms`);
    } catch (error) {
      console.error('❌ Teacher upsert failed:', error);
      return res.status(500).json({
        error: 'DATABASE_ERROR',
        message: 'Failed to create or update teacher record',
      });
    }
    
    // Generate ClassWaves tokens
    const sessionId = generateSessionId();
    const accessToken = generateAccessToken(teacher, school, sessionId);
    const refreshToken = generateRefreshToken(teacher, school, sessionId);
    const expiresIn = getExpiresInSeconds();
    
    // Store session
    const sessionStorageStart = performance.now();
    await storeSession(sessionId, teacher, school, req);
    
    // Store refresh token
    await redisService.storeRefreshToken(
      sessionId,
      teacher.id,
      30 * 24 * 60 * 60 // 30 days
    );
    console.log(`⏱️  Session storage took ${(performance.now() - sessionStorageStart).toFixed(2)}ms`);
    
    // Return success response FIRST (don't wait for audit log)
    const authTime = performance.now() - startTime;
    console.log(`🎉 AUTH COMPLETE (before audit) - Auth time: ${authTime.toFixed(2)}ms`);
    
    // Set HTTP-only session cookie for frontend session restoration
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: expiresIn * 1000, // Convert to milliseconds
      path: '/'
    });

    const response = res.json({
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

    // ASYNC audit logging (don't block response)
    setImmediate(async () => {
      console.log('🔍 ASYNC AUDIT LOG START');
      const auditLogStart = performance.now();
      try {
        await databricksService.recordAuditLog({
          actorId: teacher.id,
          actorType: 'teacher',
          eventType: 'login',
          eventCategory: 'authentication',
          resourceType: 'session',
          resourceId: sessionId,
          schoolId: school.id,
          description: `Teacher ${teacher.email} logged in successfully`,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          complianceBasis: 'legitimate_interest',
        });
        console.log(`⏱️  Async audit log took ${(performance.now() - auditLogStart).toFixed(2)}ms`);
        
        const totalTime = performance.now() - startTime;
        console.log(`🎉 TOTAL TIME (including audit) - ${totalTime.toFixed(2)}ms`);
      } catch (error) {
        console.error('⚠️  Async audit log failed:', error);
      }
    });

    return response;
    
  } catch (error) {
    console.error('Google auth error:', error);
    return res.status(500).json({
      error: 'AUTHENTICATION_FAILED',
      message: 'Failed to authenticate with Google',
    });
  }
}

export async function refreshTokenHandler(req: Request, res: Response): Promise<Response> {
  try {
    const { refreshToken } = req.body;
    
    // Verify refresh token
    const payload = verifyToken(refreshToken);
    
    if (payload.type !== 'refresh') {
      return res.status(401).json({
        error: 'INVALID_TOKEN_TYPE',
        message: 'Invalid refresh token',
      });
    }
    
    // Get teacher from database
    const teacher = await databricksService.queryOne<Teacher>(
      `SELECT * FROM classwaves.users.teachers WHERE id = ?`,
      [payload.userId]
    );
    
    if (!teacher || teacher.status !== 'active') {
      return res.status(401).json({
        error: 'TEACHER_NOT_FOUND',
        message: 'Teacher account not found or inactive',
      });
    }
    
    // Get school from database
    const school = await databricksService.queryOne<School>(
      `SELECT * FROM classwaves.users.schools WHERE id = ?`,
      [payload.schoolId]
    );
    
    if (!school || (school.subscription_status !== 'active' && school.subscription_status !== 'trial')) {
      return res.status(401).json({
        error: 'SCHOOL_INACTIVE',
        message: 'School subscription is not active',
      });
    }
    
    // Generate new access token
    const newSessionId = generateSessionId();
    const accessToken = generateAccessToken(teacher, school, newSessionId);
    const newRefreshToken = generateRefreshToken(teacher, school, newSessionId);
    const expiresIn = getExpiresInSeconds();
    
    // Store new session
    await storeSession(newSessionId, teacher, school, req);
    
    // Store refresh token
    await redisService.storeRefreshToken(
      payload.sessionId,
      teacher.id,
      30 * 24 * 60 * 60 // 30 days
    );
    
    return res.json({
      success: true,
      tokens: {
        accessToken,
        refreshToken: newRefreshToken,
        expiresIn,
        tokenType: 'Bearer',
      },
    });
    
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(401).json({
      error: 'INVALID_REFRESH_TOKEN',
      message: 'Invalid or expired refresh token',
    });
  }
}

export async function logoutHandler(req: Request, res: Response) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'NO_TOKEN',
        message: 'No authentication token provided',
      });
    }
    
    const token = authHeader.substring(7);
    
    try {
      const payload = verifyToken(token);
      
      // Delete session from Redis
      await redisService.deleteSession(payload.sessionId);
      
      // Delete refresh token if it exists
      await redisService.deleteRefreshToken(payload.sessionId);
      
      // Record audit log
      await databricksService.recordAuditLog({
        actorId: payload.userId,
        actorType: 'teacher',
        eventType: 'logout',
        eventCategory: 'authentication',
        resourceType: 'session',
        resourceId: payload.sessionId,
        schoolId: payload.schoolId,
        description: `Teacher ${payload.email} logged out`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        complianceBasis: 'legitimate_interest',
      });
      
      // Clear session cookie
      res.clearCookie('session_id', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/'
      });
      
      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    } catch (tokenError) {
      // Token might be expired, but we still return success
      res.json({
        success: true,
        message: 'Logged out successfully',
      });
    }
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      error: 'LOGOUT_FAILED',
      message: 'Failed to logout',
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
    const { secretKey, teacherId, schoolId, role = 'teacher', permissions = [] } = req.body;
    
    // Validate secret key
    const expectedSecret = process.env.E2E_TEST_SECRET;
    if (!expectedSecret || secretKey !== expectedSecret) {
      return res.status(401).json({
        error: 'INVALID_SECRET',
        message: 'Invalid test secret key',
      });
    }

    // Create test teacher object
    const testTeacher: Teacher = {
      id: teacherId || 'test_teacher_123',
      email: 'test-teacher@test.edu',
      name: 'E2E Test Teacher',
      role: role || 'teacher',
      access_level: 'standard',
      google_id: 'test_google_id',
      picture: 'https://example.com/test-avatar.jpg',
      school_id: schoolId || 'test_school_456',
      status: 'active',
      max_concurrent_sessions: 10,
      current_sessions: 0,
      timezone: 'America/New_York',
      login_count: 1,
      total_sessions_created: 0,
      last_login: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Create test school object
    const testSchool: School = {
      id: schoolId || 'test_school_456',
      name: 'E2E Test School',
      domain: 'test.edu',
      subscription_tier: 'pro',
      subscription_status: 'active',
      student_count: 100,
      teacher_count: 1,
      created_at: new Date(),
      subscription_end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
    };

    // Generate tokens
    const sessionId = generateSessionId();
    const accessToken = generateAccessToken(testTeacher, testSchool, sessionId);
    const refreshToken = generateRefreshToken(testTeacher, testSchool, sessionId);
    const expiresIn = getExpiresInSeconds();

    // Store test session (optional, for more realistic testing)
    await storeSession(sessionId, testTeacher, testSchool, req);
    await redisService.storeRefreshToken(
      sessionId,
      testTeacher.id,
      30 * 24 * 60 * 60 // 30 days
    );

    // Set HTTP-only session cookie so browser contexts are authenticated like real users
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: (process.env.NODE_ENV || '').toString() === 'production',
      sameSite: 'strict',
      maxAge: expiresIn * 1000,
      path: '/',
    });

    console.log(`🧪 Generated test token for E2E testing - Teacher: ${testTeacher.id}, School: ${testSchool.id}`);

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
        accessToken,
        refreshToken,
        expiresIn,
        tokenType: 'Bearer',
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