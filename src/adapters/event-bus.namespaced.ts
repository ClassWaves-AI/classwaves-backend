import type { EventBusPort } from '../services/event-bus.port';
import { getNamespacedWebSocketService } from '../services/websocket/namespaced-websocket.service';

export class NamespacedEventBusAdapter implements EventBusPort {
  emitToSession(sessionId: string, event: string, data: any): boolean {
    try {
      const svc = getNamespacedWebSocketService()?.getSessionsService();
      if (!svc) return false;
      svc.emitToSession(sessionId, event, data);
      return true;
    } catch {
      return false;
    }
  }

  emitToGroup(groupId: string, event: string, data: any): boolean {
    try {
      const svc = getNamespacedWebSocketService()?.getSessionsService();
      if (!svc) return false;
      svc.emitToGroup(groupId, event, data);
      return true;
    } catch {
      return false;
    }
  }

  emitToRoom(room: string, event: string, data: any): boolean {
    try {
      const svc = getNamespacedWebSocketService()?.getSessionsService();
      if (!svc) return false;
      // The sessions service exposes emitToRoom via the base class
      (svc as any).emitToRoom?.(room, event, data);
      return true;
    } catch {
      return false;
    }
  }
}

export const namespacedEventBusAdapter = new NamespacedEventBusAdapter();

