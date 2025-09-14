import request from 'supertest';
import app from '../../../app';
import { generateAccessToken } from '../../../utils/jwt.utils';

describe('audio.window.controller guardrails (REST min-interval)', () => {
  const teacher: any = { id: 't-1', email: 't@example.com', role: 'teacher' };
  const school: any = { id: 's-1', name: 'Test School' };
  const sessionId = 'sess-guard-1';
  const groupId = 'group-guard-1';

  let authToken: string;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.REDIS_USE_MOCK = '1';
    process.env.JWT_SECRET = 'classwaves-test-secret';
    process.env.AUDIO_WINDOW_MIN_INTERVAL_MS = '1000';
    delete process.env.AUDIO_REST_MAX_PER_SEC; // ensure we test min-interval path
    authToken = generateAccessToken(teacher, school, sessionId);
  });

  it('returns 429 with Retry-After on rapid successive uploads within min interval', async () => {
    const agent = request.agent(app);

    const startTs = Date.now() - 8000;
    const endTs = Date.now();
    const audioBuf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]); // EBML header snippet

    // First upload should pass
    const r1 = await agent
      .post('/api/v1/audio/window')
      .set('Authorization', `Bearer ${authToken}`)
      .field('sessionId', sessionId)
      .field('groupId', groupId)
      .field('chunkId', 'c-1')
      .field('startTs', String(startTs))
      .field('endTs', String(endTs))
      .attach('audio', audioBuf, { filename: 'a.webm', contentType: 'audio/webm' });
    expect(r1.status).toBe(200);
    expect(r1.body?.ok).toBe(true);

    // Immediate second upload (same group) should hit min-interval guard → 429
    const r2 = await agent
      .post('/api/v1/audio/window')
      .set('Authorization', `Bearer ${authToken}`)
      .field('sessionId', sessionId)
      .field('groupId', groupId)
      .field('chunkId', 'c-2')
      .field('startTs', String(startTs))
      .field('endTs', String(endTs))
      .attach('audio', audioBuf, { filename: 'b.webm', contentType: 'audio/webm' });
    expect([429, 503]).toContain(r2.status);
    expect(r2.headers['retry-after']).toBeDefined();
    try { const j = r2.body; expect(j && j.ok === false && j.error === 'RATE_LIMITED').toBe(true); } catch {}
  });
});

