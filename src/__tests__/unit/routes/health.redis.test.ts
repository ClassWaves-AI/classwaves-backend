import express from 'express';
import request from 'supertest';

import healthRoutes from '../../../routes/health.routes';

// Mock redisService
jest.mock('../../../services/redis.service', () => ({
  redisService: {
    ping: jest.fn().mockResolvedValue(true),
    getClient: () => ({
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue('1'),
      del: jest.fn().mockResolvedValue(1),
    }),
  },
}));

describe('Health Routes - Redis probe', () => {
  let app: express.Application;

  beforeAll(() => {
    app = express();
    app.use('/api/v1/health', healthRoutes);
  });

  it('returns healthy ApiResponse when ping and RW succeed', async () => {
    const res = await request(app).get('/api/v1/health/redis').expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ status: 'healthy' });
    expect(res.body.data.timings.total).toBeGreaterThanOrEqual(0);
  });

  it('returns standardized failure ApiResponse when ping fails', async () => {
    const mod = require('../../../services/redis.service');
    mod.redisService.ping.mockResolvedValueOnce(false);
    const res = await request(app).get('/api/v1/health/redis').expect(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

