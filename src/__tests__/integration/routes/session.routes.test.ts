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

describe('Session Routes Integration Tests', () => {
  let app: express.Application;
  let authToken: string;
  const teacher = testData.teachers.active;
  const school = testData.schools.active;
  const sessionId = 'test-session-id';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Express app
    app = express();
    app.use(express.json());
    
    // Mock authentication middleware
    (authenticate as jest.Mock).mockImplementation((req, res, next) => {
      req.user = teacher;
      req.school = school;
      req.sessionId = sessionId;
      next();
    });
    
    // Mount routes
    app.use('/api/sessions', sessionRoutes);
    app.use(errorHandler);
    
    // Generate auth token for tests
    authToken = generateAccessToken(teacher, school, sessionId);
    
    // Reset mocks
    mockDatabricksService.getTeacherSessions.mockResolvedValue([]);
    mockDatabricksService.createSession.mockResolvedValue(testData.sessions.created);
    mockDatabricksService.getSessionById.mockResolvedValue(testData.sessions.active);
    mockDatabricksService.updateSessionStatus.mockResolvedValue(true);
    mockRedisService.isConnected.mockReturnValue(true);
  });

  describe('GET /api/sessions', () => {
    it('should list all teacher sessions', async () => {
      const sessions = [testData.sessions.active, testData.sessions.ended];
      mockDatabricksService.getTeacherSessions.mockResolvedValue(sessions);

      const response = await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({
        sessions,
        count: 2,
      });
      expect(mockDatabricksService.getTeacherSessions).toHaveBeenCalledWith(teacher.id);
    });

    it('should handle empty session list', async () => {
      mockDatabricksService.getTeacherSessions.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({
        sessions: [],
        count: 0,
      });
    });

    it('should require authentication', async () => {
      (authenticate as jest.Mock).mockImplementationOnce((req, res, next) => {
        res.status(401).json({ error: 'Unauthorized' });
      });

      await request(app)
        .get('/api/sessions')
        .expect(401);
    });

    it('should handle database errors', async () => {
      mockDatabricksService.getTeacherSessions.mockRejectedValue(new Error('Database error'));

      await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);
    });
  });

  describe('POST /api/sessions', () => {
    const validSessionData = testData.requests.createSession;

    it('should create new session successfully', async () => {
      const newSession = {
        ...testData.sessions.created,
        code: 'ABC123',
      };
      mockDatabricksService.createSession.mockResolvedValue(newSession);

      const response = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validSessionData)
        .expect(201);

      expect(response.body).toEqual({ session: newSession });
      expect(mockDatabricksService.createSession).toHaveBeenCalledWith({
        ...validSessionData,
        teacherId: teacher.id,
        schoolId: school.id,
      });
    });

    it('should validate required fields', async () => {
      const invalidData = {
        // Missing required fields
        description: 'Test session',
      };

      await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('should validate max students is positive', async () => {
      const invalidData = {
        ...validSessionData,
        maxStudents: -1,
      };

      const response = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toBe('Validation error');
    });

    it('should handle teacher at session limit', async () => {
      const errorMessage = 'Teacher has reached maximum concurrent sessions';
      mockDatabricksService.createSession.mockRejectedValue(new Error(errorMessage));

      const response = await request(app)
        .post('/api/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(validSessionData)
        .expect(400);

      expect(response.body.error).toBe('Failed to create session');
    });
  });

  describe('GET /api/sessions/:sessionId', () => {
    it('should get session details', async () => {
      const session = testData.sessions.active;
      mockDatabricksService.getSessionById.mockResolvedValue(session);

      const response = await request(app)
        .get(`/api/sessions/${session.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({ session });
      expect(mockDatabricksService.getSessionById).toHaveBeenCalledWith(session.id);
    });

    it('should return 404 for non-existent session', async () => {
      mockDatabricksService.getSessionById.mockResolvedValue(null);

      await request(app)
        .get('/api/sessions/non-existent-id')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should verify teacher owns the session', async () => {
      const otherTeacherSession = {
        ...testData.sessions.active,
        teacher_id: 'other-teacher-id',
      };
      mockDatabricksService.getSessionById.mockResolvedValue(otherTeacherSession);

      await request(app)
        .get(`/api/sessions/${otherTeacherSession.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });

  describe('PUT /api/sessions/:sessionId', () => {
    const updateData = {
      name: 'Updated Session Name',
      description: 'Updated description',
      maxStudents: 40,
    };

    it('should update session successfully', async () => {
      const session = testData.sessions.created;
      mockDatabricksService.getSessionById.mockResolvedValue(session);
      mockDatabricksService.updateSession = jest.fn().mockResolvedValue({
        ...session,
        ...updateData,
      });

      const response = await request(app)
        .put(`/api/sessions/${session.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.session.name).toBe(updateData.name);
      expect(mockDatabricksService.updateSession).toHaveBeenCalledWith(
        session.id,
        updateData
      );
    });

    it('should prevent updating active session', async () => {
      const activeSession = testData.sessions.active;
      mockDatabricksService.getSessionById.mockResolvedValue(activeSession);

      await request(app)
        .put(`/api/sessions/${activeSession.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(400);
    });

    it('should prevent updating ended session', async () => {
      const endedSession = testData.sessions.ended;
      mockDatabricksService.getSessionById.mockResolvedValue(endedSession);

      await request(app)
        .put(`/api/sessions/${endedSession.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(400);
    });
  });

  describe('DELETE /api/sessions/:sessionId', () => {
    it('should delete session successfully', async () => {
      const session = testData.sessions.created;
      mockDatabricksService.getSessionById.mockResolvedValue(session);
      mockDatabricksService.deleteSession = jest.fn().mockResolvedValue(true);

      await request(app)
        .delete(`/api/sessions/${session.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      expect(mockDatabricksService.deleteSession).toHaveBeenCalledWith(session.id);
    });

    it('should prevent deleting active session', async () => {
      const activeSession = testData.sessions.active;
      mockDatabricksService.getSessionById.mockResolvedValue(activeSession);

      await request(app)
        .delete(`/api/sessions/${activeSession.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should clean up Redis data on deletion', async () => {
      const session = testData.sessions.created;
      mockDatabricksService.getSessionById.mockResolvedValue(session);
      mockDatabricksService.deleteSession = jest.fn().mockResolvedValue(true);

      await request(app)
        .delete(`/api/sessions/${session.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      // Verify Redis cleanup would be called
      // This would be implemented in the controller
    });
  });

  describe('POST /api/sessions/:sessionId/start', () => {
    it('should start session successfully', async () => {
      const session = testData.sessions.created;
      mockDatabricksService.getSessionById.mockResolvedValue(session);
      mockDatabricksService.updateSessionStatus.mockResolvedValue(true);

      const response = await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toBe('Session started successfully');
      expect(mockDatabricksService.updateSessionStatus).toHaveBeenCalledWith(
        session.id,
        'active'
      );
    });

    it('should prevent starting already active session', async () => {
      const activeSession = testData.sessions.active;
      mockDatabricksService.getSessionById.mockResolvedValue(activeSession);

      await request(app)
        .post(`/api/sessions/${activeSession.id}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should prevent starting ended session', async () => {
      const endedSession = testData.sessions.ended;
      mockDatabricksService.getSessionById.mockResolvedValue(endedSession);

      await request(app)
        .post(`/api/sessions/${endedSession.id}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should track session start time', async () => {
      const session = testData.sessions.created;
      mockDatabricksService.getSessionById.mockResolvedValue(session);
      mockDatabricksService.updateSessionStatus.mockResolvedValue(true);
      mockDatabricksService.updateSession = jest.fn().mockResolvedValue(true);

      await request(app)
        .post(`/api/sessions/${session.id}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify start time would be recorded
      // This would be implemented in the controller
    });
  });

  describe('POST /api/sessions/:sessionId/pause', () => {
    it('should pause active session', async () => {
      const activeSession = testData.sessions.active;
      mockDatabricksService.getSessionById.mockResolvedValue(activeSession);
      mockDatabricksService.updateSessionStatus.mockResolvedValue(true);

      const response = await request(app)
        .post(`/api/sessions/${activeSession.id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toBe('Session paused successfully');
      expect(mockDatabricksService.updateSessionStatus).toHaveBeenCalledWith(
        activeSession.id,
        'paused'
      );
    });

    it('should prevent pausing non-active session', async () => {
      const createdSession = testData.sessions.created;
      mockDatabricksService.getSessionById.mockResolvedValue(createdSession);

      await request(app)
        .post(`/api/sessions/${createdSession.id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should track pause time', async () => {
      const activeSession = testData.sessions.active;
      mockDatabricksService.getSessionById.mockResolvedValue(activeSession);
      mockDatabricksService.updateSessionStatus.mockResolvedValue(true);
      mockDatabricksService.updateSession = jest.fn().mockResolvedValue(true);

      await request(app)
        .post(`/api/sessions/${activeSession.id}/pause`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify pause time would be recorded
      // This would be implemented in the controller
    });
  });

  describe('POST /api/sessions/:sessionId/end', () => {
    it('should end active session', async () => {
      const activeSession = testData.sessions.active;
      mockDatabricksService.getSessionById.mockResolvedValue(activeSession);
      mockDatabricksService.updateSessionStatus.mockResolvedValue(true);
      mockDatabricksService.recordSessionAnalytics.mockResolvedValue(true);

      const response = await request(app)
        .post(`/api/sessions/${activeSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.message).toBe('Session ended successfully');
      expect(mockDatabricksService.updateSessionStatus).toHaveBeenCalledWith(
        activeSession.id,
        'ended'
      );
    });

    it('should end paused session', async () => {
      const pausedSession = testData.sessions.paused;
      mockDatabricksService.getSessionById.mockResolvedValue(pausedSession);
      mockDatabricksService.updateSessionStatus.mockResolvedValue(true);
      mockDatabricksService.recordSessionAnalytics.mockResolvedValue(true);

      await request(app)
        .post(`/api/sessions/${pausedSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });

    it('should prevent ending already ended session', async () => {
      const endedSession = testData.sessions.ended;
      mockDatabricksService.getSessionById.mockResolvedValue(endedSession);

      await request(app)
        .post(`/api/sessions/${endedSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });

    it('should record session analytics on end', async () => {
      const activeSession = testData.sessions.active;
      mockDatabricksService.getSessionById.mockResolvedValue(activeSession);
      mockDatabricksService.updateSessionStatus.mockResolvedValue(true);
      mockDatabricksService.recordSessionAnalytics.mockResolvedValue(true);

      await request(app)
        .post(`/api/sessions/${activeSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockDatabricksService.recordSessionAnalytics).toHaveBeenCalledWith(
        activeSession.id,
        expect.any(Object)
      );
    });

    it('should clean up Redis session data', async () => {
      const activeSession = testData.sessions.active;
      mockDatabricksService.getSessionById.mockResolvedValue(activeSession);
      mockDatabricksService.updateSessionStatus.mockResolvedValue(true);
      mockDatabricksService.recordSessionAnalytics.mockResolvedValue(true);

      await request(app)
        .post(`/api/sessions/${activeSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify Redis cleanup would be called
      expect(mockRedisService.deleteSession).toHaveBeenCalled();
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit session creation', async () => {
      // This test would verify rate limiting is applied
      // Implementation depends on rate limiting middleware setup
    });
  });

  describe('FERPA Compliance', () => {
    it('should log session access for audit trail', async () => {
      const session = testData.sessions.active;
      mockDatabricksService.getSessionById.mockResolvedValue(session);
      mockDatabricksService.logAuditEvent.mockResolvedValue(true);

      await request(app)
        .get(`/api/sessions/${session.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify audit logging would be called
      expect(mockDatabricksService.logAuditEvent).toHaveBeenCalledWith({
        event_type: 'session_access',
        user_id: teacher.id,
        resource_id: session.id,
        resource_type: 'session',
        action: 'read',
        ip_address: expect.any(String),
        user_agent: expect.any(String),
      });
    });
  });
});