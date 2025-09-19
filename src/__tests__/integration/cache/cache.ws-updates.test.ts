import { cacheEventBus } from '../../../services/cache-event-bus.service';

// Use a lightweight bridge test that mocks the Namespaced WS service
// to assert cacheEventBus → WS emission without real sockets

const emitToSession = jest.fn();
const emitCacheUpdatedGlobal = jest.fn();

jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getSessionsService: () => ({
      emitToSession,
      emitToGroup: jest.fn(),
    }),
    getGuidanceService: () => ({
      emitCacheUpdatedGlobal,
    }),
  }),
}));

describe('WS cache:updated bridge', () => {
  beforeEach(() => {
    process.env.REDIS_USE_MOCK = '1';
    jest.clearAllMocks();
  });

  it('emits cache:updated to session room on session.updated', async () => {
    await cacheEventBus.sessionUpdated('sess-1', 'teacher-1', ['title']);
    // Handler awaits invalidation before emitting; allow microtask flush
    await new Promise((r) => setTimeout(r, 5));

    expect(emitToSession).toHaveBeenCalledTimes(1);
    expect(emitToSession).toHaveBeenCalledWith(
      'sess-1',
      'cache:updated',
      expect.objectContaining({ scope: 'session', sessionId: 'sess-1' })
    );
  });

  it('emits cache:updated global on teacher.updated', async () => {
    // Teacher change should notify guidance global listeners
    const { cacheEventBus } = require('../../../services/cache-event-bus.service');
    await cacheEventBus.emitCacheEvent({
      type: 'teacher.updated',
      timestamp: Date.now(),
      payload: { teacherId: 'teacher-9', schoolId: 'school-1', changes: ['name'] },
    });
    await new Promise((r) => setTimeout(r, 5));

    expect(emitCacheUpdatedGlobal).toHaveBeenCalledTimes(1);
    expect(emitCacheUpdatedGlobal).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'teacher', teacherId: 'teacher-9' })
    );
  });
});
