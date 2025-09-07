import request from 'supertest';
import app from '../../../app';

describe('Trace ID middleware', () => {
  it('adds X-Trace-Id header when missing', async () => {
    const res = await request(app).get('/api/v1/ready');
    expect(res.status).toBe(200);
    // supertest lowercases header keys
    expect(res.headers['x-trace-id']).toBeDefined();
    expect(String(res.headers['x-trace-id']).length).toBeGreaterThan(8);
  });

  it('propagates incoming X-Trace-Id header', async () => {
    const res = await request(app)
      .get('/api/v1/ready')
      .set('X-Trace-Id', 'trace-test-123');
    expect(res.status).toBe(200);
    expect(res.headers['x-trace-id']).toBe('trace-test-123');
  });
});
