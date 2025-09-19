// Main WebSocket service exports for namespaced architecture
export { NamespacedWebSocketService, initializeNamespacedWebSocket, getNamespacedWebSocketService } from './namespaced-websocket.service';
export { SessionsNamespaceService } from './sessions-namespace.service';
export { GuidanceNamespaceService } from './guidance-namespace.service';
export { NamespaceBaseService } from './namespace-base.service';

// Legacy exports for backwards compatibility during migration
export { NamespacedWebSocketService as WebSocketService } from './namespaced-websocket.service';
export { initializeNamespacedWebSocket as initializeWebSocket } from './namespaced-websocket.service';

// Types
export type { NamespaceSocketData } from './namespace-base.service';

// Compatibility proxy for legacy `websocket.service` consumers in tests and transitional code
export const websocketService = {
  get io() {
    try { return (require('./namespaced-websocket.service') as typeof import('./namespaced-websocket.service')).getNamespacedWebSocketService()?.getIO() || null; } catch { return null; }
  },
  emitToSession(sessionId: string, event: string, data: any) {
    try {
      const svc = (require('./namespaced-websocket.service') as typeof import('./namespaced-websocket.service')).getNamespacedWebSocketService()?.getSessionsService();
      svc?.emitToSession(sessionId, event, data);
    } catch { /* intentionally ignored: best effort cleanup */ }
  },
  emitToGroup(groupId: string, event: string, data: any) {
    try {
      const svc = (require('./namespaced-websocket.service') as typeof import('./namespaced-websocket.service')).getNamespacedWebSocketService()?.getSessionsService();
      svc?.emitToGroup(groupId, event, data);
    } catch { /* intentionally ignored: best effort cleanup */ }
  },
  notifySessionUpdate(sessionId: string, payload: any) {
    this.emitToSession(sessionId, 'session:status_changed', payload);
  },
  endSession(sessionId: string) {
    this.emitToSession(sessionId, 'session:status_changed', { sessionId, status: 'ended' });
  },
  on(event: string, callback: (...args: any[]) => void) {
    try {
      const io = (require('./namespaced-websocket.service') as typeof import('./namespaced-websocket.service')).getNamespacedWebSocketService()?.getIO();
      (io as any)?.on?.(event as any, callback as any);
    } catch { /* intentionally ignored: best effort cleanup */ }
  },
  emit(event: string, data: any) {
    try {
      const io = (require('./namespaced-websocket.service') as typeof import('./namespaced-websocket.service')).getNamespacedWebSocketService()?.getIO();
      (io as any)?.emit?.(event as any, data);
    } catch { /* intentionally ignored: best effort cleanup */ }
  },
};
