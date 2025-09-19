import request from 'supertest';
import { createTestApp } from '../../test-utils/app-setup';

// Bypass strict JWT auth for this unit-level shape test
jest.mock('../../../middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 't-1', email: 't@test.edu', school_id: 's-1', role: 'teacher', status: 'active' }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

// Mock composition root repositories for deterministic outputs
jest.mock('../../../app/composition-root', () => {
  const sessionRepo = {
    getOwnedSessionBasic: async (id: string, _teacher: string) => ({ id, teacher_id: 't-1', school_id: 's-1', status: 'ended', title: 'X', created_at: new Date() })
  };
  const summariesRepo = {
    getSessionSummary: async (sid: string) => ({ id: 'ss1', session_id: sid, summary_json: JSON.stringify({ themes: ['a'] }), analysis_timestamp: new Date(), created_at: new Date() }),
    listGroupSummaries: async (sid: string) => ([{ id: 'gs1', session_id: sid, group_id: 'g-1', summary_json: JSON.stringify({ overview: '...' }), analysis_timestamp: new Date(), created_at: new Date() }])
  };
  return {
    __esModule: true,
    getCompositionRoot: () => ({
      getSessionRepository: () => sessionRepo,
      getSummariesRepository: () => summariesRepo,
      // Not used directly in controller; guidance insights are loaded through service
    })
  };
});

// Mock service to return stable guidance insights
jest.mock('../../../services/guidance-insights.service', () => ({
  guidanceInsightsService: {
    getForSession: async (_sid: string) => ({
      tier1: [
        { timestamp: new Date('2025-01-01T00:00:00Z').toISOString(), groupId: 'g-1', groupName: 'Group 1', text: 'Rebuttal prompted stronger warrant' }
      ],
      tier2: { timestamp: new Date('2025-01-01T00:05:00Z').toISOString(), overall_effectiveness: 0.74 }
    })
  }
}));

describe('Unit: GET /sessions/:id/summaries includes guidanceInsights', () => {
  let app: any;
  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
  });

  it('returns guidanceInsights nested under sessionSummary', async () => {
    const res = await request(app)
      .get('/api/v1/sessions/s-guidance-1/summaries')
      .set('Authorization', 'Bearer test-auth-token')
      .expect(200);

    expect(res.body).toHaveProperty('sessionSummary');
    const guidance = res.body.sessionSummary.guidanceInsights;
    expect(guidance).toBeDefined();
    expect(Array.isArray(guidance.tier1)).toBe(true);
    expect(guidance.tier1[0]).toEqual(expect.objectContaining({ groupId: 'g-1', text: expect.any(String) }));
    expect(guidance.tier2).toEqual(expect.objectContaining({ overall_effectiveness: 0.74 }));
  });
});

