import { Server as HTTPServer } from 'http';
import request from 'supertest';
import { io as clientIO, Socket as ClientSocket } from 'socket.io-client';

import app from '../../app';
import { initializeNamespacedWebSocket, closeNamespacedWebSocket } from '../../services/websocket/namespaced-websocket.service';
import { databricksService } from '../../services/databricks.service';
import { generateAccessToken } from '../../utils/jwt.utils';

jest.mock('../../services/databricks.service');
const mockDB = databricksService as jest.Mocked<typeof databricksService>;

describe('REST-first session control — WS notify-only', () => {
  let httpServer: HTTPServer;
  let serverPort: number;
  let teacherSocket: ClientSocket;
  let authToken: string;
  const teacher: any = { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' };
  const school: any = { id: 'school-1', name: 'Test School' };
  const sessionId = 'sess-1';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.E2E_TEST_SECRET = '1';
    process.env.JWT_SECRET = 'classwaves-test-secret';

    // Start app and WS on the same HTTP server
    httpServer = app.listen(0);
    serverPort = (httpServer.address() as any).port;
    initializeNamespacedWebSocket(httpServer);

    // Build auth token compatible with test JWT path
    authToken = generateAccessToken(teacher, school, 'test-session');
  });

  afterAll(async () => {
    try { await closeNamespacedWebSocket(); } catch { /* intentionally ignored: best effort cleanup */ }
    if (teacherSocket) teacherSocket.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default mocks: session exists and belongs to teacher; currently active
    mockDB.queryOne.mockImplementation(async (sql: string, params?: any[]) => {
      // Any ownership or join check should return the session
      return { id: sessionId, status: 'active', teacher_id: teacher.id, school_id: school.id } as any;
    });
    mockDB.update.mockResolvedValue(undefined as any);
    mockDB.updateSessionStatus.mockResolvedValue(undefined as any);

    // Connect WS client
    teacherSocket = clientIO(`http://localhost:${serverPort}/sessions`, {
      auth: { token: authToken },
      transports: ['websocket'],
    });
    await new Promise<void>((resolve) => teacherSocket.on('connect', () => resolve()));
    teacherSocket.emit('session:join', { sessionId });
    // Small delay to ensure join room propagation
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(() => {
    if (teacherSocket && teacherSocket.connected) {
      teacherSocket.removeAllListeners();
    }
  });

  it('WS session:update_status does not mutate DB or broadcast', async () => {
    const receivedStatusChanged = new Promise<boolean>((resolve) => {
      let triggered = false;
      const t = setTimeout(() => resolve(triggered), 300);
      teacherSocket.on('session:status_changed', () => {
        triggered = true;
        clearTimeout(t);
        resolve(true);
      });
    });

    // Attempt to change status via WS
    teacherSocket.emit('session:update_status', { sessionId, status: 'paused' });

    const gotBroadcast = await receivedStatusChanged;
    expect(gotBroadcast).toBe(false);
    expect(mockDB.update).not.toHaveBeenCalled();
    expect(mockDB.updateSessionStatus).not.toHaveBeenCalled();
  });

  it('REST pauseSession broadcasts session:status_changed via WS', async () => {
    // Expect REST to call updateSessionStatus
    mockDB.updateSessionStatus.mockResolvedValue(undefined as any);

    const waitForPaused = new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout waiting for session:status_changed')), 2000);
      teacherSocket.on('session:status_changed', (payload: any) => {
        if (payload?.sessionId === sessionId && payload?.status === 'paused') {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });

    // Call REST pause endpoint
    await request(app)
      .post(`/api/v1/sessions/${sessionId}/pause`)
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    const payload = await waitForPaused;
    expect(payload).toMatchObject({ sessionId, status: 'paused' });
    expect(mockDB.updateSessionStatus).toHaveBeenCalledWith(sessionId, 'paused');
  });
});

