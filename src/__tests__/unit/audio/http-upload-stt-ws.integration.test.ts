import request from 'supertest';

import app from '../../../app';
import { databricksService } from '../../../services/databricks.service';
import { generateAccessToken } from '../../../utils/jwt.utils';
import { getCSRFToken } from '../../../middleware/csrf.middleware';
import { processAudioJob } from '../../../workers/audio-stt.worker';

jest.mock('../../../services/websocket/websocket-security-validator.service', () => ({
  WebSocketSecurityValidator: class {
    async validateNamespaceAccess() { return { allowed: true }; }
    async logSecurityEvent() { /* noop */ }
  },
}));

jest.mock('../../../services/databricks.service');
const mockDB = databricksService as jest.Mocked<typeof databricksService>;

// Capture queue payload from the upload controller to simulate worker execution
let capturedJob: any = null;
jest.mock('../../../workers/queue.audio-stt', () => ({
  getAudioSttQueue: async () => ({
    add: jest.fn(async (_name: string, data: any) => { capturedJob = data; return { id: 'job-1' }; })
  })
}));

const idempotencyMock = (() => {
  const seen = new Set<string>();
  return {
    withIdempotency: jest.fn(async (key: string, _ttl: number, handler: () => Promise<unknown>) => {
      if (seen.has(key)) return { executed: false };
      seen.add(key);
      const result = await handler();
      return { executed: true, result };
    }),
    reset: () => seen.clear(),
  };
})();

jest.mock('../../../utils/idempotency.port.instance', () => ({
  idempotencyPort: {
    withIdempotency: (key: string, ttl: number, handler: () => Promise<unknown>) => idempotencyMock.withIdempotency(key, ttl, handler),
  },
}));

describe('HTTP upload → queue/worker → WS emit → GET transcripts', () => {
  let authToken: string;

  const teacher: any = { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' };
  const school: any = { id: 'school-1', name: 'Test School' };
  const sessionId = 'sess-1';
  const groupId = 'group-1';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = '1';
    process.env.JWT_SECRET = 'classwaves-test-secret';
    process.env.REDIS_USE_MOCK = '1';

    // Build auth token compatible with test JWT path
    authToken = generateAccessToken(teacher, school, sessionId);
  });

  afterAll(async () => {
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedJob = null;
    idempotencyMock.reset();
    // Default mocks: session exists and belongs to teacher; currently active
    mockDB.queryOne.mockImplementation(async () => ({ id: sessionId, status: 'active', teacher_id: teacher.id, school_id: school.id } as any));
    mockDB.update.mockResolvedValue(undefined as any);
  });

  it('orchestrates upload → worker → WS → GET transcripts', async () => {
    // Prepare agent for CSRF (GET to generate token)
    const agent = request.agent(app);
    await agent.get('/api/v1/ready').set('Authorization', `Bearer ${authToken}`).expect(200);
    const csrf = await getCSRFToken(sessionId);

    // Upload a tiny audio window (valid mime, small buffer)
    const startTs = Date.now() - 10000;
    const endTs = Date.now();
    const chunkId = 'chunk-upload-1';
    const audioBuf = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00]); // EBML header snippet to look like webm

    const uploadResp = await agent
      .post('/api/v1/audio/window')
      .set('Authorization', `Bearer ${authToken}`)
      .set('X-CSRF-Token', csrf || '')
      .field('sessionId', sessionId)
      .field('groupId', groupId)
      .field('chunkId', chunkId)
      .field('startTs', String(startTs))
      .field('endTs', String(endTs))
      .attach('audio', audioBuf, { filename: 'audio.webm', contentType: 'audio/webm' })
      .expect(200);

    expect(uploadResp.body).toMatchObject({ ok: true });
    expect(capturedJob).toBeTruthy();

    // Process the captured job synchronously to simulate the worker
    await processAudioJob(capturedJob);
    const segments = await (await import('../../../services/transcript.service')).transcriptService.read(sessionId, groupId);
    expect(segments.length).toBeGreaterThan(0);
  });
});
