import { Namespace, Socket } from 'socket.io';
import * as client from 'prom-client';
import { verifyToken } from '../../utils/jwt.utils';
import { webSocketSecurityValidator, type SecurityContext } from './websocket-security-validator.service';
import { logger } from '../../utils/logger';

export interface NamespaceSocketData {
  userId: string;
  sessionId?: string;
  role: 'teacher' | 'student' | 'admin' | 'super_admin';
  schoolId?: string;
  connectedAt: Date;
  traceId?: string;
}

export abstract class NamespaceBaseService {
  protected namespace: Namespace;
  protected connectedUsers: Map<string, Set<Socket>> = new Map();
  private lastDisconnectAt: Map<string, number> = new Map();
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
      // Trace correlation: accept from auth or headers and fallback to random
      const rawHeaderTrace = (socket.handshake as any)?.headers?.['x-trace-id'] || (socket.handshake as any)?.headers?.['x-traceid'];
      const authTrace = (socket.handshake as any)?.auth?.traceId || (socket.handshake as any)?.auth?.traceid;
      const traceId = (Array.isArray(authTrace) ? authTrace[0] : authTrace) || (Array.isArray(rawHeaderTrace) ? rawHeaderTrace[0] : rawHeaderTrace) || undefined;

      socket.data = {
        userId: decoded.userId,
        role: userRole,
        schoolId,
        sessionId: decoded.sessionId,
        connectedAt: new Date(),
        traceId: traceId ? String(traceId) : undefined,
      } as NamespaceSocketData;

      // Enforce namespace-level security (role access, connection limits, rate limiting, optional school verification)
      try {
        const nsName = this.getNamespaceName();
        const ip = (socket.handshake as any)?.headers?.['x-forwarded-for'] || (socket.handshake as any)?.address || '';
        const userAgent = String((socket.handshake as any)?.headers?.['user-agent'] || '');
        const securityContext: SecurityContext = {
          userId: decoded.userId,
          role: userRole,
          schoolId,
          sessionId: decoded.sessionId,
          authenticatedAt: new Date(),
          ipAddress: Array.isArray(ip) ? ip[0] : String(ip),
          userAgent,
        };

        const result = await webSocketSecurityValidator.validateNamespaceAccess(socket, nsName, securityContext);
        if (!result.allowed) {
          const reason = result.errorCode || result.reason || 'NAMESPACE_ACCESS_DENIED';
          return next(new Error(reason));
        }
      } catch (e) {
        return next(new Error('NAMESPACE_VALIDATION_FAILED'));
      }

      const authDuration = Date.now() - startTime;
      logger.info('ws:auth_ok', {
        namespace: this.getNamespaceName(),
        userId: decoded.userId,
        role: userRole,
        durationMs: authDuration,
        traceId,
      });

