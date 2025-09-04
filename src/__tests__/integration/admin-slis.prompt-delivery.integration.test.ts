import express from 'express';
import request from 'supertest';

// Ensure Redis mock is used for this test file
process.env.REDIS_USE_MOCK = '1';

// Mock auth to behave as super_admin and bypass role checks
jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-1', role: 'super_admin' };
    req.school = { id: 'school-1' };
    next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

import adminRoutes from '../../routes/admin.routes';
import { redisService } from '../../services/redis.service';

describe('Admin SLIs — Prompt Delivery (Redis mock)', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminRoutes);
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Clear relevant keys in mock Redis
    const client = redisService.getClient();
    const keys = await client.keys('sli:prompt_delivery:session:*');
    for (const k of keys) await client.del(k);
  });

  it('returns zeros when no counters are present', async () => {
    const sessionId = 'sess-zero';
    const res = await request(app)
      .get(`/api/v1/admin/slis/prompt-delivery`)
      .query({ sessionId })
      .expect(200);

    expect(res.body).toEqual({
      success: true,
      data: {
        sessionId,
        metrics: {
          tier1: { delivered: 0, no_subscriber: 0 },
          tier2: { delivered: 0, no_subscriber: 0 },
        }
      }
    });
  });

  it('returns per-session counters for delivered and no_subscriber', async () => {
    const client = redisService.getClient();
    const sessionId = 'sess-1';
    await client.set(`sli:prompt_delivery:session:${sessionId}:tier1:delivered`, '3');
    await client.set(`sli:prompt_delivery:session:${sessionId}:tier1:no_subscriber`, '1');
    await client.set(`sli:prompt_delivery:session:${sessionId}:tier2:delivered`, '2');
    await client.set(`sli:prompt_delivery:session:${sessionId}:tier2:no_subscriber`, '0');

    const res = await request(app)
      .get(`/api/v1/admin/slis/prompt-delivery`)
      .query({ sessionId })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.sessionId).toBe(sessionId);
    expect(res.body.data.metrics).toEqual({
      tier1: { delivered: 3, no_subscriber: 1 },
      tier2: { delivered: 2, no_subscriber: 0 },
    });
  });

  it('filters by tier when provided', async () => {
    const client = redisService.getClient();
    const sessionId = 'sess-2';
    await client.set(`sli:prompt_delivery:session:${sessionId}:tier1:delivered`, '5');
    await client.set(`sli:prompt_delivery:session:${sessionId}:tier2:delivered`, '7');

    const res = await request(app)
      .get(`/api/v1/admin/slis/prompt-delivery`)
      .query({ sessionId, tier: 'tier1' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.metrics).toEqual({
      tier1: { delivered: 5, no_subscriber: 0 },
    });
    expect(res.body.data.metrics.tier2).toBeUndefined();
  });
});

