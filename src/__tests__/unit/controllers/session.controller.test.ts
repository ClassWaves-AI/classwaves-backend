import { Request, Response } from 'express';
import { 
  createSession, 
  getSession, 
  updateSession, 
  endSession,
  startSession,
  listSessions,
  joinSession,
  getSessionAnalytics
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

  describe('Declarative Session Creation', () => {
    it('should create session with pre-configured groups', async () => {
      const sessionData = {
        topic: 'Math - Fractions Unit',
        goal: 'Students will understand fraction operations',
        subject: 'Mathematics',
        plannedDuration: 45,
        groupPlan: {
          numberOfGroups: 3,
          groupSize: 4,
          groups: [
            { name: 'Group A', leaderId: 'student-1', memberIds: ['student-2', 'student-3'] },
            { name: 'Group B', leaderId: 'student-4', memberIds: ['student-5', 'student-6'] },
            { name: 'Group C', leaderId: 'student-7', memberIds: ['student-8', 'student-9'] }
          ]
        },
        aiConfig: { hidden: true, defaultsApplied: true }
      };

      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: sessionData,
      });

      const mockSessionId = 'session-456';
      const mockGroupIds = ['group-1', 'group-2', 'group-3'];
      
      // Mock database operations
      (databricksService.generateId as jest.Mock)
        .mockReturnValueOnce(mockSessionId)
        .mockReturnValueOnce(mockGroupIds[0])
        .mockReturnValueOnce(mockGroupIds[1])
        .mockReturnValueOnce(mockGroupIds[2]);
      
      (databricksService.insert as jest.Mock).mockResolvedValue(true);

      await createSession(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            session: expect.objectContaining({
              id: mockSessionId,
              topic: sessionData.topic,
              groupsDetailed: expect.arrayContaining([
                expect.objectContaining({ name: 'Group A', leaderId: 'student-1' })
              ])
            })
          })
        })
      );
    });

    it('should track group membership with student_group_members table', async () => {
      const sessionData = {
        topic: 'Membership Tracking Test',
        goal: 'Test group membership functionality',
        subject: 'Computer Science',
        plannedDuration: 45,
        groupPlan: {
          numberOfGroups: 2,
          groupSize: 3,
          groups: [
            { name: 'Dev Team', leaderId: 'leader-1', memberIds: ['dev-1', 'dev-2'] },
            { name: 'QA Team', leaderId: 'leader-2', memberIds: ['qa-1', 'qa-2', 'qa-3'] }
          ]
        },
        aiConfig: { hidden: true, defaultsApplied: true }
      };

      mockReq = createAuthenticatedRequest(mockTeacher, { body: sessionData });

      const mockSessionId = 'session-membership-test';
      const mockGroupIds = ['group-dev', 'group-qa'];
      
      (databricksService.generateId as jest.Mock)
        .mockReturnValueOnce(mockSessionId)
        .mockReturnValueOnce(mockGroupIds[0])
        .mockReturnValueOnce(mockGroupIds[1]);
      
      (databricksService.insert as jest.Mock).mockResolvedValue(true);

      await createSession(mockReq as AuthRequest, mockRes as Response);

      // Verify student_group_members inserts for Dev Team (3 members: leader + 2 members)
      expect(databricksService.insert).toHaveBeenCalledWith(
        'student_group_members',
        expect.objectContaining({
          session_id: mockSessionId,
          group_id: mockGroupIds[0],
          student_id: 'leader-1'
        })
      );
      
      expect(databricksService.insert).toHaveBeenCalledWith(
        'student_group_members',
        expect.objectContaining({
          session_id: mockSessionId,
          group_id: mockGroupIds[0],
          student_id: 'dev-1'
        })
      );

      // Verify student_group_members inserts for QA Team (4 members: leader + 3 members)
      expect(databricksService.insert).toHaveBeenCalledWith(
        'student_group_members',
        expect.objectContaining({
          session_id: mockSessionId,
          group_id: mockGroupIds[1],
          student_id: 'leader-2'
        })
      );
      
      expect(databricksService.insert).toHaveBeenCalledWith(
        'student_group_members',
        expect.objectContaining({
          session_id: mockSessionId,
          group_id: mockGroupIds[1],
          student_id: 'qa-3'
        })
      );

      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should validate group plan schema', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: {
          topic: 'Math Class',
          goal: 'Learn fractions',
          subject: 'Math',
          plannedDuration: 45,
          // Missing groupPlan
        },
      });

      await createSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'VALIDATION_ERROR', 400);
    });

    it('should handle group member assignment errors', async () => {
      const sessionData = {
        topic: 'Math Class',
        goal: 'Learn fractions',
        subject: 'Math',
        plannedDuration: 45,
        groupPlan: {
          numberOfGroups: 1,
          groupSize: 3,
          groups: [
            { name: 'Group A', leaderId: 'student-1', memberIds: ['student-2', 'student-3'] }
          ]
        }
      };

      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: sessionData,
      });

      (databricksService.insert as jest.Mock)
        .mockResolvedValueOnce(true) // session creation
        .mockRejectedValueOnce(new Error('Student not found')); // group creation fails

      await createSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_CREATE_FAILED', 500);
    });

    it('should record analytics on session configuration', async () => {
      const sessionData = {
        topic: 'Analytics Test',
        goal: 'Test analytics recording',
        subject: 'Science',
        plannedDuration: 30,
        groupPlan: {
          numberOfGroups: 2,
          groupSize: 3,
          groups: [
            { name: 'Group A', leaderId: 'student-1', memberIds: ['student-2'] },
            { name: 'Group B', leaderId: 'student-3', memberIds: ['student-4'] }
          ]
        }
      };

      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: sessionData,
      });

      (databricksService.insert as jest.Mock).mockResolvedValue(true);

      await createSession(mockReq as AuthRequest, mockRes as Response);

      // Should insert analytics records
      expect(databricksService.insert).toHaveBeenCalledWith(
        'session_analytics',
        expect.objectContaining({
          planned_groups: 2,
          planned_group_size: 3,
          planned_members: 4,
          planned_leaders: 2
        })
      );
      
      expect(databricksService.insert).toHaveBeenCalledWith(
        'session_events',
        expect.objectContaining({
          event_type: 'configured',
          payload: expect.stringContaining('numberOfGroups')
        })
      );
    });
  });

  describe('getSession', () => {
    it('should get session details successfully', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { sessionId },
      });

      const mockSession = {
        id: sessionId,
        teacher_id: mockTeacher.id,
        school_id: mockTeacher.school_id,
        title: 'Math Class',
        subject: 'Mathematics',
        grade_level: 5,
        status: 'active',
        created_at: new Date(),
        student_count: 15,
      };

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockSession);

      await getSession(mockReq as AuthRequest, mockRes as Response);

      expect(databricksService.queryOne).toHaveBeenCalled();

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            session: expect.objectContaining({
              id: sessionId,
              topic: mockSession.title,
              status: mockSession.status,
            })
          })
        })
      );
    });

    it('should return 404 for non-existent session', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { id: 'non-existent' },
      });

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(null);

      await getSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_NOT_FOUND', 404);
    });

    it('should prevent unauthorized access to sessions', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { sessionId },
      });

      const mockSession = {
        id: sessionId,
        teacher_id: 'different-teacher',
        school_id: 'different-school',
        session_name: 'Math Class',
      };

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(null);

      await getSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_NOT_FOUND', 404);
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
      (databricksService.queryOne as jest.Mock)
        .mockResolvedValueOnce(mockSession);
      (databricksService.insert as jest.Mock).mockResolvedValueOnce(undefined);

      // Mock Redis age check
      (redisService.get as jest.Mock).mockResolvedValueOnce(null);

      await joinSession(mockReq as Request, mockRes as Response);

      // Age storage is optional; no assertion

      // No websocket assertion for join in new contract

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          token: expect.any(String),
          student: expect.objectContaining({
            id: expect.any(String),
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

      // Ensure session exists so we hit COPPA branch
      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce({ id: 'session-123', access_code: 'ABC123', status: 'active' });

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

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockSession);
      (databricksService.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

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

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockSession);

      await joinSession(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_NOT_ACTIVE', 400);
    });
  });

  describe('Session Lifecycle', () => {
    it('should start session without requiring student presence', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { sessionId },
      });

      const mockSession = {
        id: sessionId,
        teacher_id: mockTeacher.id,
        status: 'created',
        title: 'Test Session',
        planned_duration_minutes: 45
      };

      const mockGroups = [
        { id: 'group-1', is_ready: false, leader_id: 'student-1' },
        { id: 'group-2', is_ready: true, leader_id: 'student-2' }
      ];

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockSession);
      (databricksService.query as jest.Mock).mockResolvedValueOnce(mockGroups);
      (databricksService.update as jest.Mock).mockResolvedValue(true);
      (databricksService.insert as jest.Mock).mockResolvedValue(true);

      await startSession(mockReq as AuthRequest, mockRes as Response);

      expect(databricksService.update).toHaveBeenCalledWith(
        'classroom_sessions',
        sessionId,
        expect.objectContaining({
          status: 'active',
          actual_start: expect.any(Date)
        })
      );

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            session: expect.objectContaining({
              id: sessionId,
              status: 'active'
            })
          })
        })
      );
    });

    it('should update session status correctly', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { sessionId },
        body: { status: 'paused' }
      });

      const mockSession = {
        id: sessionId,
        teacher_id: mockTeacher.id,
        status: 'active'
      };

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockSession);
      (databricksService.update as jest.Mock).mockResolvedValue(true);

      await updateSession(mockReq as AuthRequest, mockRes as Response);

      expect(databricksService.update).toHaveBeenCalledWith(
        'classroom_sessions',
        sessionId,
        expect.objectContaining({ status: 'paused' })
      );
    });

    it('should handle session end with duration tracking', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { sessionId },
      });

      const mockSession = {
        id: sessionId,
        teacher_id: mockTeacher.id,
        status: 'active',
        actual_start: new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
      };

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockSession);
      (databricksService.update as jest.Mock).mockResolvedValue(true);

      await endSession(mockReq as AuthRequest, mockRes as Response);

      expect(databricksService.update).toHaveBeenCalledWith(
        'classroom_sessions',
        sessionId,
        expect.objectContaining({
          status: 'ended',
          actual_end: expect.any(Date),
          actual_duration_minutes: expect.any(Number)
        })
      );
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

      (databricksService.queryOne as jest.Mock)
        .mockResolvedValueOnce(mockSession)
        .mockResolvedValueOnce({ total_groups: 0, total_students: 0, total_transcriptions: 0 });
      (databricksService.updateSessionStatus as jest.Mock).mockResolvedValueOnce(true);
      (websocketService.endSession as jest.Mock).mockImplementation(() => {});
      (websocketService.notifySessionUpdate as jest.Mock).mockImplementation(() => {});

      await endSession(mockReq as AuthRequest, mockRes as Response);

      expect(databricksService.updateSessionStatus).toHaveBeenCalledWith(sessionId, 'ended');
      expect(websocketService.endSession).toHaveBeenCalledWith(sessionId);
      expect(websocketService.notifySessionUpdate).toHaveBeenCalledWith(sessionId, expect.objectContaining({ type: 'session_ended' }));

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            session: expect.objectContaining({ id: sessionId, status: 'ended' }),
          }),
        })
      );
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

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockSession);

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

      (databricksService.queryOne as jest.Mock)
        .mockResolvedValueOnce(mockSession)
        .mockResolvedValueOnce(mockAnalytics);

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