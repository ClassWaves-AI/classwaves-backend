import request from 'supertest';
import { createTestApp } from '../../test-utils/app-setup';
// Bypass strict JWT auth for contract shape testing
jest.mock('../../../middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 'test-teacher-123', email: 'teacher@test.edu', school_id: 'test-school-123', role: 'teacher', status: 'active' }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

// Contract tests for summaries endpoints. Focus on response shapes.

// Mock composition root to control repository outputs
jest.mock('../../../app/composition-root', () => {
  const sessionRepo = {
    getOwnedSessionBasic: async (id: string, _teacher: string) => ({ id, teacher_id: 'test-teacher-123', school_id: 'test-school-123', status: 'ended', title: 'T', created_at: new Date() })
  };
  const pendingSummariesRepo = {
    getSessionSummary: async () => null,
    listGroupSummaries: async () => [],
    getGroupSummary: async () => null,
  };
  const readySummariesRepo = {
    getSessionSummary: async (sid: string) => ({ id: 'ss1', session_id: sid, summary_json: JSON.stringify({ themes: ['x'] }), analysis_timestamp: new Date(), created_at: new Date() }),
    listGroupSummaries: async (sid: string) => ([{ id: 'gs1', session_id: sid, group_id: 'g1', summary_json: JSON.stringify({ overview: '...' }), analysis_timestamp: new Date(), created_at: new Date() }]),
    getGroupSummary: async (sid: string, gid: string) => ({ id: 'gs-'+gid, session_id: sid, group_id: gid, summary_json: JSON.stringify({ overview: '...' }), analysis_timestamp: new Date(), created_at: new Date() }),
  };
  let useReady = false;
  return {
    __esModule: true,
    getCompositionRoot: () => ({
      getSessionRepository: () => sessionRepo,
      getSummariesRepository: () => (useReady ? readySummariesRepo : pendingSummariesRepo),
    }),
    __setReady: (v: boolean) => { useReady = v; }
  };
});

describe('Contract: Summaries endpoints', () => {
  let app: any;
  let composition: any;
  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
    composition = await import('../../../app/composition-root');
  });

  it('GET /sessions/:id/summaries returns 202 pending shape', async () => {
    // Ensure pending repository
    (composition as any).__setReady?.(false);
    const res = await request(app)
      .get('/api/v1/sessions/contract-1/summaries')
      .set('Authorization', 'Bearer test-auth-token')
      .expect(202);
    expect(res.body).toEqual({ status: 'pending' });
  });

  it('GET /sessions/:id/summaries returns 200 with sessionSummary and groups[]', async () => {
    (composition as any).__setReady?.(true);
    const res = await request(app)
      .get('/api/v1/sessions/contract-1/summaries')
      .set('Authorization', 'Bearer test-auth-token')
      .expect(200);
    expect(res.body).toHaveProperty('sessionId');
    expect(res.body).toHaveProperty('sessionSummary');
    expect(Array.isArray(res.body.groups)).toBe(true);
    // No SELECT * validation is handled elsewhere; here we assert contract only
  });

  it('GET /sessions/:id/groups/:gid/summary returns 202 pending', async () => {
    (composition as any).__setReady?.(false);
    const res = await request(app)
      .get('/api/v1/sessions/contract-1/groups/g1/summary')
      .set('Authorization', 'Bearer test-auth-token')
      .expect(202);
    expect(res.body).toEqual({ status: 'pending' });
  });

  it('GET /sessions/:id/groups/:gid/summary returns 200 with summary', async () => {
    (composition as any).__setReady?.(true);
    const res = await request(app)
      .get('/api/v1/sessions/contract-1/groups/g1/summary')
      .set('Authorization', 'Bearer test-auth-token')
      .expect(200);
    expect(res.body).toHaveProperty('groupId', 'g1');
    expect(res.body).toHaveProperty('summary');
  });
});
