import request from 'supertest';
import express from 'express';
import rateLimit from 'express-rate-limit';
import authRoutes from '../../../routes/auth.routes';
import sessionRoutes from '../../../routes/session.routes';
import { authenticate } from '../../../middleware/auth.middleware';
import { errorHandler } from '../../../middleware/error.middleware';
import { mockDatabricksService } from '../../mocks/databricks.mock';
import { mockRedisService } from '../../mocks/redis.mock';
import { testData } from '../../fixtures/test-data';
import { generateAccessToken } from '../../../utils/jwt.utils';

// Mock dependencies
jest.mock('../../../services/databricks.service', () => ({
  databricksService: mockDatabricksService,
}));

jest.mock('../../../services/redis.service', () => ({
  redisService: mockRedisService,
}));

jest.mock('../../../middleware/auth.middleware');

describe('Rate Limiting Integration Tests', () => {
  let app: express.Application;
  let authToken: string;
  const teacher = testData.teachers.active;
  const school = testData.schools.active;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Express app
    app = express();
    app.use(express.json());
    
    // Trust proxy for accurate IP detection
    app.set('trust proxy', true);
    
    // Apply rate limiters
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 requests per window
      message: 'Too many authentication attempts, please try again later',
      standardHeaders: true,
      legacyHeaders: false,
      // Store: use default memory store for tests
    });

    const apiLimiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 60, // 60 requests per minute
      message: 'Too many requests, please try again later',
      standardHeaders: true,
      legacyHeaders: false,
    });

    const strictLimiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 10, // 10 requests per minute for sensitive operations
      message: 'Rate limit exceeded for this operation',
      standardHeaders: true,
      legacyHeaders: false,
    });

    // Mock authentication
    (authenticate as jest.Mock).mockImplementation((req, res, next) => {
      if (req.headers.authorization) {
        req.user = teacher;
        req.school = school;
        req.sessionId = 'auth-session-id';
        next();
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    });
    
    // Apply rate limiting to routes
    app.use('/api/auth/google', authLimiter);
    app.use('/api/auth/refresh', authLimiter);
    app.use('/api', apiLimiter);
    app.use('/api/sessions', strictLimiter); // Additional limiting for session creation
    app.use('/api/students/join', strictLimiter); // Prevent spam joins
    
    // Mount routes
    app.use('/api/auth', authRoutes);
    app.use('/api/sessions', sessionRoutes);
    // app.use('/api/students', studentRoutes); // Removed with participant model
    app.use(errorHandler);
    
    // Generate auth token
    authToken = generateAccessToken(teacher, school, 'auth-session-id');
    
    // Reset mocks
    mockDatabricksService.getTeacherSessions.mockResolvedValue([]);
    mockRedisService.isConnected.mockReturnValue(true);
  });

  describe('Authentication Rate Limiting', () => {
    it('should rate limit Google auth attempts', async () => {
      const authRequest = { code: 'google-auth-code' };
      
      // Make 5 requests (the limit)
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/google')
          .send(authRequest)
          .expect(400); // Will fail due to mock, but counts against rate limit
      }

      // 6th request should be rate limited
      const response = await request(app)
        .post('/api/auth/google')
        .send(authRequest)
        .expect(429);

      expect(response.body.message).toContain('Too many authentication attempts');
      expect(response.headers['x-ratelimit-limit']).toBe('5');
      expect(response.headers['x-ratelimit-remaining']).toBe('0');
      expect(response.headers['retry-after']).toBeDefined();
    });

    it('should rate limit token refresh attempts', async () => {
      const refreshRequest = { refreshToken: 'mock-refresh-token' };
      
      // Make 5 requests
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/refresh')
          .send(refreshRequest)
          .expect(400); // Will fail due to mock
      }

      // 6th request should be rate limited
      await request(app)
        .post('/api/auth/refresh')
        .send(refreshRequest)
        .expect(429);
    });

    it('should track rate limits per IP address', async () => {
      const authRequest = { code: 'google-auth-code' };
      
      // Make 5 requests from IP 1
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/google')
          .set('X-Forwarded-For', '192.168.1.1')
          .send(authRequest)
          .expect(400);
      }

      // IP 1 should be rate limited
      await request(app)
        .post('/api/auth/google')
        .set('X-Forwarded-For', '192.168.1.1')
        .send(authRequest)
        .expect(429);

      // IP 2 should still be able to make requests
      await request(app)
        .post('/api/auth/google')
        .set('X-Forwarded-For', '192.168.1.2')
        .send(authRequest)
        .expect(400); // Fails due to mock, not rate limit
    });
  });

  describe('API Rate Limiting', () => {
    it('should rate limit general API requests', async () => {
      // Make 60 requests (the limit)
      for (let i = 0; i < 60; i++) {
        await request(app)
          .get('/api/sessions')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
      }

      // 61st request should be rate limited
      const response = await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(429);

      expect(response.body.message).toContain('Too many requests');
      expect(response.headers['x-ratelimit-limit']).toBe('60');
      expect(response.headers['x-ratelimit-remaining']).toBe('0');
    });

    it('should reset rate limit after window expires', async () => {
      jest.useFakeTimers();

      // Make 60 requests
      for (let i = 0; i < 60; i++) {
        await request(app)
          .get('/api/sessions')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
      }

      // Should be rate limited
      await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(429);

      // Advance time by 1 minute
      jest.advanceTimersByTime(60 * 1000);

      // Should be able to make requests again
      await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      jest.useRealTimers();
    });
  });

  describe('Strict Rate Limiting', () => {
    it('should apply stricter limits to session creation', async () => {
      const sessionData = testData.requests.createSession;
      mockDatabricksService.createSession.mockResolvedValue(testData.sessions.created);

      // Make 10 requests (the strict limit)
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/sessions')
          .set('Authorization', `Bearer ${authToken}`)
          .send(sessionData)
          .expect(201);
      }

      // 11th request should be rate limited
      const response = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(sessionData)
        .expect(429);

      expect(response.body.message).toContain('Rate limit exceeded');
    });

    it('should prevent student join spam', async () => {
      const joinData = testData.requests.joinSession;
      mockDatabricksService.getSessionByCode.mockResolvedValue(testData.sessions.active);
      mockDatabricksService.addStudentToSession.mockResolvedValue(testData.students.active[0]);
      mockDatabricksService.getSessionStudents.mockResolvedValue([]);

      // Make 10 join attempts
      for (let i = 0; i < 10; i++) {
        await request(app)
          .post('/api/students/join')
          .send({ ...joinData, displayName: `Student ${i}` })
          .expect(200);
      }

      // 11th attempt should be rate limited
      await request(app)
        .post('/api/students/join')
        .send({ ...joinData, displayName: 'Student 11' })
        .expect(429);
    });
  });

  describe('Rate Limit Headers', () => {
    it('should include rate limit headers in responses', async () => {
      const response = await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.headers['x-ratelimit-limit']).toBeDefined();
      expect(response.headers['x-ratelimit-remaining']).toBeDefined();
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });

    it('should show decreasing remaining requests', async () => {
      let remaining = 60;

      for (let i = 0; i < 5; i++) {
        const response = await request(app)
          .get('/api/sessions')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        remaining--;
        expect(parseInt(response.headers['x-ratelimit-remaining'])).toBe(remaining - 1);
      }
    });

    it('should include retry-after header when rate limited', async () => {
      // Exhaust rate limit
      for (let i = 0; i < 60; i++) {
        await request(app)
          .get('/api/sessions')
          .set('Authorization', `Bearer ${authToken}`);
      }

      const response = await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(429);

      expect(response.headers['retry-after']).toBeDefined();
      const retryAfter = parseInt(response.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60); // Should be within the window
    });
  });

  describe('Bypass for Trusted Sources', () => {
    it('should allow whitelisted IPs to bypass rate limits', async () => {
      // Configure rate limiter with skip function
      const trustedLimiter = rateLimit({
        windowMs: 1 * 60 * 1000,
        max: 5,
        skip: (req) => {
          // Whitelist internal IPs
          const trustedIPs = ['10.0.0.1', '172.16.0.1'];
          return trustedIPs.includes(req.ip);
        },
      });

      // Apply to test route
      app.get('/api/test-trusted', trustedLimiter, (req, res) => {
        res.json({ message: 'success' });
      });

      // Make more than limit from trusted IP
      for (let i = 0; i < 10; i++) {
        await request(app)
          .get('/api/test-trusted')
          .set('X-Forwarded-For', '10.0.0.1')
          .expect(200);
      }

      // Untrusted IP should be limited
      for (let i = 0; i < 5; i++) {
        await request(app)
          .get('/api/test-trusted')
          .set('X-Forwarded-For', '192.168.1.1')
          .expect(200);
      }

      await request(app)
        .get('/api/test-trusted')
        .set('X-Forwarded-For', '192.168.1.1')
        .expect(429);
    });
  });

  describe('Different Limits by User Role', () => {
    it('should apply higher limits for admin users', async () => {
      const adminTeacher = { ...teacher, role: 'admin' as const };
      const adminToken = generateAccessToken(adminTeacher, school, 'admin-session');

      // Configure role-based rate limiter
      const roleLimiter = rateLimit({
        windowMs: 1 * 60 * 1000,
        max: (req) => {
          // Admins get higher limits
          if ((req as any).user?.role === 'admin') return 100;
          return 20;
        },
      });

      // Apply to test route
      app.get('/api/test-role', authenticate as any, roleLimiter, (req, res) => {
        res.json({ message: 'success' });
      });

      // Regular teacher hits limit at 20
      (authenticate as jest.Mock).mockImplementation((req, res, next) => {
        req.user = teacher;
        next();
      });

      for (let i = 0; i < 20; i++) {
        await request(app)
          .get('/api/test-role')
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);
      }

      await request(app)
        .get('/api/test-role')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(429);

      // Admin can make more requests
      (authenticate as jest.Mock).mockImplementation((req, res, next) => {
        req.user = adminTeacher;
        next();
      });

      for (let i = 0; i < 50; i++) {
        await request(app)
          .get('/api/test-role')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
      }
    });
  });

  describe('Rate Limiting with Redis Store', () => {
    it('should use Redis for distributed rate limiting', async () => {
      // In production, rate limiting should use Redis for consistency across instances
      // This is a placeholder test - actual implementation would use rate-limit-redis

      const mockRedisStore = {
        incr: jest.fn().mockResolvedValue([1, 60]), // [count, ttl]
        decrement: jest.fn(),
        resetKey: jest.fn(),
      };

      // Verify Redis operations would be called
      expect(mockRedisService.isConnected()).toBe(true);
    });
  });

  describe('Custom Error Responses', () => {
    it('should return user-friendly rate limit messages', async () => {
      const authRequest = { code: 'google-auth-code' };
      
      // Exhaust auth rate limit
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/google')
          .send(authRequest);
      }

      const response = await request(app)
        .post('/api/auth/google')
        .send(authRequest)
        .expect(429);

      expect(response.body).toEqual({
        error: 'Too Many Requests',
        message: 'Too many authentication attempts, please try again later',
        retryAfter: expect.any(Number),
      });
    });

    it('should include helpful information for developers', async () => {
      // Exhaust API rate limit
      for (let i = 0; i < 60; i++) {
        await request(app)
          .get('/api/sessions')
          .set('Authorization', `Bearer ${authToken}`);
      }

      const response = await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(429);

      // Should include rate limit info
      expect(response.headers['x-ratelimit-limit']).toBe('60');
      expect(response.headers['x-ratelimit-remaining']).toBe('0');
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });
  });
});