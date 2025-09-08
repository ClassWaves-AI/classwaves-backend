import request from 'supertest';
// Bypass strict JWT auth for this focused integration
jest.mock('../../../middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'test-teacher-123', email: 'teacher@test.edu', school_id: 'test-school-123', role: 'teacher', status: 'active' }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));
import { createTestApp } from '../../test-utils/app-setup';

// Feature flag enabled
process.env.FEATURE_GROUP_SESSION_SUMMARIES = '1';

// Mock analytics computation to avoid heavy work
jest.mock('../../../services/analytics-computation.service', () => ({
  analyticsComputationService: {
    computeSessionAnalytics: async (_sessionId: string) => ({ sessionAnalyticsOverview: { engagementMetrics: { totalParticipants: 0 } } }),
    emitAnalyticsFinalized: async () => undefined,
  }
}));

// Mock audio drain to no-op
jest.mock('../../../services/audio/InMemoryAudioProcessor', () => ({
  inMemoryAudioProcessor: { flushGroups: async () => undefined, getGroupWindowInfo: () => ({ bytes: 0, chunks: 0, windowSeconds: 10 }) }
}));

// In-memory stores
const groups = ['g1', 'g2'];
const groupSummaries: Record<string, any> = {};
let sessionSummary: any = null;

// Mock composition root to avoid DB
jest.mock('../../../app/composition-root', () => {
  const repo = {
    getOwnedSessionLifecycle: async (id: string, _teacher: string) => ({ id, teacher_id: 'test-teacher-123', school_id: 'test-school-123', status: 'active', created_at: new Date(), actual_start: new Date() }),
    updateFields: async () => undefined,
    updateStatus: async () => undefined,
    getOwnedSessionBasic: async (id: string, _teacher: string) => ({ id, teacher_id: 'test-teacher-123', school_id: 'test-school-123', status: 'active', title: 'T', created_at: new Date() })
  };
  const groupRepo = { getGroupsBasic: async (_sid: string) => groups.map(id => ({ id, name: id })) };
  const sessionStatsRepository = { getEndSessionStats: async (_sid: string) => ({ total_groups: groups.length, total_students: 6, total_transcriptions: 4 }) };
  const summariesRepo = {
    getSessionSummary: async (sid: string) => sessionSummary ? ({ id: 'ss1', session_id: sid, summary_json: JSON.stringify(sessionSummary), analysis_timestamp: new Date(), created_at: new Date() }) : null,
    getGroupSummary: async (sid: string, gid: string) => groupSummaries[gid] ? ({ id: 'gs-'+gid, session_id: sid, group_id: gid, summary_json: JSON.stringify(groupSummaries[gid]), analysis_timestamp: new Date(), created_at: new Date() }) : null,
    listGroupSummaries: async (sid: string) => Object.entries(groupSummaries).map(([gid, s]) => ({ id: 'gs-'+gid, session_id: sid, group_id: gid, summary_json: JSON.stringify(s), analysis_timestamp: new Date(), created_at: new Date() })),
    upsertGroupSummary: async ({ groupId, summaryJson }: any) => { groupSummaries[groupId] = JSON.parse(summaryJson); },
    upsertSessionSummary: async ({ summaryJson }: any) => { sessionSummary = JSON.parse(summaryJson); },
  };
  const aiPort = {
    summarizeGroup: async (_tx: string[], { groupId }: any) => ({ overview: 'Overview ' + groupId, teacher_actions: [], analysisTimestamp: new Date().toISOString() }),
    summarizeSession: async (arr: any[], _opts: any) => ({ themes: ['theme1'], group_breakdown: arr.map((g: any) => ({ groupId: g.groupId, summarySnippet: g.overview })), analysisTimestamp: new Date().toISOString() })
  };
  return {
    getCompositionRoot: () => ({
      getSessionRepository: () => repo,
      getGroupRepository: () => groupRepo,
      getSessionStatsRepository: () => sessionStatsRepository,
      getSummariesRepository: () => summariesRepo,
      getAIAnalysisPort: () => aiPort,
    })
  };
});

// Mock Databricks transcript query used by summary service
jest.mock('../../../services/databricks.service', () => ({
  databricksService: {
    query: async (sql: string, params?: any[]) => {
      if (/sessions\.transcriptions/i.test(sql)) {
        const gid = params?.[1];
        return [
          { content: `A for ${gid}` },
          { content: `B for ${gid}` },
        ] as any;
      }
      return [] as any;
    },
    queryOne: async () => null,
  }
}));

describe('Integration: Session Summaries pipeline', () => {
  let app: any;

  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
  });

  it('endSession triggers summaries and APIs return data', async () => {
    const sessionId = 'summary-session-1';

    // End session
    const endRes = await request(app)
      .post(`/api/v1/sessions/${sessionId}/end`)
      .set('Authorization', 'Bearer test-auth-token')
      .send({ reason: 'planned_completion' })
      .expect(200);
    expect(endRes.body?.success).toBe(true);

    // Immediately fetch summaries (pipeline runs inline in test env)
    const getRes = await request(app)
      .get(`/api/v1/sessions/${sessionId}/summaries`)
      .set('Authorization', 'Bearer test-auth-token')
      .expect(200);
    expect(getRes.body.sessionId).toBe(sessionId);
    expect(getRes.body.sessionSummary).toBeDefined();
    expect(Array.isArray(getRes.body.groups)).toBe(true);
    expect(getRes.body.groups.length).toBeGreaterThan(0);

    const groupId = getRes.body.groups[0].groupId;
    const groupRes = await request(app)
      .get(`/api/v1/sessions/${sessionId}/groups/${groupId}/summary`)
      .set('Authorization', 'Bearer test-auth-token')
      .expect(200);
    expect(groupRes.body.groupId).toBe(groupId);
    expect(groupRes.body.summary).toBeDefined();
  });
});
