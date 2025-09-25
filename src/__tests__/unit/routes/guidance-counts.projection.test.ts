import request from 'supertest';
import { createTestApp } from '../../test-utils/app-setup';

// Bypass strict JWT auth
jest.mock('../../../middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { id: 't-1', email: 't@test.edu', school_id: 's-1', role: 'teacher', status: 'active' }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  optionalAuth: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../../middleware/validation.middleware', () => {
  const original = jest.requireActual('../../../middleware/validation.middleware');
  return {
    ...original,
    validateParams: () => (_req: any, _res: any, next: any) => next(),
  };
});

// Mock DB JSON projection for counts
jest.mock('../../../services/databricks.service', () => ({
  databricksService: {
    queryOne: async (sql: string, params?: any[]) => {
      if (/FROM .*session_summaries/i.test(sql)) {
        return { hp: '"7"', t2: '"3"' } as any;
      }
      return null;
    },
    query: async () => [],
  }
}));

// Mock session ownership
jest.mock('../../../app/composition-root', () => {
  const sessionRepo = {
    getOwnedSessionBasic: async (id: string, _teacher: string) => ({ id, teacher_id: 't-1', school_id: 's-1', status: 'ended', title: 'T', created_at: new Date() })
  };
  return {
    getCompositionRoot: () => ({ getSessionRepository: () => sessionRepo })
  };
});

describe('Projection: /api/v1/analytics/session/:id/guidance-counts', () => {
  let app: any;
  beforeAll(async () => {
    const setup = await createTestApp();
    app = setup.app;
  });

  it('returns counts projected from session summary JSON', async () => {
    const res = await request(app)
      .get('/api/v1/analytics/session/11111111-1111-1111-1111-111111111111/guidance-counts')
      .set('Authorization', 'Bearer test-auth-token');

    expect(res.status).toBe(200);

    expect(res.body?.success).toBe(true);
    expect(res.body?.counts).toEqual({ highPriorityCount: 7, tier2Count: 3 });
  });
});
