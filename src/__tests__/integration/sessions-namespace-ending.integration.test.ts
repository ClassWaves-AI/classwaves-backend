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

describe('Sessions namespace — no transcription after session ended', () => {
  let httpServer: HTTPServer;
  let serverPort: number;
  let teacherSocket: ClientSocket;

  beforeAll(async () => {
    process.env.WS_UNIFIED_STT = '1';
    process.env.STT_PROVIDER = 'off'; // deterministic
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
  });

  it('emits audio:error and does not emit transcription when session is not active', async () => {
    // Build snapshot as ended
    mockDB.queryOne.mockResolvedValue({ id: 'sess-1', status: 'ended', teacher_id: 'teacher-1', school_id: 'school-1' } as any);

    // Spy ingest; it should NOT be called due to gating
    const ingestSpy = jest.spyOn(inMemoryAudioProcessor, 'ingestGroupAudioChunk').mockResolvedValue({
      groupId: 'g1',
      sessionId: 'sess-1',
      text: 'should not happen',
      confidence: 0.9,
      timestamp: new Date().toISOString(),
    } as any);

    teacherSocket = clientIO(`http://localhost:${serverPort}/sessions`, {
      auth: { token: 'any-token' },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => teacherSocket.on('connect', () => resolve()));
    teacherSocket.emit('session:join', { sessionId: 'sess-1' });

    const gotAudioError = await new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(() => resolve(false), 1000);
      teacherSocket.on('transcription:group:new', () => {
        clearTimeout(timeout);
        reject(new Error('Should not receive transcription after session ended'));
      });
      teacherSocket.on('audio:error', () => {
        clearTimeout(timeout);
        resolve(true);
      });
      setTimeout(() => {
        teacherSocket.emit('audio:chunk', { groupId: 'g1', audioData: Buffer.from([1,2,3]), mimeType: 'audio/webm;codecs=opus' });
      }, 50);
    });

    expect(gotAudioError).toBe(true);
    expect(ingestSpy).not.toHaveBeenCalled();
    ingestSpy.mockRestore();
  });
});

