import request from 'supertest';
import express from 'express';
import { traceIdMiddleware } from '../../../middleware/trace-id.middleware';

describe('traceIdMiddleware', () => {
  it('attaches X-Trace-Id header and locals', async () => {
    const app = express();
    app.use(traceIdMiddleware);
    app.get('/t', (req, res) => {
      const hdr = res.getHeader('X-Trace-Id');
      expect(typeof hdr).toBe('string');
      expect((res.locals as any).traceId).toBe(hdr);
      expect((req as any).traceId).toBe(hdr);
      res.json({ ok: true, traceId: hdr });
    });

    const res = await request(app).get('/t');
    expect(res.status).toBe(200);
    expect(res.headers['x-trace-id']).toBeDefined();
    expect(res.body.traceId).toBe(res.headers['x-trace-id']);
  });

  it('prefers incoming x-request-id when present', async () => {
    const app = express();
    app.use(traceIdMiddleware);
    app.get('/t', (req, res) => {
      res.json({ traceId: (res.locals as any).traceId });
    });

    const res = await request(app)
      .get('/t')
      .set('x-request-id', 'req-12345');
    expect(res.status).toBe(200);
    expect(res.headers['x-trace-id']).toBe('req-12345');
    expect(res.body.traceId).toBe('req-12345');
  });
});

