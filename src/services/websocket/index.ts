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
