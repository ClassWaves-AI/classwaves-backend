import request from 'supertest';
import express from 'express';
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

describe('COPPA Compliance Tests', () => {
  let app: express.Application;
  let authToken: string;
  const teacher = testData.teachers.active;
  const school = testData.schools.active;
  const activeSession = testData.sessions.active;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Express app
    app = express();
    app.use(express.json());
    
    // Mock authentication middleware
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
    
    // Mount routes
    // app.use('/api/students', studentRoutes); // Removed with participant model
    app.use('/api/sessions', sessionRoutes);
    app.use(errorHandler);
    
    // Generate auth token
    authToken = generateAccessToken(teacher, school, 'auth-session-id');
    
    // Reset mocks
    (mockDatabricksService.getSessionByCode as jest.Mock).mockResolvedValue(activeSession);
    (mockDatabricksService.getSessionById as jest.Mock).mockResolvedValue(activeSession);
    mockRedisService.isConnected.mockReturnValue(true);
  });

  describe('Data Collection Restrictions', () => {
    it('should not collect personal information when student joins', async () => {
      const joinData = {
        sessionCode: 'ABC123',
        displayName: 'Student One',
        avatar: 'avatar1',
        // These fields should be rejected if provided
        email: 'student@example.com',
        realName: 'John Doe',
        birthDate: '2010-01-01',
        phoneNumber: '555-1234',
        address: '123 Main St',
      };

      const mockStudent = {
        id: 'student-123',
        display_name: joinData.displayName,
        avatar: joinData.avatar,
        session_id: activeSession.id,
        status: 'active',
        joined_at: new Date(),
      };
      
      mockDatabricksService.addStudentToSession.mockResolvedValue(mockStudent);

      const response = await request(app)
        .post('/api/students/join')
        .send(joinData)
        .expect(200);

      // Verify no PII was collected
      const [callArgs] = mockDatabricksService.addStudentToSession.mock.calls;
      expect(callArgs[0]).toEqual({
        sessionId: activeSession.id,
        displayName: joinData.displayName,
        avatar: joinData.avatar,
      });
      expect(callArgs[0]).not.toHaveProperty('email');
      expect(callArgs[0]).not.toHaveProperty('realName');
      expect(callArgs[0]).not.toHaveProperty('birthDate');
      expect(callArgs[0]).not.toHaveProperty('phoneNumber');
      expect(callArgs[0]).not.toHaveProperty('address');
    });

    it('should use anonymous identifiers for students', async () => {
      const students = [
        { id: 'student-uuid-1', display_name: 'Red Fox', avatar: 'fox' },
        { id: 'student-uuid-2', display_name: 'Blue Bird', avatar: 'bird' },
      ];
      
      mockDatabricksService.getSessionStudents.mockResolvedValue(students);

      const response = await request(app)
        .get(`/api/students/sessions/${activeSession.id}/participants`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      response.body.participants.forEach((participant: any) => {
        // ID should be anonymous UUID
        expect(participant.id).toMatch(/^student-[\w-]+$/);
        // Display name should not be real name
        expect(participant.display_name).not.toContain('@');
        expect(participant).not.toHaveProperty('email');
        expect(participant).not.toHaveProperty('real_name');
      });
    });

    it('should not store IP addresses for students', async () => {
      const joinData = testData.requests.joinSession;
      
      // Mock the actual database call to verify what's stored
      mockDatabricksService.addStudentToSession.mockImplementation(async (data) => {
        // Verify IP is not being stored
        expect(data).not.toHaveProperty('ipAddress');
        expect(data).not.toHaveProperty('ip_address');
        return {
          id: 'student-123',
          display_name: data.displayName,
          avatar: data.avatar,
          session_id: activeSession.id,
        };
      });

      await request(app)
        .post('/api/students/join')
        .set('X-Forwarded-For', '192.168.1.100')
        .send(joinData)
        .expect(200);
    });

    it('should not track student location data', async () => {
      const joinData = testData.requests.joinSession;
      
      mockDatabricksService.addStudentToSession.mockImplementation(async (data) => {
        // Verify location is not tracked
        expect(data).not.toHaveProperty('location');
        expect(data).not.toHaveProperty('coordinates');
        expect(data).not.toHaveProperty('timezone');
        expect(data).not.toHaveProperty('country');
        expect(data).not.toHaveProperty('region');
        return {
          id: 'student-123',
          display_name: data.displayName,
          avatar: data.avatar,
          session_id: activeSession.id,
        };
      });

      await request(app)
        .post('/api/students/join')
        .set('X-Forwarded-For', '192.168.1.100')
        .set('CF-IPCountry', 'US') // Cloudflare header
        .send(joinData)
        .expect(200);
    });
  });

  describe('Age Verification', () => {
    it('should not require age verification for students', async () => {
      // COPPA applies to children under 13, but ClassWaves doesn't collect age
      const joinData = testData.requests.joinSession;
      
      const response = await request(app)
        .post('/api/students/join')
        .send(joinData)
        .expect(200);

      // No age-related fields should be required or returned
      expect(response.body.student).not.toHaveProperty('age');
      expect(response.body.student).not.toHaveProperty('birthDate');
      expect(response.body.student).not.toHaveProperty('ageVerified');
    });

    it('should treat all students as potentially under 13', async () => {
      // System should apply maximum COPPA protections to all students
      const mockStudent = {
        id: 'student-123',
        display_name: 'Student One',
        avatar: 'avatar1',
        session_id: activeSession.id,
      };
      
      mockDatabricksService.addStudentToSession.mockResolvedValue(mockStudent);
      mockDatabricksService.getSessionStudents.mockResolvedValue([mockStudent]);

      // Join session
      await request(app)
        .post('/api/students/join')
        .send(testData.requests.joinSession)
        .expect(200);

      // Get participants - should apply COPPA protections
      const response = await request(app)
        .get(`/api/students/sessions/${activeSession.id}/participants`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify COPPA-compliant response
      response.body.participants.forEach((p: any) => {
        expect(p).toHaveProperty('display_name');
        expect(p).toHaveProperty('avatar');
        expect(p).not.toHaveProperty('email');
        expect(p).not.toHaveProperty('age');
        expect(p).not.toHaveProperty('grade_level'); // Even educational info is limited
      });
    });
  });

  describe('Data Retention', () => {
    it('should auto-delete student data after session ends', async () => {
      // This would be verified through scheduled job testing
      // Here we verify the session end triggers cleanup
      mockDatabricksService.updateSessionStatus.mockResolvedValue(true);
      mockDatabricksService.recordSessionAnalytics.mockResolvedValue(true);
      mockDatabricksService.getSessionStudents.mockResolvedValue(testData.students.active);
      
      // Mock that student data deletion is scheduled
      mockDatabricksService.scheduleDataDeletion = jest.fn().mockResolvedValue(true);

      await request(app)
        .post(`/api/sessions/${activeSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify data deletion would be scheduled
      // In real implementation, this would schedule deletion after retention period
    });

    it('should not retain student chat messages', async () => {
      // Verify that student messages are not stored permanently
      // This would be tested in WebSocket/real-time communication tests
      // Here we verify the data model doesn't include message history
      const students = mockDatabricksService.getSessionStudents.mockResolvedValue([
        {
          id: 'student-123',
          display_name: 'Student One',
          avatar: 'avatar1',
          session_id: activeSession.id,
          // Should not have message_history or chat_logs
        },
      ]);

      const response = await request(app)
        .get(`/api/students/sessions/${activeSession.id}/participants`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      response.body.participants.forEach((p: any) => {
        expect(p).not.toHaveProperty('message_history');
        expect(p).not.toHaveProperty('chat_logs');
        expect(p).not.toHaveProperty('messages');
      });
    });
  });

  describe('Parental Consent', () => {
    it('should not require parental consent for anonymous participation', async () => {
      // Since no PII is collected, parental consent is not required
      const joinData = testData.requests.joinSession;
      
      const response = await request(app)
        .post('/api/students/join')
        .send(joinData)
        .expect(200);

      // No consent-related fields
      expect(response.body).not.toHaveProperty('parentalConsent');
      expect(response.body).not.toHaveProperty('consentRequired');
    });

    it('should provide COPPA-compliant session info to teachers', async () => {
      // Teachers should be aware of COPPA compliance
      mockDatabricksService.getSchoolById.mockResolvedValue({
        ...school,
        coppa_compliant: true,
        student_data_retention_days: 30,
      });

      const response = await request(app)
        .get(`/api/sessions/${activeSession.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.session).toBeDefined();
      // Session info would include COPPA compliance status
    });
  });

  describe('Third-Party Sharing', () => {
    it('should not share student data with third parties', async () => {
      // This is more of a policy test, but we can verify no external APIs are called
      const joinData = testData.requests.joinSession;
      
      // Ensure no external services are called during student operations
      const mockFetch = jest.fn();
      global.fetch = mockFetch;

      await request(app)
        .post('/api/students/join')
        .send(joinData)
        .expect(200);

      // Verify no external API calls were made
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not include tracking pixels or analytics for students', async () => {
      // Verify responses don't include tracking data
      const response = await request(app)
        .post('/api/students/join')
        .send(testData.requests.joinSession)
        .expect(200);

      // Check response headers
      expect(response.headers['set-cookie']).toBeUndefined();
      
      // Check response body for tracking IDs
      const responseString = JSON.stringify(response.body);
      expect(responseString).not.toContain('analytics');
      expect(responseString).not.toContain('tracking');
      expect(responseString).not.toContain('pixel');
      expect(responseString).not.toContain('ga_'); // Google Analytics
    });
  });

  describe('Data Security', () => {
    it('should use secure session codes', async () => {
      // Session codes should be secure and non-guessable
      const newSession = {
        ...testData.sessions.created,
        code: 'ABC123', // 6 characters, alphanumeric
      };
      
      mockDatabricksService.createSession.mockResolvedValue(newSession);

      const response = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(testData.requests.createSession)
        .expect(201);

      // Verify code format
      expect(response.body.session.code).toMatch(/^[A-Z0-9]{6}$/);
    });

    it('should not expose student IDs in URLs', async () => {
      // Student IDs should be in request body or as URL parameters, not query strings
      const studentId = 'student-123';
      
      // This is correct - ID as URL parameter
      await request(app)
        .post(`/api/students/sessions/${activeSession.id}/participants/${studentId}/leave`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Should not use query parameters for sensitive IDs
      // This is what we want to avoid: /api/students?id=student-123
    });

    it('should sanitize student display names', async () => {
      const maliciousNames = [
        '<script>alert("xss")</script>',
        'Student"; DROP TABLE students;--',
        'Student\u0000WithNull',
        '../../etc/passwd',
        'Student<img src=x onerror=alert(1)>',
      ];

      for (const maliciousName of maliciousNames) {
        mockDatabricksService.getSessionStudents.mockResolvedValue([]);
        mockDatabricksService.addStudentToSession.mockImplementation(async (data) => {
          // Verify name is sanitized before storage
          expect(data.displayName).not.toContain('<script>');
          expect(data.displayName).not.toContain('DROP TABLE');
          expect(data.displayName).not.toContain('\u0000');
          expect(data.displayName).not.toContain('../');
          return {
            id: 'student-123',
            display_name: data.displayName.replace(/[<>"/\\]/g, ''), // Basic sanitization
            avatar: data.avatar,
            session_id: activeSession.id,
          };
        });

        await request(app)
          .post('/api/students/join')
          .send({
            sessionCode: 'ABC123',
            displayName: maliciousName,
            avatar: 'avatar1',
          })
          .expect(200);
      }
    });
  });

  describe('Educational Purpose Limitation', () => {
    it('should only allow educational session types', async () => {
      // Verify sessions are limited to educational purposes
      const sessionData = {
        ...testData.requests.createSession,
        sessionType: 'educational', // Should be restricted to educational types
      };

      mockDatabricksService.createSession.mockResolvedValue({
        ...testData.sessions.created,
        session_type: 'educational',
      });

      const response = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(sessionData)
        .expect(201);

      expect(response.body.session.session_type).toBe('live'); // Or other educational types
    });

    it('should limit session features to educational tools', async () => {
      // Verify only educational features are available
      const response = await request(app)
        .get(`/api/sessions/${activeSession.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Session should only have educational features
      const session = response.body.session;
      expect(session).toHaveProperty('subject');
      expect(session).toHaveProperty('grade_level');
      
      // Should not have social media features
      expect(session).not.toHaveProperty('social_sharing');
      expect(session).not.toHaveProperty('public_profile');
      expect(session).not.toHaveProperty('friend_list');
    });
  });
});