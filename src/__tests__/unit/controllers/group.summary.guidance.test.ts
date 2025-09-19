import request from 'supertest';
import { createTestApp } from '../../test-utils/app-setup';

// Bypass strict JWT auth for focused unit shape
jest.mock('../../../middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 't-1', email: 't@test.edu', school_id: 's-1', role: 'teacher', status: 'active' }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

// Mock composition root to control repository outputs
jest.mock('../../../app/composition-root', () => {
  const sessionRepo = {
    getOwnedSessionBasic: async (id: string, _teacher: string) => ({ id, teacher_id: 't-1', school_id: 's-1', status: 'ended', title: 'X', created_at: new Date() })
  };
  const summariesRepo = {
    getGroupSummary: async (sid: string, gid: string) => ({ id: 'gs1', session_id: sid, group_id: gid, summary_json: JSON.stringify({ overview: '...' }), analysis_timestamp: new Date(), created_at: new Date() })
  };
  return {
    __esModule: true,
    getCompositionRoot: () => ({
      getSessionRepository: () => sessionRepo,
      getSummariesRepository: () => summariesRepo,
    })
  };
});

jest.mock('../../../services/guidance-insights.service', () => ({
  guidanceInsightsService: {
    getForGroup: async (_sid: string, _gid: string) => ({
      tier1: [
        { timestamp: new Date('2025-01-01T00:00:00Z').toISOString(), groupId: 'g-1', groupName: 'Group 1', text: 'Focused on evidence' }
      ],
      tier2Group: { comparison: { groupId: 'g-1', relativePerfomance: { argumentation: 0.7 } } }
    })
  }
}));

describe('Unit: GET /sessions/:sid/groups/:gid/summary includes guidanceInsights', () => {
  let app: any;
  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
  });

  it('returns guidanceInsights with tier1 and tier2Group', async () => {
    const res = await request(app)
      .get('/api/v1/sessions/s1/groups/g-1/summary')
      .set('Authorization', 'Bearer test-auth-token')
      .expect(200);
    const summary = res.body?.summary;
    expect(summary).toBeDefined();
    expect(summary.guidanceInsights).toBeDefined();
    expect(Array.isArray(summary.guidanceInsights.tier1)).toBe(true);
    expect(summary.guidanceInsights.tier2Group).toBeDefined();
  });
});

