import request from 'supertest';
import app from '../../../app';

jest.mock('../../../services/databricks.service', () => ({
  databricksService: {
    healthProbe: jest.fn().mockResolvedValue({ ok: true, durations: { total: 5 }, breaker: { state: 'CLOSED', consecutiveFailures: 0, since: Date.now() }, serverTime: '2025-09-11T12:00:00Z' })
  }
}));

describe('GET /api/v1/health/databricks', () => {
  it('returns standardized ApiResponse with healthy status', async () => {
    const res = await request(app).get('/api/v1/health/databricks');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('healthy');
    expect(res.body.data.breaker).toBeDefined();
  });

  it('handles failure and returns 503 with error', async () => {
    const mod = require('../../../services/databricks.service');
    mod.databricksService.healthProbe.mockResolvedValueOnce({ ok: false, durations: { total: 5 }, breaker: { state: 'OPEN', consecutiveFailures: 5, since: Date.now() } });
    const res = await request(app).get('/api/v1/health/databricks');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
