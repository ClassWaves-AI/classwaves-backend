import { Request, Response } from 'express';
import { 
  createSession, 
  getSession, 
  updateSession, 
  endSession,
  startSession,
  listSessions
} from '../../../controllers/session.controller';
import { databricksService } from '../../../services/databricks.service';
import { websocketService } from '../../../services/websocket.service';
import { redisService } from '../../../services/redis.service';
import { 
  createMockRequest, 
  createMockResponse, 
  createAuthenticatedRequest,
  assertErrorResponse,
  assertSuccessResponse
} from '../../utils/test-helpers';
import { AuthRequest } from '../../../types/auth.types';

// Mock all services
jest.mock('../../../services/databricks.service');
jest.mock('../../../services/websocket.service');
jest.mock('../../../services/redis.service');

describe('Session Controller', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  const mockTeacher = {
    id: 'teacher-123',
    email: 'teacher@school.edu',
    school_id: 'school-123',
    role: 'teacher',
    status: 'active',
  };

  beforeEach(() => {
    mockRes = createMockResponse();
    jest.clearAllMocks();
  });

  describe('createSession', () => {
    it('should create a new session successfully', async () => {
      const sessionData = {
        session_name: 'Math Class Period 1',
        subject: 'Mathematics',
        grade_level: 5,
        duration_minutes: 45,
        max_students: 30,
      };

      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: sessionData,
      });

      const mockSessionId = 'session-456';
      const mockAccessCode = 'ABC123';
      
      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ session_id: mockSessionId, access_code: mockAccessCode }],
      });

      await createSession(mockReq as AuthRequest, mockRes as Response);

      expect(databricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO main.classwaves.sessions'),
        expect.objectContaining({
          teacher_id: mockTeacher.id,
          school_id: mockTeacher.school_id,
          session_name: sessionData.session_name,
          subject: sessionData.subject,
          grade_level: sessionData.grade_level,
          status: 'waiting',
        })
      );

      expect(websocketService.createSessionRoom).toHaveBeenCalledWith(mockSessionId);
      
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        id: mockSessionId,
        accessCode: mockAccessCode,
        status: 'waiting',
        teacher: expect.objectContaining({
          id: mockTeacher.id,
          name: mockTeacher.email,
        }),
      });
    });

    it('should validate required fields', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: {
          // Missing required fields
          subject: 'Math',
        },
      });

      await createSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'VALIDATION_ERROR', 400);
    });

    it('should enforce session limits', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: {
          session_name: 'Math Class',
          subject: 'Mathematics',
          grade_level: 5,
          duration_minutes: 45,
        },
      });

      // Mock user has reached session limit
      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [{ active_sessions: 5 }], // Assuming limit is 5
      });

      await createSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_LIMIT_REACHED', 403);
    });
  });

  describe('getSession', () => {
    it('should get session details successfully', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { id: sessionId },
      });

      const mockSession = {
        id: sessionId,
        teacher_id: mockTeacher.id,
        school_id: mockTeacher.school_id,
        session_name: 'Math Class',
        subject: 'Mathematics',
        grade_level: 5,
        status: 'active',
        created_at: new Date(),
        student_count: 15,
      };

      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockSession],
      });

      await getSession(mockReq as AuthRequest, mockRes as Response);

      expect(databricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.objectContaining({ session_id: sessionId })
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id: sessionId,
          sessionName: mockSession.session_name,
          subject: mockSession.subject,
          gradeLevel: mockSession.grade_level,
          status: mockSession.status,
          studentCount: mockSession.student_count,
        })
      );
    });

    it('should return 404 for non-existent session', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { id: 'non-existent' },
      });

      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [],
      });

      await getSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_NOT_FOUND', 404);
    });

    it('should prevent unauthorized access to sessions', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { id: sessionId },
      });

      const mockSession = {
        id: sessionId,
        teacher_id: 'different-teacher',
        school_id: 'different-school',
        session_name: 'Math Class',
      };

      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockSession],
      });

      await getSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'FORBIDDEN', 403);
    });
  });

  describe('joinSession', () => {
    it('should allow student to join session', async () => {
      const joinData = {
        sessionCode: 'ABC123',
        studentName: 'John Doe',
        gradeLevel: '5',
        dateOfBirth: '2012-01-15',
      };

      mockReq = createMockRequest({
        body: joinData,
      });

      const mockSession = {
        id: 'session-123',
        access_code: 'ABC123',
        status: 'active',
        teacher_id: mockTeacher.id,
        school_id: mockTeacher.school_id,
      };

      const mockStudent = {
        id: 'student-456',
        display_name: joinData.studentName,
      };

      // Mock session lookup
      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockSession] })
        // Mock student creation
        .mockResolvedValueOnce({ rows: [mockStudent] })
        // Mock group assignment
        .mockResolvedValueOnce({ rows: [{ group_id: 'group-1' }] });

      // Mock Redis age check
      (redisService.get as jest.Mock).mockResolvedValueOnce(null);

      await joinSession(mockReq as Request, mockRes as Response);

      // Verify age was stored
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('student:age:'),
        expect.any(String),
        expect.any(Number)
      );

      // Verify WebSocket notification
      expect(websocketService.notifySessionUpdate).toHaveBeenCalledWith(
        'session-123',
        expect.objectContaining({
          type: 'student_joined',
          student: expect.objectContaining({
            id: 'student-456',
            name: joinData.studentName,
          }),
        })
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          token: expect.any(String),
          student: expect.objectContaining({
            id: 'student-456',
            displayName: joinData.studentName,
          }),
          session: expect.objectContaining({
            id: 'session-123',
          }),
        })
      );
    });

    it('should enforce COPPA age restrictions', async () => {
      const joinData = {
        sessionCode: 'ABC123',
        studentName: 'Young Student',
        dateOfBirth: new Date().toISOString(), // Born today - too young
      };

      mockReq = createMockRequest({
        body: joinData,
      });

      await joinSession(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'AGE_RESTRICTION', 403);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('at least 4 years old'),
        })
      );
    });

    it('should check for parental consent for under 13', async () => {
      const joinData = {
        sessionCode: 'ABC123',
        studentName: 'Young Student',
        dateOfBirth: '2015-01-01', // Under 13
      };

      mockReq = createMockRequest({
        body: joinData,
      });

      const mockSession = {
        id: 'session-123',
        access_code: 'ABC123',
        status: 'active',
      };

      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockSession] })
        // No parental consent found
        .mockResolvedValueOnce({ rows: [] });

      await joinSession(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'PARENTAL_CONSENT_REQUIRED', 403);
    });

    it('should prevent joining ended sessions', async () => {
      const joinData = {
        sessionCode: 'ABC123',
        studentName: 'John Doe',
        dateOfBirth: '2010-01-01',
      };

      mockReq = createMockRequest({
        body: joinData,
      });

      const mockSession = {
        id: 'session-123',
        access_code: 'ABC123',
        status: 'ended',
      };

      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockSession],
      });

      await joinSession(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_NOT_ACTIVE', 400);
    });
  });

  describe('endSession', () => {
    it('should end session successfully', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { id: sessionId },
      });

      const mockSession = {
        id: sessionId,
        teacher_id: mockTeacher.id,
        school_id: mockTeacher.school_id,
        status: 'active',
      };

      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockSession] })
        .mockResolvedValueOnce({ rows: [] }); // Update result

      await endSession(mockReq as AuthRequest, mockRes as Response);

      expect(databricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE main.classwaves.sessions'),
        expect.objectContaining({
          status: 'ended',
          session_id: sessionId,
        })
      );

      expect(websocketService.endSession).toHaveBeenCalledWith(sessionId);
      expect(websocketService.notifySessionUpdate).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          type: 'session_ended',
        })
      );

      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Session ended successfully',
      });
    });

    it('should not allow ending already ended session', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { id: sessionId },
      });

      const mockSession = {
        id: sessionId,
        teacher_id: mockTeacher.id,
        school_id: mockTeacher.school_id,
        status: 'ended',
      };

      (databricksService.query as jest.Mock).mockResolvedValueOnce({
        rows: [mockSession],
      });

      await endSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_ALREADY_ENDED', 400);
    });
  });

  describe('getSessionAnalytics', () => {
    it('should return session analytics', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { id: sessionId },
      });

      const mockSession = {
        id: sessionId,
        teacher_id: mockTeacher.id,
        school_id: mockTeacher.school_id,
      };

      const mockAnalytics = {
        total_students: 25,
        active_students: 20,
        total_recordings: 150,
        avg_participation_rate: 0.85,
        total_transcriptions: 145,
      };

      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [mockSession] })
        .mockResolvedValueOnce({ rows: [mockAnalytics] });

      await getSessionAnalytics(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          analytics: expect.objectContaining({
            totalStudents: 25,
            activeStudents: 20,
            participationRate: 85,
            recordings: {
              total: 150,
              transcribed: 145,
            },
          }),
        })
      );
    });
  });
});