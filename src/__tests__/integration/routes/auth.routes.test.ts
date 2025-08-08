import request from 'supertest';
import app from '../../../app';
import { databricksService } from '../../../services/databricks.service';
import { redisService } from '../../../services/redis.service';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { testData, createAuthHeader } from '../../fixtures/test-data';
import { 
  mockDatabricksService, 
  createMockSchool, 
  createMockTeacher 
} from '../../mocks/databricks.mock';
import { mockRedisService } from '../../mocks/redis.mock';
import { mockGoogleOAuth2Client, createMockIdTokenPayload } from '../../mocks/google-auth.mock';

// Mock external dependencies
jest.mock('../../../services/databricks.service');
jest.mock('../../../services/redis.service');
jest.mock('google-auth-library');

describe('Auth Routes Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mocks
    (databricksService as any) = mockDatabricksService;
    (redisService as any) = mockRedisService;
    (OAuth2Client as any).mockImplementation(() => mockGoogleOAuth2Client);
  });

  describe('POST /api/v1/auth/google', () => {
    const validAuthCode = 'valid-google-auth-code';
    
    beforeEach(() => {
      // Setup successful Google auth flow
      mockGoogleOAuth2Client.getToken.mockResolvedValue({
        tokens: {
          access_token: 'mock-access-token',
          refresh_token: 'mock-refresh-token',
          id_token: 'mock-id-token',
          token_type: 'Bearer',
          expiry_date: Date.now() + 3600000,
        },
      });

      mockGoogleOAuth2Client.verifyIdToken.mockResolvedValue({
        getPayload: jest.fn().mockReturnValue(createMockIdTokenPayload({
          email: 'teacher@school.edu',
          hd: 'school.edu',
        })),
      });
    });

    it('should successfully authenticate with valid Google code', async () => {
      const mockSchool = createMockSchool({
        domain: 'school.edu',
        subscription_status: 'active',
      });
      const mockTeacher = createMockTeacher({
        email: 'teacher@school.edu',
        school_id: mockSchool.id,
      });

      mockDatabricksService.getSchoolByDomain.mockResolvedValue(mockSchool);
      mockDatabricksService.upsertTeacher.mockResolvedValue(mockTeacher);

      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({ code: validAuthCode })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        teacher: {
          id: mockTeacher.id,
          email: mockTeacher.email,
          name: mockTeacher.name,
          role: mockTeacher.role,
        },
        school: {
          id: mockSchool.id,
          name: mockSchool.name,
          domain: mockSchool.domain,
        },
        tokens: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          expiresIn: expect.any(Number),
          tokenType: 'Bearer',
        },
      });

      // Verify session was stored
      expect(mockRedisService.storeSession).toHaveBeenCalled();
      
      // Verify audit log was recorded
      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'login',
          eventCategory: 'authentication',
          actorId: mockTeacher.id,
        })
      );
    });

    it('should reject missing authorization code', async () => {
      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({})
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: expect.arrayContaining([
          expect.objectContaining({
            field: 'code',
            message: 'Authorization code is required',
          }),
        ]),
      });
    });

    it('should reject personal email domains', async () => {
      mockGoogleOAuth2Client.verifyIdToken.mockResolvedValue({
        getPayload: jest.fn().mockReturnValue(createMockIdTokenPayload({
          email: 'teacher@gmail.com',
          hd: undefined,
        })),
      });

      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({ code: validAuthCode })
        .expect(403);

      expect(response.body).toMatchObject({
        error: 'INVALID_EMAIL_DOMAIN',
        message: 'Please use your school email address to sign in',
      });
    });

    it('should reject unauthorized school domains', async () => {
      mockGoogleOAuth2Client.verifyIdToken.mockResolvedValue({
        getPayload: jest.fn().mockReturnValue(createMockIdTokenPayload({
          email: 'teacher@unauthorized.edu',
          hd: 'unauthorized.edu',
        })),
      });

      mockDatabricksService.getSchoolByDomain.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({ code: validAuthCode })
        .expect(403);

      expect(response.body).toMatchObject({
        error: 'SCHOOL_NOT_AUTHORIZED',
        message: 'Domain unauthorized.edu is not authorized for ClassWaves',
        domain: 'unauthorized.edu',
        contactInfo: {
          email: 'schools@classwaves.com',
          phone: '1-800-CLASSWAVES',
        },
      });
    });

    it('should reject inactive school subscriptions', async () => {
      const mockSchool = createMockSchool({
        domain: 'school.edu',
        subscription_status: 'expired',
      });

      mockDatabricksService.getSchoolByDomain.mockResolvedValue(mockSchool);

      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({ code: validAuthCode })
        .expect(403);

      expect(response.body).toMatchObject({
        error: 'SUBSCRIPTION_INACTIVE',
        message: 'School subscription is not active',
        status: 'expired',
      });
    });

    it('should handle trial subscriptions', async () => {
      const mockSchool = createMockSchool({
        domain: 'school.edu',
        subscription_status: 'trial',
        trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      });
      const mockTeacher = createMockTeacher({
        email: 'teacher@school.edu',
        school_id: mockSchool.id,
      });

      mockDatabricksService.getSchoolByDomain.mockResolvedValue(mockSchool);
      mockDatabricksService.upsertTeacher.mockResolvedValue(mockTeacher);

      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({ code: validAuthCode })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should handle Google OAuth errors', async () => {
      mockGoogleOAuth2Client.getToken.mockRejectedValue(new Error('Invalid authorization code'));

      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({ code: 'invalid-code' })
        .expect(500);

      expect(response.body).toMatchObject({
        error: 'AUTHENTICATION_FAILED',
        message: 'Failed to authenticate with Google',
      });
    });

    it('should handle invalid ID token', async () => {
      mockGoogleOAuth2Client.verifyIdToken.mockResolvedValue({
        getPayload: jest.fn().mockReturnValue(null),
      });

      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({ code: validAuthCode })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'INVALID_TOKEN',
        message: 'Unable to verify Google token',
      });
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    const validRefreshToken = jwt.sign(
      {
        userId: 'teacher-123',
        email: 'teacher@school.edu',
        schoolId: 'school-123',
        role: 'teacher',
        sessionId: 'session-123',
        type: 'refresh',
      },
      process.env.JWT_SECRET || 'test-jwt-secret'
    );

    it('should refresh tokens successfully', async () => {
      const mockTeacher = createMockTeacher({ id: 'teacher-123', status: 'active' });
      const mockSchool = createMockSchool({ id: 'school-123', subscription_status: 'active' });

      mockDatabricksService.queryOne
        .mockResolvedValueOnce(mockTeacher) // getTeacher query
        .mockResolvedValueOnce(mockSchool); // getSchool query

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken })
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        tokens: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          expiresIn: expect.any(Number),
          tokenType: 'Bearer',
        },
      });

      // Verify new session was stored
      expect(mockRedisService.storeSession).toHaveBeenCalled();
      expect(mockRedisService.storeRefreshToken).toHaveBeenCalled();
    });

    it('should reject invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' })
        .expect(401);

      expect(response.body).toMatchObject({
        error: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token',
      });
    });

    it('should reject access tokens', async () => {
      const accessToken = jwt.sign(
        {
          userId: 'teacher-123',
          email: 'teacher@school.edu',
          schoolId: 'school-123',
          role: 'teacher',
          sessionId: 'session-123',
          type: 'access',
        },
        process.env.JWT_SECRET || 'test-jwt-secret'
      );

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: accessToken })
        .expect(401);

      expect(response.body).toMatchObject({
        error: 'INVALID_TOKEN_TYPE',
        message: 'Invalid refresh token',
      });
    });

    it('should reject if teacher not found', async () => {
      mockDatabricksService.queryOne.mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken })
        .expect(401);

      expect(response.body).toMatchObject({
        error: 'TEACHER_NOT_FOUND',
        message: 'Teacher account not found or inactive',
      });
    });

    it('should reject if teacher is suspended', async () => {
      const mockTeacher = createMockTeacher({ 
        id: 'teacher-123', 
        status: 'suspended' 
      });

      mockDatabricksService.queryOne.mockResolvedValueOnce(mockTeacher);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken })
        .expect(401);

      expect(response.body).toMatchObject({
        error: 'TEACHER_NOT_FOUND',
        message: 'Teacher account not found or inactive',
      });
    });

    it('should reject if school subscription expired', async () => {
      const mockTeacher = createMockTeacher({ id: 'teacher-123', status: 'active' });
      const mockSchool = createMockSchool({ 
        id: 'school-123', 
        subscription_status: 'expired' 
      });

      mockDatabricksService.queryOne
        .mockResolvedValueOnce(mockTeacher)
        .mockResolvedValueOnce(mockSchool);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: validRefreshToken })
        .expect(401);

      expect(response.body).toMatchObject({
        error: 'SCHOOL_INACTIVE',
        message: 'School subscription is not active',
      });
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    const validAccessToken = jwt.sign(
      {
        userId: 'teacher-123',
        email: 'teacher@school.edu',
        schoolId: 'school-123',
        role: 'teacher',
        sessionId: 'session-123',
        type: 'access',
      },
      process.env.JWT_SECRET || 'test-jwt-secret'
    );

    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${validAccessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Logged out successfully',
      });

      // Verify session was deleted
      expect(mockRedisService.deleteSession).toHaveBeenCalledWith('session-123');
      expect(mockRedisService.deleteRefreshToken).toHaveBeenCalledWith('session-123');

      // Verify audit log
      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'logout',
          eventCategory: 'authentication',
          actorId: 'teacher-123',
        })
      );
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .expect(401);

      expect(response.body).toMatchObject({
        error: 'UNAUTHORIZED',
        message: 'No valid authorization token provided',
      });
    });

    it('should handle expired tokens gracefully', async () => {
      const expiredToken = jwt.sign(
        {
          userId: 'teacher-123',
          email: 'teacher@school.edu',
          schoolId: 'school-123',
          role: 'teacher',
          sessionId: 'session-123',
          type: 'access',
        },
        process.env.JWT_SECRET || 'test-jwt-secret',
        { expiresIn: '-1h' }
      );

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body).toMatchObject({
        error: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
      });
    });
  });

  describe('GET /api/v1/auth/me', () => {
    const validAccessToken = jwt.sign(
      {
        userId: 'teacher-123',
        email: 'teacher@school.edu',
        schoolId: 'school-123',
        role: 'teacher',
        sessionId: 'session-123',
        type: 'access',
      },
      process.env.JWT_SECRET || 'test-jwt-secret'
    );

    it('should return current user info', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${validAccessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        user: {
          id: 'teacher-123',
          email: 'teacher@school.edu',
          school_id: 'school-123',
          role: 'teacher',
          status: 'active',
        },
      });
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .expect(401);

      expect(response.body).toMatchObject({
        error: 'UNAUTHORIZED',
        message: 'No valid authorization token provided',
      });
    });

    it('should reject invalid tokens', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body).toMatchObject({
        error: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce auth endpoint rate limits', async () => {
      // Make 5 requests (the limit)
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/v1/auth/google')
          .send({ code: 'test-code' })
          .expect(500); // Will fail but counts toward rate limit
      }

      // 6th request should be rate limited
      const response = await request(app)
        .post('/api/v1/auth/google')
        .send({ code: 'test-code' })
        .expect(429);

      expect(response.body).toMatchObject({
        message: 'Too many authentication attempts',
      });
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in responses', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.headers).toMatchObject({
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'x-xss-protection': '0',
      });
    });
  });
});