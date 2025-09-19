import { createTestApp } from '../../test-utils/app-setup';
import { initializeNamespacedWebSocket, getNamespacedWebSocketService } from '../../../services/websocket/namespaced-websocket.service';
import { io, Socket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { JWTConfigService } from '../../../config/jwt.config';

// Allow server listen
process.env.ENABLE_NETWORK_TESTS = '1';

// Mock session ownership checks for WS join
jest.mock('../../../app/composition-root', () => {
  const sessionRepo = {
    getOwnedSessionBasic: async (id: string, _teacherId: string) => ({ id, teacher_id: 'test-teacher-123', school_id: 'test-school-123', status: 'ended', created_at: new Date() })
  };
  return {
    getCompositionRoot: () => ({ getSessionRepository: () => sessionRepo })
  };
});

// Mock Databricks queries for school verification and session join verification
jest.mock('../../../services/databricks.service', () => ({
  databricksService: {
    queryOne: async (sql: string, params: any[]) => {
      const norm = sql.replace(/\s+/g, ' ').toLowerCase();
      if (norm.includes('from classwaves.users.teachers')) {
        // school verification
        return { id: params[0], school_id: params[1], subscription_status: 'active' } as any;
      }
      if (norm.includes('from classwaves.sessions.classroom_sessions')) {
        return { id: params[0], status: 'ended', teacher_id: 'test-teacher-123', school_id: 'test-school-123' } as any;
      }
      return null;
    },
    getClient: () => ({ incr: async () => {}, decr: async () => {} }),
  }
}));

describe('WS: summaries:ready emission to client', () => {
  let port: number;
  let server: any;

  beforeAll(async () => {
    const setup = await createTestApp();
    server = setup.server;
    port = setup.port;
    initializeNamespacedWebSocket(server);
  });

  afterAll(async () => {
    try { (await import('../../../services/websocket/namespaced-websocket.service')).closeNamespacedWebSocket(); } catch { /* intentionally ignored: best effort cleanup */ }
    try { if (server) await new Promise(res => server.close(res)); } catch { /* intentionally ignored: best effort cleanup */ }
  });

  it('delivers summaries:ready to session room listener', async () => {
    const sessionId = 'ws-summary-session-1';
    // Build access token
    const jwtCfg = JWTConfigService.getInstance();
    const token = jwt.sign({
      userId: 'test-teacher-123',
      email: 'teacher@test.edu',
      schoolId: 'test-school-123',
      role: 'teacher',
      sessionId,
      type: 'access'
    }, jwtCfg.getSigningKey(), { algorithm: jwtCfg.getAlgorithm() as jwt.Algorithm, expiresIn: '10m' });

    const url = `http://127.0.0.1:${port}/sessions`;
    const client: Socket = io(url, { transports: ['websocket'], auth: { token } });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
      client.on('connect', () => { clearTimeout(timer); resolve(); });
      client.on('connect_error', (e) => reject(e));
      client.on('error', (e) => { /* ignore */ });
    });

    // Join session room (ack path)
    await new Promise<void>((resolve) => {
      client.emit('session:join', { sessionId }, (_ack: any) => resolve());
    });

    const received = new Promise<{ sessionId: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('did not receive summaries:ready')), 5000);
      client.on('summaries:ready', (payload: any) => { clearTimeout(timer); resolve(payload); });
    });

    // Emit from server to room
    getNamespacedWebSocketService()!
      .getSessionsService()
      .emitToSession(sessionId, 'summaries:ready', { sessionId, timestamp: new Date().toISOString() });

    const payload = await received;
    expect(payload.sessionId).toBe(sessionId);

    client.close();
  });
});
