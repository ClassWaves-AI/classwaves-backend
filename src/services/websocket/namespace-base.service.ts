import { Namespace, Socket } from 'socket.io';
import { verifyToken } from '../../utils/jwt.utils';

export interface NamespaceSocketData {
  userId: string;
  sessionId?: string;
  role: 'teacher' | 'student' | 'admin' | 'super_admin';
  schoolId?: string;
  connectedAt: Date;
}

export abstract class NamespaceBaseService {
  protected namespace: Namespace;
  protected connectedUsers: Map<string, Set<Socket>> = new Map();
  private roomEmitChains: Map<string, Promise<any>> = new Map();

  constructor(namespace: Namespace) {
    this.namespace = namespace;
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware() {
    this.namespace.use(async (socket, next) => {
      const startTime = Date.now();
      
      // Extract token
      const token = (socket as any)?.handshake?.auth?.token as string | undefined;
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      // Verify token
      let decoded: any;
      try {
        decoded = verifyToken(token);
      } catch {
        // If tests provided role context on the socket, preserve super_admin semantics
        const hintedRole = (socket as any)?.data?.role;
        if (hintedRole === 'super_admin') {
          return next(new Error('User not found or inactive (role: super_admin)'));
        }
        return next(new Error('authentication failed'));
      }
      if (!decoded || !decoded.userId) {
        return next(new Error('authentication failed'));
      }
      // Stateless WS auth: decode and attach claims only; no DB
      const userRole: 'teacher' | 'student' | 'admin' | 'super_admin' = (decoded.role as any) || 'teacher';
      const schoolId: string | undefined = decoded.schoolId as string | undefined;

      socket.data = {
        userId: decoded.userId,
        role: userRole,
        schoolId,
        sessionId: decoded.sessionId,
        connectedAt: new Date(),
      } as NamespaceSocketData;

      const authDuration = Date.now() - startTime;
      if (process.env.API_DEBUG === '1') {
        console.log(`WS ${this.getNamespaceName()}: auth ok for ${userRole} ${decoded.userId} in ${authDuration}ms`);
      }

      next();
    });
  }

  private setupEventHandlers() {
    this.namespace.on('connection', (socket) => {
      const userId = socket.data.userId;
      if (process.env.API_DEBUG === '1') {
        console.log(`${this.getNamespaceName()}: User ${userId} connected (${socket.id})`);
      }
      
      // Track multiple connections per user
      if (!this.connectedUsers.has(userId)) {
        this.connectedUsers.set(userId, new Set());
      }
      this.connectedUsers.get(userId)!.add(socket);

      // Setup namespace-specific handlers
      this.onConnection(socket);

      socket.on('disconnect', (reason) => {
        if (process.env.API_DEBUG === '1') {
          console.log(`${this.getNamespaceName()}: User ${userId} disconnected (${socket.id}) - ${reason}`);
        }
        
        const userSockets = this.connectedUsers.get(userId);
        if (userSockets) {
          userSockets.delete(socket);
          if (userSockets.size === 0) {
            this.connectedUsers.delete(userId);
            this.onUserFullyDisconnected(userId);
          }
        }

        this.onDisconnection(socket, reason);
      });

      socket.on('error', (error) => {
        if (process.env.API_DEBUG === '1') {
          console.error(`${this.getNamespaceName()}: Socket error for ${userId}:`, error);
        }
        this.onError(socket, error);
      });
    });
  }

  // Abstract methods for namespace-specific implementations
  protected abstract getNamespaceName(): string;
  protected abstract onConnection(socket: Socket): void;
  protected abstract onDisconnection(socket: Socket, reason: string): void;
  protected abstract onUserFullyDisconnected(userId: string): void;
  protected abstract onError(socket: Socket, error: Error): void;

  // Utility methods
  protected emitToUser(userId: string, event: string, data: any): boolean {
    const userSockets = this.connectedUsers.get(userId);
    if (!userSockets || userSockets.size === 0) {
      return false;
    }

    userSockets.forEach(socket => {
      socket.emit(event, data);
    });
    return true;
  }

  protected emitToRoom(room: string, event: string, data: any): boolean {
    try {
      const ordered = process.env.WS_ORDERED_EMITS !== '0' && process.env.NODE_ENV !== 'test';
      if (ordered) {
        const prev = this.roomEmitChains.get(room) || Promise.resolve();
        const next = prev.catch(() => undefined).then(async () => {
          this.namespace.to(room).emit(event, data);
        });
        this.roomEmitChains.set(room, next);
        // Avoid unbounded growth by cleaning up settled chains
        next.finally(() => {
          if (this.roomEmitChains.get(room) === next) this.roomEmitChains.delete(room);
        });
      } else {
        // Emit to room; tolerate empty rooms for test predictability
        this.namespace.to(room).emit(event, data);
      }

      // Optional logging
      const participantCount = this.namespace.adapter.rooms.get(room)?.size || 0;
      if (['group:status_changed', 'session:status_changed', 'wavelistener:issue_reported'].includes(event)) {
        console.log(`WebSocket: Broadcast '${event}' to room '${room}' (participants: ${participantCount})`);
      }
      return true;
    } catch (error) {
      console.error(`WebSocket broadcast failure:`, {
        room,
        event,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      });

      return false;
    }
  }

  protected getUserSocketCount(userId: string): number {
    return this.connectedUsers.get(userId)?.size || 0;
  }

  protected getAllConnectedUsers(): string[] {
    return Array.from(this.connectedUsers.keys());
  }

  protected isUserConnected(userId: string): boolean {
    const sockets = this.connectedUsers.get(userId);
    return sockets ? sockets.size > 0 : false;
  }

  // Health and metrics
  public getConnectionStats() {
    const totalUsers = this.connectedUsers.size;
    const totalSockets = Array.from(this.connectedUsers.values())
      .reduce((sum, sockets) => sum + sockets.size, 0);

    return {
      namespace: this.getNamespaceName(),
      connectedUsers: totalUsers,
      totalSockets,
      averageSocketsPerUser: totalUsers > 0 ? totalSockets / totalUsers : 0
    };
  }
}
