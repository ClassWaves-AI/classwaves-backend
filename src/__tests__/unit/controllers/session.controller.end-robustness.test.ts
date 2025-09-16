import type { AuthRequest } from '../../../types/auth.types';
import { createAuthenticatedRequest, createMockResponse } from '../../utils/test-helpers';

// Mock namespaced WS service and capture emits
const emitted: Array<{ room: 'session'|'group'; id: string; event: string; payload: any }> = [];
jest.mock('../../../services/websocket/namespaced-websocket.service', () => {
  return {
    getNamespacedWebSocketService: () => ({
      getSessionsService: () => ({
        emitToSession: (sessionId: string, event: string, payload: any) => {
          emitted.push({ room: 'session', id: sessionId, event, payload });
        },
        emitToGroup: (groupId: string, event: string, payload: any) => {
          emitted.push({ room: 'group', id: groupId, event, payload });
        },
        resetTranscriptMergeStateForGroups: jest.fn(),
        stopFlushSchedulersForSession: jest.fn(),
      })
    }),
  };
});

// Provide a minimal prom-client stub so metrics inc works
jest.mock('prom-client', () => {
  const counters = new Map<string, any>();
  const histos = new Map<string, any>();
  class Counter { name: string; help?: string; labelNames?: string[]; inc = jest.fn(); constructor(cfg: any){ this.name = cfg?.name; this.help = cfg?.help; this.labelNames = cfg?.labelNames; counters.set(this.name, this);} }
  class Histogram { name: string; help?: string; labelNames?: string[]; observe = jest.fn(); constructor(cfg: any){ this.name = cfg?.name; this.help = cfg?.help; this.labelNames = cfg?.labelNames; histos.set(this.name, this);} }
  const register = { getSingleMetric: (name: string) => counters.get(name) || histos.get(name) };
  return { Counter, Histogram, register };
});

// Stub services used during endSession best-effort tasks
jest.mock('../../../services/analytics-query-router.service', () => ({
  analyticsQueryRouterService: { logSessionEvent: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock('../../../services/transcript-persistence.service', () => ({
  transcriptPersistenceService: { flushSession: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock('../../../services/summary-synthesis.service', () => ({
  summarySynthesisService: { runSummariesForSession: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock('../../../services/cache-event-bus.service', () => ({
  cacheEventBus: { sessionStatusChanged: jest.fn().mockResolvedValue(undefined) }
}));
jest.mock('../../../services/analytics-computation.service', () => ({
  analyticsComputationService: {
    computeSessionAnalytics: jest.fn().mockResolvedValue({}),
    emitAnalyticsFinalized: jest.fn().mockResolvedValue(undefined),
  }
}));
jest.mock('../../../utils/audit.port.instance', () => ({
  auditLogPort: { enqueue: jest.fn().mockResolvedValue(undefined) }
}));

describe('Session Controller — endSession robustness + coordinated shutdown', () => {
  const teacher = { id: '11111111-1111-1111-1111-111111111111', school_id: '22222222-2222-2222-2222-222222222222' } as any;

  beforeEach(() => {
    emitted.splice(0, emitted.length);
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('returns 200 with fallback zeros when final stats query throws', async () => {
    const sessionId = '33333333-3333-3333-3333-333333333333';
    const mockReq = createAuthenticatedRequest(teacher, { params: { id: sessionId }, body: {} });
    const mockRes = createMockResponse();

    // Reset and prepare all mocks before requiring modules
    jest.resetModules();
    jest.doMock('../../../services/redis.service', () => ({
      redisService: { set: jest.fn().mockResolvedValue(true), get: jest.fn().mockResolvedValue(null), getClient: () => ({ get: jest.fn().mockResolvedValue(null) }) }
    }));
    const { getCompositionRoot } = require('../../../app/composition-root');
    const comp = getCompositionRoot();
    jest.spyOn(comp, 'getSessionRepository').mockReturnValue({
      getOwnedSessionLifecycle: jest.fn().mockResolvedValue({ id: sessionId, status: 'active', teacher_id: teacher.id, school_id: teacher.school_id, actual_start: new Date(Date.now() - 60000), created_at: new Date(Date.now() - 60000), participation_rate: 0.7, engagement_score: 0.8 }),
      updateFields: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    } as any);
    jest.spyOn(comp, 'getGroupRepository').mockReturnValue({ getGroupsBasic: jest.fn().mockResolvedValue([{ id: 'g1' }, { id: 'g2' }]) } as any);
    jest.spyOn(comp, 'getSessionStatsRepository').mockReturnValue({ getEndSessionStats: jest.fn().mockRejectedValue(new Error('Operation was closed by a client')) } as any);

    const { endSession } = require('../../../controllers/session.controller');
    await endSession(mockReq as AuthRequest, mockRes as any);

    // Should have returned 200 with zeros in summary
    expect((mockRes.json as any).mock.calls[0][0]).toEqual(expect.objectContaining({
      success: true,
      data: expect.objectContaining({
        session: expect.objectContaining({ id: sessionId, status: 'ended' }),
        summary: expect.objectContaining({ totalGroups: 0, totalParticipants: 0, totalTranscriptions: 0 })
      })
    }));
  });

  it('emits coordinated shutdown audio:capture:stop to session and groups', async () => {
    const sessionId = '44444444-4444-4444-4444-444444444444';
    const mockReq = createAuthenticatedRequest(teacher, { params: { id: sessionId }, body: {} });
    const mockRes = createMockResponse();

    jest.resetModules();
    jest.doMock('../../../services/redis.service', () => ({
      redisService: { set: jest.fn().mockResolvedValue(true), get: jest.fn().mockResolvedValue(null), getClient: () => ({ get: jest.fn().mockResolvedValue(null) }) }
    }));
    const { getCompositionRoot } = require('../../../app/composition-root');
    const comp = getCompositionRoot();

    jest.spyOn(comp, 'getSessionRepository').mockReturnValue({
      getOwnedSessionLifecycle: jest.fn().mockResolvedValue({
        id: sessionId,
        status: 'active',
        teacher_id: teacher.id,
        school_id: teacher.school_id,
        actual_start: new Date(Date.now() - 60000),
        created_at: new Date(Date.now() - 60000),
      }),
      updateFields: jest.fn().mockResolvedValue(undefined),
      updateStatus: jest.fn().mockResolvedValue(undefined),
    } as any);
    jest.spyOn(comp, 'getGroupRepository').mockReturnValue({
      getGroupsBasic: jest.fn().mockResolvedValue([{ id: 'g-stop-1' }, { id: 'g-stop-2' }]),
    } as any);
    jest.spyOn(comp, 'getSessionStatsRepository').mockReturnValue({
      getEndSessionStats: jest.fn().mockResolvedValue({ total_groups: 2, total_students: 8, total_transcriptions: 20 }),
    } as any);

    const { endSession } = require('../../../controllers/session.controller');
    await endSession(mockReq as AuthRequest, mockRes as any);

    // Session-scoped stop
    const sessionStops = emitted.filter(e => e.room === 'session' && e.event === 'audio:capture:stop' && e.id === sessionId);
    expect(sessionStops.length).toBeGreaterThan(0);
    // Group-scoped stop for both groups
    const groupStops = emitted.filter(e => e.room === 'group' && e.event === 'audio:capture:stop');
    const groupIds = new Set(groupStops.map(e => e.id));
    expect(groupIds.has('g-stop-1')).toBe(true);
    expect(groupIds.has('g-stop-2')).toBe(true);
  });
});
