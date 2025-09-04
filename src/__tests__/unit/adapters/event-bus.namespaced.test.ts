jest.mock('../../../services/websocket/namespaced-websocket.service', () => {
  const emitLog: any[] = [];
  return {
    __esModule: true,
    getNamespacedWebSocketService: () => ({
      getSessionsService: () => ({
        emitToSession: (sid: string, event: string, data: any) => emitLog.push({ scope: 'session', sid, event, data }),
        emitToGroup: (gid: string, event: string, data: any) => emitLog.push({ scope: 'group', gid, event, data }),
      })
    }),
    // helper for assertions
    _emitLog: emitLog,
  };
});

import { NamespacedEventBusAdapter } from '../../../adapters/event-bus.namespaced';
import * as ws from '../../../services/websocket/namespaced-websocket.service';

describe('NamespacedEventBusAdapter', () => {
  it('emits to session and group without throwing', () => {
    const adapter = new NamespacedEventBusAdapter();
    expect(adapter.emitToSession('S1', 'test:event', { ok: true })).toBe(true);
    expect(adapter.emitToGroup('G1', 'test:event', { ok: true })).toBe(true);

    // verify mock captured calls
    const log = (ws as any)._emitLog as any[];
    expect(log.some(e => e.scope === 'session' && e.sid === 'S1' && e.event === 'test:event')).toBe(true);
    expect(log.some(e => e.scope === 'group' && e.gid === 'G1' && e.event === 'test:event')).toBe(true);
  });
});

