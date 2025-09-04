export interface EventBusPort {
  emitToSession(sessionId: string, event: string, data: any): boolean;
  emitToGroup(groupId: string, event: string, data: any): boolean;
  emitToRoom(room: string, event: string, data: any): boolean;
}

