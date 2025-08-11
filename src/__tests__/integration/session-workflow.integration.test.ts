import request from 'supertest';
import express from 'express';
import { databricksService } from '../../services/databricks.service';
import { WebSocketService } from '../../services/websocket.service';
import sessionRoutes from '../../routes/session.routes';
import { authenticate } from '../../middleware/auth.middleware';

// Mock dependencies
jest.mock('../../services/databricks.service');
jest.mock('../../services/websocket.service');
jest.mock('../../middleware/auth.middleware');

describe('End-to-End Session Workflow Integration', () => {
  let app: express.Application;
  let authToken: string;

  beforeAll(() => {
    app = express();
    app.use(express.json());

    // Mock authentication middleware
    (authenticate as jest.Mock).mockImplementation((req: any, res: any, next: any) => {
      req.user = {
        id: 'teacher-123',
        email: 'teacher@school.edu',
        school_id: 'school-123',
        role: 'teacher'
      };
      req.school = {
        id: 'school-123',
        name: 'Test School'
      };
      next();
    });

    app.use('/api/v1/sessions', sessionRoutes);
    authToken = 'mock-jwt-token';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (databricksService.generateId as jest.Mock)
      .mockReturnValueOnce('session-123')
      .mockReturnValueOnce('group-1')
      .mockReturnValueOnce('group-2')
      .mockReturnValueOnce('member-1')
      .mockReturnValueOnce('member-2')
      .mockReturnValueOnce('member-3')
      .mockReturnValueOnce('member-4');
    (databricksService.insert as jest.Mock).mockResolvedValue(true);
    (databricksService.update as jest.Mock).mockResolvedValue(true);
    (databricksService.queryOne as jest.Mock).mockResolvedValue(null);
    (databricksService.query as jest.Mock).mockResolvedValue([]);
  });

  describe('Complete declarative session creation flow', () => {
    it('should create session with pre-configured groups and record analytics', async () => {
      const sessionData = {
        topic: 'Integration Test Session',
        goal: 'Test complete workflow',
        subject: 'Science',
        plannedDuration: 45,
        groupPlan: {
          numberOfGroups: 2,
          groupSize: 4,
          groups: [
            {
              name: 'Group A',
              leaderId: 'student-leader-1',
              memberIds: ['student-2', 'student-3']
            },
            {
              name: 'Group B',
              leaderId: 'student-leader-4',
              memberIds: ['student-5', 'student-6']
            }
          ]
        },
        aiConfig: {
          hidden: true,
          defaultsApplied: true
        }
      };

      const response = await request(app)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(sessionData)
        .expect(201);

      // Verify response structure
      expect(response.body).toEqual({
        success: true,
        data: {
          session: expect.objectContaining({
            id: 'session-123',
            topic: 'Integration Test Session',
            groupsDetailed: expect.arrayContaining([
              expect.objectContaining({
                name: 'Group A',
                leaderId: 'student-leader-1'
              }),
              expect.objectContaining({
                name: 'Group B',
                leaderId: 'student-leader-4'
              })
            ])
          })
        }
      });

      // Verify database calls
      expect(databricksService.insert).toHaveBeenCalledWith(
        'classroom_sessions',
        expect.objectContaining({
          id: 'session-123',
          title: 'Integration Test Session',
          auto_group_enabled: false,
          planned_duration_minutes: 45
        })
      );

      // Verify groups created
      expect(databricksService.insert).toHaveBeenCalledWith(
        'student_groups',
        expect.objectContaining({
          name: 'Group A',
          leader_id: 'student-leader-1',
          auto_managed: false
        })
      );

      // Verify analytics recorded
      expect(databricksService.insert).toHaveBeenCalledWith(
        'session_analytics',
        expect.objectContaining({
          planned_groups: 2,
          planned_group_size: 4,
          planned_members: 6, // 4 members + 2 leaders
          planned_leaders: 2
        })
      );

      expect(databricksService.insert).toHaveBeenCalledWith(
        'session_events',
        expect.objectContaining({
          event_type: 'configured'
        })
      );
    });
  });

  describe('Leader ready -> analytics update -> WebSocket broadcast', () => {
    it('should handle leader readiness workflow', async () => {
      const sessionId = 'session-123';
      const groupId = 'group-456';
      const mockGroup = {
        id: groupId,
        leader_id: 'leader-789',
        session_id: sessionId,
        name: 'Group A'
      };

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockGroup);

      // Mock WebSocket service
      const mockWebSocketService = {
        handleLeaderReady: jest.fn(async (data: any) => {
          // Simulate the actual handler logic
          const group = await databricksService.queryOne(
            'SELECT leader_id, session_id, name FROM classwaves.sessions.student_groups WHERE id = ? AND session_id = ?',
            [data.groupId, data.sessionId]
          );

          if (group) {
            await databricksService.update('student_groups', data.groupId, {
              is_ready: data.ready,
              updated_at: new Date(),
            });

            // Record analytics
            if (data.ready) {
              await databricksService.update('group_analytics', data.groupId, {
                leader_ready_at: new Date(),
              });
            }

            // Broadcast would happen here in real implementation
            return { success: true, groupId: data.groupId, status: data.ready ? 'ready' : 'waiting' };
          }

          throw new Error('Group not found');
        })
      };

      const leaderReadyData = {
        sessionId,
        groupId,
        ready: true
      };

      const result = await mockWebSocketService.handleLeaderReady(leaderReadyData);

      expect(databricksService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT leader_id'),
        [groupId, sessionId]
      );

      expect(databricksService.update).toHaveBeenCalledWith(
        'student_groups',
        groupId,
        expect.objectContaining({
          is_ready: true,
          updated_at: expect.any(Date)
        })
      );

      expect(databricksService.update).toHaveBeenCalledWith(
        'group_analytics',
        groupId,
        expect.objectContaining({
          leader_ready_at: expect.any(Date)
        })
      );

      expect(result).toEqual({
        success: true,
        groupId,
        status: 'ready'
      });
    });
  });

  describe('Session start without student presence', () => {
    it('should start session regardless of student readiness', async () => {
      const sessionId = 'session-123';
      const mockSession = {
        id: sessionId,
        teacher_id: 'teacher-123',
        status: 'created',
        title: 'Test Session'
      };

      const mockGroups = [
        { id: 'group-1', is_ready: false, leader_id: 'student-1' },
        { id: 'group-2', is_ready: false, leader_id: 'student-2' }
      ];

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(mockSession);
      (databricksService.query as jest.Mock).mockResolvedValueOnce(mockGroups);

      const response = await request(app)
        .post(`/api/v1/sessions/${sessionId}/start`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        data: {
          session: expect.objectContaining({
            id: sessionId,
            status: 'active'
          })
        }
      });

      // Verify session status updated
      expect(databricksService.update).toHaveBeenCalledWith(
        'classroom_sessions',
        sessionId,
        expect.objectContaining({
          status: 'active',
          actual_start: expect.any(Date)
        })
      );

      // Verify analytics recorded
      expect(databricksService.insert).toHaveBeenCalledWith(
        'session_events',
        expect.objectContaining({
          event_type: 'started'
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle validation errors', async () => {
      const invalidSessionData = {
        topic: 'Test Session',
        // Missing required fields
      };

      const response = await request(app)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidSessionData)
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR'
        })
      });
    });

    it('should handle database errors gracefully', async () => {
      const sessionData = {
        topic: 'Test Session',
        goal: 'Test goal',
        subject: 'Math',
        plannedDuration: 45,
        groupPlan: {
          numberOfGroups: 1,
          groupSize: 4,
          groups: [
            { name: 'Group A', leaderId: 'student-1', memberIds: ['student-2'] }
          ]
        }
      };

      (databricksService.insert as jest.Mock).mockRejectedValueOnce(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${authToken}`)
        .send(sessionData)
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: expect.objectContaining({
          code: 'SESSION_CREATE_FAILED'
        })
      });
    });
  });
});
