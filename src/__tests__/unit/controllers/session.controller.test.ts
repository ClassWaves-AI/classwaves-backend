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
import { websocketService } from '../../../services/websocket';
import { redisService } from '../../../services/redis.service';
import { RetryService } from '../../../services/retry.service';
import { queryCacheService } from '../../../services/query-cache.service';
import { 
  createMockRequest, 
  createMockResponse, 
  createAuthenticatedRequest,
  assertErrorResponse,
  assertSuccessResponse
} from '../../utils/test-helpers';
import { AuthRequest } from '../../../types/auth.types';

// Mock all services
jest.mock('../../../utils/audit.port.instance', () => ({
  auditLogPort: { enqueue: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock('../../../services/websocket');
// Mock namespaced WebSocket service to capture emits from controller
const emitToSessionMock = jest.fn();
const emitToGroupMock = jest.fn();
const stopFlushSchedulersMock = jest.fn();
const resetTranscriptMergeStateMock = jest.fn();
jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getSessionsService: () => ({
      emitToSession: emitToSessionMock,
      emitToGroup: emitToGroupMock,
      stopFlushSchedulersForSession: stopFlushSchedulersMock,
      resetTranscriptMergeStateForGroups: resetTranscriptMergeStateMock,
    })
  })
}));
jest.mock('../../../services/redis.service');
jest.mock('../../../utils/analytics-logger');
jest.mock('../../../services/retry.service');
jest.mock('../../../services/query-cache.service');
jest.mock('../../../services/analytics-query-router.service', () => ({
  analyticsQueryRouterService: {
    logSessionEvent: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../utils/idempotency.port.instance', () => ({
  idempotencyPort: {
    withIdempotency: jest.fn(async (_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
  },
}));
jest.mock('../../../utils/cache.port.instance', () => ({
  cachePort: {
    set: jest.fn().mockResolvedValue(undefined),
    get: jest.fn().mockResolvedValue(null),
  },
}));
jest.mock('../../../services/cache-event-bus.service', () => ({
  cacheEventBus: {
    sessionStatusChanged: jest.fn().mockResolvedValue(undefined),
    sessionUpdated: jest.fn().mockResolvedValue(undefined),
    sessionDeleted: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../services/secure-jwt.service', () => ({
  SecureJWTService: {
    generateStudentToken: jest.fn().mockResolvedValue('mock-student-token'),
  },
}));
jest.mock('prom-client', () => {
  const counters: Record<string, any> = {};
  const histograms: Record<string, any> = {};
  const gauges: Record<string, any> = {};
  class Counter {
    name: string;
    inc: jest.Mock;
    constructor(config: { name: string }) {
      this.name = config.name;
      this.inc = jest.fn();
      counters[this.name] = this;
    }
  }
  class Histogram {
    name: string;
    observe: jest.Mock;
    constructor(config: { name: string }) {
      this.name = config.name;
      this.observe = jest.fn();
      histograms[this.name] = this;
    }
  }
  class Gauge {
    name: string;
    set: jest.Mock;
    constructor(config: { name: string }) {
      this.name = config.name;
      this.set = jest.fn();
      gauges[this.name] = this;
    }
  }
  return {
    register: {
      getSingleMetric: jest.fn((name: string) => counters[name] || histograms[name] || gauges[name]),
    },
    Counter,
    Histogram,
    Gauge,
  };
});
jest.mock('../../../services/analytics-computation.service', () => ({
  analyticsComputationService: {
    computeSessionAnalytics: jest.fn().mockResolvedValue({}),
    emitAnalyticsFinalized: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../services/transcript-persistence.service', () => ({
  transcriptPersistenceService: {
    flushSession: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../services/audio/InMemoryAudioProcessor', () => ({
  inMemoryAudioProcessor: {
    flushGroups: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../../../services/summary-synthesis.service', () => ({
  summarySynthesisService: {
    runSummariesForSession: jest.fn().mockResolvedValue(undefined),
  },
}));

const { analyticsQueryRouterService } = require('../../../services/analytics-query-router.service');
const { cacheEventBus } = require('../../../services/cache-event-bus.service');
const { SecureJWTService } = require('../../../services/secure-jwt.service');
const { transcriptPersistenceService } = require('../../../services/transcript-persistence.service');
const { analyticsComputationService } = require('../../../services/analytics-computation.service');
const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');
const { summarySynthesisService } = require('../../../services/summary-synthesis.service');

const mockSessionRepository = {
  insertSession: jest.fn(),
  getOwnedSessionBasic: jest.fn(),
  getOwnedSessionLifecycle: jest.fn(),
  updateOnStart: jest.fn(),
  updateFields: jest.fn(),
  updateStatus: jest.fn(),
  listSessionsForTeacher: jest.fn(),
  getTeacherSessions: jest.fn(),
  getBasic: jest.fn(),
  getByAccessCode: jest.fn(),
  countActiveSessionsForTeacher: jest.fn(),
  countTodaySessionsForTeacher: jest.fn(),
};

const mockGroupRepository = {
  insertGroup: jest.fn(),
  insertGroupMember: jest.fn(),
  countReady: jest.fn(),
  countTotal: jest.fn(),
  getGroupsBasic: jest.fn(),
  getMembersBySession: jest.fn(),
  findLeaderAssignmentByEmail: jest.fn(),
  findLeaderAssignmentByName: jest.fn(),
  countTotalStudentsForTeacher: jest.fn(),
};

const mockParticipantRepository = {
  insertParticipant: jest.fn(),
  listActiveBySession: jest.fn(),
};

const mockAnalyticsRepository = {
  getPlannedVsActual: jest.fn(),
  upsertSessionMetrics: jest.fn(),
};

const mockSessionStatsRepository = {
  getEndSessionStats: jest.fn(),
};

const mockRosterRepository = {
  findStudentByEmail: jest.fn(),
  findStudentByName: jest.fn(),
  getStudentBasicById: jest.fn(),
};

const mockSessionDetailRepository = {
  getOwnedSessionDetail: jest.fn(),
};

const mockDbPort = {
  generateId: jest.fn(() => `mock-id-${Math.random().toString(36).slice(2, 10)}`),
};

const mockComplianceRepository = {
  hasParentalConsentByStudentName: jest.fn(),
};

const mockEmailPort = {
  sendSessionInvitation: jest.fn(),
};

jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: jest.fn(() => ({
    getSessionRepository: () => mockSessionRepository,
    getGroupRepository: () => mockGroupRepository,
    getParticipantRepository: () => mockParticipantRepository,
    getAnalyticsRepository: () => mockAnalyticsRepository,
    getSessionStatsRepository: () => mockSessionStatsRepository,
    getRosterRepository: () => mockRosterRepository,
    getSessionDetailRepository: () => mockSessionDetailRepository,
    getComplianceRepository: () => mockComplianceRepository,
    getEmailPort: () => mockEmailPort,
    getDbPort: () => mockDbPort,
  })),
}));

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
    for (const repo of [
      mockSessionRepository,
      mockGroupRepository,
      mockParticipantRepository,
      mockAnalyticsRepository,
      mockRosterRepository,
      mockSessionDetailRepository,
      mockComplianceRepository,
      mockSessionStatsRepository,
    ]) {
      Object.values(repo).forEach((fn) => {
        if (typeof fn === 'function' && 'mockReset' in fn) {
          (fn as jest.Mock).mockReset();
        }
      });
    }
    mockDbPort.generateId.mockReset().mockImplementation(() => `mock-id-${Math.random().toString(36).slice(2, 10)}`);
    mockSessionDetailRepository.getOwnedSessionDetail.mockResolvedValue(null);
    mockComplianceRepository.hasParentalConsentByStudentName.mockResolvedValue(true);
    mockEmailPort.sendSessionInvitation.mockReset().mockResolvedValue({ sent: [], failed: [] });
    mockSessionStatsRepository.getEndSessionStats.mockResolvedValue({ total_groups: 0, total_students: 0, total_transcriptions: 0 });
    analyticsQueryRouterService.logSessionEvent.mockReset().mockResolvedValue(undefined);
    cacheEventBus.sessionStatusChanged.mockReset().mockResolvedValue(undefined);
    cacheEventBus.sessionUpdated.mockReset().mockResolvedValue(undefined);
    cacheEventBus.sessionDeleted.mockReset().mockResolvedValue(undefined);
    emitToSessionMock.mockReset();
    emitToGroupMock.mockReset();
    stopFlushSchedulersMock.mockReset();
    resetTranscriptMergeStateMock.mockReset();
    (SecureJWTService.generateStudentToken as jest.Mock).mockReset().mockResolvedValue('mock-student-token');
    if (!(redisService as any).get) (redisService as any).get = jest.fn();
    if (!(redisService as any).set) (redisService as any).set = jest.fn();
    (redisService.get as jest.Mock).mockReset().mockResolvedValue(null);
    (redisService.set as jest.Mock).mockReset().mockResolvedValue(undefined);
    (queryCacheService.invalidateCache as jest.Mock).mockReset().mockResolvedValue(undefined);
    (queryCacheService.upsertCachedQuery as jest.Mock)?.mockReset?.();
    (RetryService.retryDatabaseOperation as jest.Mock).mockReset();
    (RetryService.withRetry as jest.Mock).mockReset();
    (RetryService.retryRedisOperation as jest.Mock).mockReset();
    transcriptPersistenceService.flushSession.mockReset().mockResolvedValue(undefined);
    analyticsComputationService.computeSessionAnalytics.mockReset().mockResolvedValue({});
    analyticsComputationService.emitAnalyticsFinalized.mockReset().mockResolvedValue(undefined);
    summarySynthesisService.runSummariesForSession.mockReset().mockResolvedValue(undefined);
    inMemoryAudioProcessor.flushGroups.mockReset().mockResolvedValue(undefined);
    if (!(websocketService as any).emitToSession) (websocketService as any).emitToSession = jest.fn();
    if (!(websocketService as any).endSession) (websocketService as any).endSession = jest.fn();
    if (!(websocketService as any).notifySessionUpdate) (websocketService as any).notifySessionUpdate = jest.fn();
    (websocketService.emitToSession as jest.Mock).mockReset().mockResolvedValue(undefined);
    (websocketService.endSession as jest.Mock).mockReset();
    (websocketService.notifySessionUpdate as jest.Mock).mockReset();
    (websocketService as any).io = undefined;
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
      
      mockDbPort.generateId
        .mockReturnValueOnce(mockSessionId)
        .mockReturnValueOnce(mockGroupIds[0])
        .mockReturnValueOnce(mockGroupIds[1])
        .mockReturnValueOnce(mockGroupIds[2])
        .mockReturnValue('member-id');

      mockSessionRepository.insertSession.mockResolvedValue(undefined);
      mockGroupRepository.insertGroup.mockResolvedValue(undefined);
      mockGroupRepository.insertGroupMember.mockResolvedValue(undefined);

      await createSession(mockReq as AuthRequest, mockRes as Response);
      expect(mockSessionRepository.insertSession).toHaveBeenCalledWith(
        expect.objectContaining({ id: mockSessionId, title: sessionData.topic })
      );
      expect(mockGroupRepository.insertGroup).toHaveBeenCalledTimes(3);
      expect(mockGroupRepository.insertGroupMember).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
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
      
      mockDbPort.generateId
        .mockReturnValueOnce(mockSessionId)
        .mockReturnValueOnce(mockGroupIds[0])
        .mockReturnValueOnce(mockGroupIds[1])
        .mockReturnValue('member-id');

      mockSessionRepository.insertSession.mockResolvedValue(undefined);
      mockGroupRepository.insertGroup.mockResolvedValue(undefined);
      mockGroupRepository.insertGroupMember.mockResolvedValue(undefined);

      await createSession(mockReq as AuthRequest, mockRes as Response);

      // Verify student_group_members inserts for Dev Team (3 members: leader + 2 members)
      const memberCalls = mockGroupRepository.insertGroupMember.mock.calls.map(([payload]) => payload);
      expect(memberCalls.map((m) => m.student_id)).toEqual(
        expect.arrayContaining(['leader-1', 'dev-1', 'leader-2', 'qa-3'])
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

      mockSessionRepository.insertSession.mockResolvedValue(undefined);
      mockGroupRepository.insertGroup.mockResolvedValue(undefined);
      mockGroupRepository.insertGroupMember.mockRejectedValueOnce(new Error('Student not found'));

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

      mockSessionRepository.insertSession.mockResolvedValue(undefined);
      mockGroupRepository.insertGroup.mockResolvedValue(undefined);
      mockGroupRepository.insertGroupMember.mockResolvedValue(undefined);
      mockAnalyticsRepository.upsertSessionMetrics.mockResolvedValue(undefined);
      (analyticsQueryRouterService.logSessionEvent as jest.Mock).mockResolvedValue(undefined);

      await createSession(mockReq as AuthRequest, mockRes as Response);

      expect(mockAnalyticsRepository.upsertSessionMetrics).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          planned_groups: 2,
          average_group_size: 2,
        })
      );
      expect(analyticsQueryRouterService.logSessionEvent).toHaveBeenCalledWith(
        expect.any(String),
        mockTeacher.id,
        'configured',
        expect.objectContaining({ groupPlan: sessionData.groupPlan })
      );
    });
  });

  describe('getSession', () => {
    it('should get session details successfully', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { sessionId },
      });

      mockSessionDetailRepository.getOwnedSessionDetail.mockResolvedValueOnce({
        id: sessionId,
        teacher_id: mockTeacher.id,
        school_id: mockTeacher.school_id,
        title: 'Math Class',
        subject: 'Mathematics',
        status: 'active',
        groupsDetailed: [],
      });
      mockGroupRepository.getGroupsBasic.mockResolvedValueOnce([]);
      mockGroupRepository.getMembersBySession.mockResolvedValueOnce([]);

      await getSession(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            session: expect.objectContaining({
              id: sessionId,
              topic: 'Math Class',
              status: 'active',
            })
          })
        })
      );
    });

    it('should return 404 for non-existent session', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { id: 'non-existent' },
      });

      mockSessionDetailRepository.getOwnedSessionDetail.mockResolvedValueOnce(null);

      await getSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_NOT_FOUND', 404);
    });

    it('should prevent unauthorized access to sessions', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { sessionId },
      });

      mockSessionDetailRepository.getOwnedSessionDetail.mockResolvedValueOnce(null);

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

      mockSessionRepository.getByAccessCode.mockResolvedValueOnce(mockSession);
      mockGroupRepository.findLeaderAssignmentByEmail.mockResolvedValueOnce([]);
      mockGroupRepository.findLeaderAssignmentByName.mockResolvedValueOnce([]);
      mockParticipantRepository.insertParticipant.mockResolvedValueOnce(undefined);
      (SecureJWTService.generateStudentToken as jest.Mock).mockResolvedValueOnce('mock-student-token');

      // Mock Redis age check
      (redisService.get as jest.Mock).mockResolvedValueOnce(null);

      await joinSession(mockReq as Request, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          token: 'mock-student-token',
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
      mockSessionRepository.getByAccessCode.mockResolvedValueOnce({ id: 'session-123', access_code: 'ABC123', status: 'active' });

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

      mockSessionRepository.getByAccessCode.mockResolvedValueOnce(mockSession);
      mockComplianceRepository.hasParentalConsentByStudentName.mockResolvedValueOnce(false);

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

      mockSessionRepository.getByAccessCode.mockResolvedValueOnce(mockSession);

      await joinSession(mockReq as Request, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_NOT_ACTIVE', 400);
    });
  });

  describe('Session Gating', () => {
    it('should return 409 when groups are not ready (SG-BE-01, SG-BE-03)', async () => {
      const sessionId = 'session-123';
      mockReq = createAuthenticatedRequest(mockTeacher, { params: { sessionId } });

      const mockSession = {
        id: sessionId,
        teacher_id: mockTeacher.id,
        status: 'created',
        title: 'Test Session'
      };

      // Mock RetryService.retryDatabaseOperation calls in sequence
      (RetryService.retryDatabaseOperation as jest.Mock)
        .mockResolvedValueOnce(mockSession)  // Session lookup
        .mockResolvedValueOnce({ ready_groups_count: 1 })  // Ready groups count (1 ready)
        .mockResolvedValueOnce({ total_groups_count: 3 })  // Total groups count (3 total)
        .mockResolvedValueOnce([  // Not ready groups details
          { id: 'group-1', name: 'Group A' },
          { id: 'group-2', name: 'Group B' }
        ]);

      await startSession(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.status).toHaveBeenCalledWith(409);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'GROUPS_NOT_READY',
          message: 'Cannot start session: 2 of 3 groups are not ready',
          readyCount: 1,
          totalCount: 3,
          notReadyGroups: [
            { id: 'group-1', name: 'Group A' },
            { id: 'group-2', name: 'Group B' }
          ]
        }
      });

      // Should not update session status when gated
      expect(mockSessionRepository.updateOnStart).not.toHaveBeenCalled();
    });

    it('should start session when all groups are ready (SG-BE-01)', async () => {
      const sessionId = 'session-all-ready';
      mockReq = createAuthenticatedRequest(mockTeacher, { params: { sessionId } });

      const mockSession = {
        id: sessionId,
        teacher_id: mockTeacher.id,
        status: 'created',
        title: 'All Ready Session',
        school_id: 'school-123'
      };

      const mockFullSession = {
        ...mockSession,
        status: 'active',
        groups: []
      };

      // Mock ALL RetryService calls in sequence
      (RetryService.retryDatabaseOperation as jest.Mock)
        .mockResolvedValueOnce(mockSession)  // 1. Session lookup
        .mockResolvedValueOnce({ ready_groups_count: 2 })  // 2. Ready groups count 
        .mockResolvedValueOnce({ total_groups_count: 2 })  // 3. Total groups count - all ready!
        .mockResolvedValueOnce(true)  // 4. Update session to active
        .mockResolvedValueOnce(mockFullSession);  // 5. Get session with groups

      // Mock other retry methods
      (RetryService.retryRedisOperation as jest.Mock).mockResolvedValue(true);
      (RetryService.withRetry as jest.Mock).mockResolvedValue(true);

      // Mock WebSocket service
      const mockEmit = jest.fn();
      const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
      (websocketService.io as any) = { to: mockTo };
      (websocketService.emitToSession as jest.Mock) = jest.fn().mockResolvedValue(true);

      (mockSessionRepository.updateOnStart as jest.Mock).mockResolvedValue(true);

      await startSession(mockReq as AuthRequest, mockRes as Response);

      // Verify it returns the success response (default 200 status)
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: {
          session: mockFullSession,
          websocketUrl: `wss://ws.classwaves.com/session/${sessionId}`,
          realtimeToken: 'rt_token_' + sessionId
        }
      });
    });
  });

  describe('Session Lifecycle', () => {
    it('should start session when all groups are ready', async () => {
      const sessionId = 'session-lifecycle-test';
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

      // Ensure callbacks passed to RetryService are executed
      (RetryService.retryDatabaseOperation as jest.Mock).mockImplementation(async (op: any) => await op());
      (RetryService.withRetry as jest.Mock).mockImplementation(async (op: any) => await op());
      (RetryService.retryRedisOperation as jest.Mock).mockImplementation(async (op: any) => await op());

      mockSessionRepository.getOwnedSessionBasic.mockResolvedValue(mockSession);
      mockGroupRepository.countReady.mockResolvedValue(2);
      mockGroupRepository.countTotal.mockResolvedValue(2);
      mockGroupRepository.getGroupsBasic.mockResolvedValue([]);
      mockSessionRepository.updateOnStart.mockResolvedValue(undefined);
      mockSessionRepository.getBasic.mockResolvedValue({ ...mockSession, status: 'active' });
      mockSessionDetailRepository.getOwnedSessionDetail.mockResolvedValueOnce({ ...mockSession, status: 'active', groupsDetailed: [], groups: [] });
      (queryCacheService.invalidateCache as jest.Mock).mockResolvedValue(undefined);

      (websocketService.io as any) = { to: jest.fn().mockReturnValue({ emit: jest.fn() }) };
      (websocketService.emitToSession as jest.Mock).mockResolvedValue(undefined);

      await startSession(mockReq as AuthRequest, mockRes as Response);

      expect(mockSessionRepository.updateOnStart).toHaveBeenCalledWith(
        sessionId,
        expect.any(Date)
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

      mockSessionRepository.getOwnedSessionBasic.mockResolvedValueOnce(mockSession);
      mockSessionRepository.updateFields.mockResolvedValueOnce(undefined);
      mockSessionRepository.getBasic.mockResolvedValueOnce({ ...mockSession, status: 'paused' });
      mockSessionDetailRepository.getOwnedSessionDetail.mockResolvedValueOnce(null);

      await updateSession(mockReq as AuthRequest, mockRes as Response);

      expect(mockSessionRepository.updateFields).toHaveBeenCalledWith(
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

      mockSessionRepository.getOwnedSessionLifecycle.mockResolvedValueOnce(mockSession);
      mockSessionRepository.updateFields.mockResolvedValueOnce(undefined);
      mockSessionRepository.updateStatus.mockResolvedValueOnce(undefined);
      mockGroupRepository.getGroupsBasic.mockResolvedValueOnce([]);

      await endSession(mockReq as AuthRequest, mockRes as Response);

      expect(mockSessionRepository.updateFields).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          status: 'ended',
          actual_end: expect.any(Date),
          actual_duration_minutes: expect.any(Number)
        })
      );
      expect(mockSessionRepository.updateStatus).toHaveBeenCalledWith(sessionId, 'ended');
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

      mockSessionRepository.getOwnedSessionLifecycle.mockResolvedValueOnce(mockSession);
      mockSessionRepository.updateFields.mockResolvedValueOnce(undefined);
      mockSessionRepository.updateStatus.mockResolvedValueOnce(undefined);
      mockGroupRepository.getGroupsBasic.mockResolvedValueOnce([]);
      (websocketService.endSession as jest.Mock).mockImplementation(() => {});
      (websocketService.notifySessionUpdate as jest.Mock).mockImplementation(() => {});

      // Populate traceId to verify WS payload includes it
      (mockRes as any).locals = { traceId: 'trace-end-123' };
      await endSession(mockReq as AuthRequest, mockRes as Response);

      expect(mockSessionRepository.updateFields).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({ status: 'ended' })
      );
      expect(mockSessionRepository.updateStatus).toHaveBeenCalledWith(sessionId, 'ended');
      // Namespaced sessions emitter should be called with status change to 'ended'
      expect(emitToSessionMock).toHaveBeenCalledWith(sessionId, 'session:status_changed', expect.objectContaining({ sessionId, status: 'ended', traceId: 'trace-end-123' }));

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

      mockSessionRepository.getOwnedSessionLifecycle.mockResolvedValueOnce(mockSession);

      await endSession(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'SESSION_ALREADY_ENDED', 400);
    });
  });

  describe('traceId propagation', () => {
    it('includes traceId in session:status_changed for pauseSession', async () => {
      const sessionId = 'session-trace-2';
      mockReq = createAuthenticatedRequest(mockTeacher, { params: { sessionId } });
      (mockRes as any) = createMockResponse();
      (mockRes as any).locals = { traceId: 'trace-pause-xyz' };

      mockSessionRepository.getOwnedSessionBasic.mockResolvedValueOnce({
        id: sessionId,
        teacher_id: mockTeacher.id,
        school_id: mockTeacher.school_id,
        status: 'active',
      });
      mockSessionRepository.updateStatus.mockResolvedValueOnce(undefined);

      const { pauseSession } = await import('../../../controllers/session.controller');
      await pauseSession(mockReq as AuthRequest, mockRes as Response);

      expect(emitToSessionMock).toHaveBeenCalledWith(sessionId, 'session:status_changed', expect.objectContaining({ status: 'paused', traceId: 'trace-pause-xyz' }));
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
        planned_members: 25,
        ready_groups_at_start: 20,
        adherence_members_ratio: 0.85,
      };

      mockSessionRepository.getOwnedSessionBasic.mockResolvedValueOnce(mockSession);
      mockAnalyticsRepository.getPlannedVsActual.mockResolvedValueOnce(mockAnalytics);

      await getSessionAnalytics(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId,
          analytics: expect.objectContaining({
            totalStudents: 25,
            activeStudents: 20,
            participationRate: 85,
            recordings: expect.objectContaining({ total: 0, transcribed: 0 }),
          }),
        })
      );
    });
  });
});