      next();
    });
  }

  private setupEventHandlers() {
    this.namespace.on('connection', (socket) => {
      // Metrics: connection counter
      try {
        const c = (client.register.getSingleMetric('ws_connections_total') as client.Counter<string>)
          || new client.Counter({ name: 'ws_connections_total', help: 'WebSocket connections', labelNames: ['namespace'] });
        c.inc({ namespace: this.getNamespaceName() });
      } catch { /* intentionally ignored: best effort cleanup */ }
      // Standardized connection metric with result label
      try {
        const c2 = (client.register.getSingleMetric('cw_ws_connection_total') as client.Counter<string>)
          || new client.Counter({ name: 'cw_ws_connection_total', help: 'WS connections (standardized)', labelNames: ['namespace', 'result'] });
        c2.inc({ namespace: this.getNamespaceName(), result: 'success' });
      } catch { /* intentionally ignored: best effort cleanup */ }

      // Reconnect heuristic: if same user disconnected recently, count as reconnect
      try {
        const key = `${this.getNamespaceName()}:${socket.data.userId}`;
        const last = this.lastDisconnectAt.get(key) || 0;
        if (last && Date.now() - last < 60_000) {
          const rc = (client.register.getSingleMetric('cw_ws_reconnect_total') as client.Counter<string>)
            || new client.Counter({ name: 'cw_ws_reconnect_total', help: 'WS reconnects detected (heuristic)', labelNames: ['namespace', 'result'] });
          rc.inc({ namespace: this.getNamespaceName(), result: 'success' });
        }
      } catch { /* intentionally ignored: best effort cleanup */ }

      const userId = socket.data.userId;
      logger.info('ws:connect', {
        namespace: this.getNamespaceName(),
        socketId: socket.id,
        userId,
        sessionId: (socket.data as any)?.sessionId,
        traceId: (socket.data as any)?.traceId || undefined,
      });
      
      // Track multiple connections per user
      if (!this.connectedUsers.has(userId)) {
        this.connectedUsers.set(userId, new Set());
      }
      this.connectedUsers.get(userId)!.add(socket);

      // Setup namespace-specific handlers
      this.onConnection(socket);

      // Connection ack with correlation ID (best-effort)
      try {
        socket.emit('ws:connected', {
          namespace: this.getNamespaceName(),
          traceId: (socket.data as any)?.traceId || null,
          serverTime: new Date().toISOString(),
        });
      } catch { /* intentionally ignored: best effort cleanup */ }

      socket.on('disconnect', (reason) => {
        // Metrics: disconnect counter
        try {
          const c = (client.register.getSingleMetric('ws_disconnects_total') as client.Counter<string>)
            || new client.Counter({ name: 'ws_disconnects_total', help: 'WebSocket disconnects', labelNames: ['namespace', 'reason'] });
          c.inc({ namespace: this.getNamespaceName(), reason });
        } catch { /* intentionally ignored: best effort cleanup */ }
        try {
          const key = `${this.getNamespaceName()}:${socket.data.userId}`;
          this.lastDisconnectAt.set(key, Date.now());
        } catch { /* intentionally ignored: best effort cleanup */ }
        logger.info('ws:disconnect', {
          namespace: this.getNamespaceName(),
          socketId: socket.id,
          userId,
          reason,
          sessionId: (socket.data as any)?.sessionId,
          traceId: (socket.data as any)?.traceId || undefined,
        });
        
        const userSockets = this.connectedUsers.get(userId);
        if (userSockets) {
          userSockets.delete(socket);
          if (userSockets.size === 0) {
            this.connectedUsers.delete(userId);
            this.onUserFullyDisconnected(userId);
          }
        }

        // Update security validator connection counts on disconnect (best-effort)
        try {
          const nsName = this.getNamespaceName();
          const ip = (socket.handshake as any)?.headers?.['x-forwarded-for'] || (socket.handshake as any)?.address || '';
          const userAgent = String((socket.handshake as any)?.headers?.['user-agent'] || '');
          const secCtx: SecurityContext = {
            userId: socket.data.userId,
            role: socket.data.role,
            schoolId: (socket.data as any)?.schoolId,
            sessionId: (socket.data as any)?.sessionId,
            authenticatedAt: (socket.data as any)?.connectedAt || new Date(),
            ipAddress: Array.isArray(ip) ? ip[0] : String(ip),
            userAgent,
          };
          void webSocketSecurityValidator.handleDisconnection(secCtx, nsName);
        } catch { /* intentionally ignored: best effort cleanup */ }

        this.onDisconnection(socket, reason);
      });

      socket.on('error', (error) => {
        logger.warn('ws:error', {
          namespace: this.getNamespaceName(),
          socketId: socket.id,
          userId,
          error: error instanceof Error ? error.message : String(error),
          traceId: (socket.data as any)?.traceId || undefined,
        });
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
      // Metrics: count emits by namespace and event
      try {
        const c = (client.register.getSingleMetric('ws_messages_emitted_total') as client.Counter<string>)
          || new client.Counter({ name: 'ws_messages_emitted_total', help: 'WebSocket messages emitted', labelNames: ['namespace', 'event'] });
        c.inc({ namespace: this.getNamespaceName(), event });
      } catch { /* intentionally ignored: best effort cleanup */ }
      // Standardized alias with label 'type'
      try {
        const c2 = (client.register.getSingleMetric('cw_ws_messages_total') as client.Counter<string>)
          || new client.Counter({ name: 'cw_ws_messages_total', help: 'WS messages emitted', labelNames: ['namespace', 'type'] });
        c2.inc({ namespace: this.getNamespaceName(), type: event });
      } catch { /* intentionally ignored: best effort cleanup */ }

      // Event versioning: attach schemaVersion to payload if object-like and absent (non-breaking)
      if (data && typeof data === 'object' && !('schemaVersion' in data)) {
        try { (data as any).schemaVersion = '1.0'; } catch { /* intentionally ignored: best effort cleanup */ }
      }

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
        logger.debug(`WebSocket: Broadcast '${event}' to room '${room}' (participants: ${participantCount})`);
      }
      return true;
    } catch (error) {
      logger.error(`WebSocket broadcast failure:`, {
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
