import { Server as HTTPServer } from 'http';
import { io as clientIO, Socket as ClientSocket } from 'socket.io-client';

import { initializeNamespacedWebSocket } from '../../services/websocket';
import { inMemoryAudioProcessor } from '../../services/audio/InMemoryAudioProcessor';
import { databricksService } from '../../services/databricks.service';

jest.mock('../../services/databricks.service');
const mockDB = databricksService as jest.Mocked<typeof databricksService>;

// Mock JWT verification used by NamespaceBaseService
jest.mock('../../utils/jwt.utils', () => ({
  verifyToken: () => ({ userId: 'teacher-1', role: 'teacher', sessionId: 'sess-1', schoolId: 'school-1' })
}));

describe('Sessions namespace STT (namespaced) — emits transcription:group:new', () => {
  let httpServer: HTTPServer;
  let serverPort: number;
  let teacherSocket: ClientSocket;

  beforeAll(async () => {
    process.env.WS_UNIFIED_STT = '1';
    process.env.STT_PROVIDER = 'off'; // skip Whisper
    process.env.STT_WINDOW_SECONDS = '1';
    process.env.STT_WINDOW_JITTER_MS = '0';

    httpServer = new HTTPServer();
    initializeNamespacedWebSocket(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as any).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (teacherSocket) teacherSocket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockDB.query.mockResolvedValue([] as any);
    mockDB.queryOne.mockResolvedValue({ id: 'sess-1', status: 'active', teacher_id: 'teacher-1', school_id: 'school-1' } as any);
    mockDB.insert.mockResolvedValue(undefined as any);
  });

  it('connects to /sessions, joins session, sends audio:chunk, receives transcription:group:new', async () => {
    // Spy ingest to return a boundary result immediately
    const spy = jest.spyOn(inMemoryAudioProcessor, 'ingestGroupAudioChunk').mockResolvedValue({
      groupId: 'g1',
      sessionId: 'sess-1',
      text: 'mock text',
      confidence: 0.9,
      timestamp: new Date().toISOString(),
      language: 'en',
      duration: 1.0,
    } as any);

    teacherSocket = clientIO(`http://localhost:${serverPort}/sessions`, {
      auth: { token: 'any-token' },
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => teacherSocket.on('connect', () => resolve()));

    // Join the session room as teacher
    teacherSocket.emit('session:join', { sessionId: 'sess-1' });

    const received = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout waiting for transcription')), 3000);
      teacherSocket.on('transcription:group:new', (payload) => {
        clearTimeout(timeout);
        resolve(payload);
      });

      // Send chunk after listener is set
      setTimeout(() => {
        const audio = Buffer.from([1, 2, 3, 4]);
        teacherSocket.emit('audio:chunk', { groupId: 'g1', audioData: audio, mimeType: 'audio/webm;codecs=opus' });
      }, 50);
    });

    expect(received).toBeDefined();
    expect(received.groupId).toBe('g1');
    expect(received.text).toBe('mock text');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

