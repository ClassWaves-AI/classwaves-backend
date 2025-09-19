import { Server as HTTPServer } from 'http';
import request from 'supertest';
import { io as clientIO, Socket as ClientSocket } from 'socket.io-client';

import app from '../../../app';
import { initializeNamespacedWebSocket, closeNamespacedWebSocket } from '../../../services/websocket/namespaced-websocket.service';
import { databricksService } from '../../../services/databricks.service';
import { generateAccessToken } from '../../../utils/jwt.utils';
import { getCSRFToken } from '../../../middleware/csrf.middleware';
import { processAudioJob } from '../../../workers/audio-stt.worker';

jest.mock('../../../services/databricks.service');
const mockDB = databricksService as jest.Mocked<typeof databricksService>;

// Capture queue payload from the upload controller to simulate worker execution
let capturedJob: any = null;
jest.mock('../../../workers/queue.audio-stt', () => ({
  getAudioSttQueue: async () => ({
    add: jest.fn(async (_name: string, data: any) => { capturedJob = data; return { id: 'job-1' }; })
  })
}));

describe('HTTP upload → queue/worker → WS emit → GET transcripts', () => {
  let httpServer: HTTPServer;
  let serverPort: number;
  let teacherSocket: ClientSocket;
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

    // Start app and WS on the same HTTP server
    httpServer = app.listen(0);
    serverPort = (httpServer.address() as any).port;
    initializeNamespacedWebSocket(httpServer);

    // Build auth token compatible with test JWT path
    authToken = generateAccessToken(teacher, school, sessionId);
  });

  afterAll(async () => {
    try { await closeNamespacedWebSocket(); } catch { /* intentionally ignored: best effort cleanup */ }
    if (teacherSocket) teacherSocket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    capturedJob = null;
    // Default mocks: session exists and belongs to teacher; currently active
    mockDB.queryOne.mockImplementation(async () => ({ id: sessionId, status: 'active', teacher_id: teacher.id, school_id: school.id } as any));
    mockDB.update.mockResolvedValue(undefined as any);
  });

  it('orchestrates upload → worker → WS → GET transcripts', async () => {
    // Connect WS client and join the session
    teacherSocket = clientIO(`http://localhost:${serverPort}/sessions`, {
      auth: { token: authToken },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => teacherSocket.on('connect', () => resolve()));
    teacherSocket.emit('session:join', { sessionId });
    await new Promise((r) => setTimeout(r, 25));

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

    expect(uploadResp.body).toMatchObject({ ok: true, queuedJobId: 'job-1' });
    expect(capturedJob).toBeTruthy();

    // Process the captured job synchronously to simulate the worker
    await processAudioJob(capturedJob);

    // Await WS emission
    const wsPayload = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout waiting for transcription')), 2000);
      teacherSocket.on('transcription:group:new', (payload) => {
        if (payload?.groupId === groupId && payload?.sessionId === sessionId) {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });
    expect(wsPayload.text).toBeTruthy();

    // Verify GET /transcripts (reads from Redis)
    const tr = await agent
      .get(`/api/v1/transcripts?sessionId=${sessionId}&groupId=${groupId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
    expect(tr.body?.segments?.length || 0).toBeGreaterThan(0);
  });
});

