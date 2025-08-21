import { Namespace, Socket } from 'socket.io';
import { verifyToken } from '../../utils/jwt.utils';
import { databricksService } from '../databricks.service';
import { webSocketSecurityValidator, SecurityContext } from './websocket-security-validator.service';

export interface NamespaceSocketData {
  userId: string;
  sessionId?: string;
  role: 'teacher' | 'student' | 'admin';
  schoolId?: string;
  connectedAt: Date;
}

export abstract class NamespaceBaseService {
  protected namespace: Namespace;
  protected connectedUsers: Map<string, Set<Socket>> = new Map();

  constructor(namespace: Namespace) {
    this.namespace = namespace;
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private setupMiddleware() {
    this.namespace.use(async (socket, next) => {
      const startTime = Date.now();
      
      try {
        const token = socket.handshake.auth.token as string;
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const decoded = verifyToken(token);
        if (!decoded || !decoded.userId) {
          return next(new Error('Invalid authentication token'));
        }

        // Enhanced user verification with school context
        let user: any = null;
        let userRole: 'teacher' | 'student' | 'admin' = decoded.role as any;
        let schoolId: string | undefined = undefined;

        if (decoded.role === 'teacher' || decoded.role === 'admin') {
          // Verify teacher exists and is active with school context
          user = await databricksService.queryOne(
            `SELECT t.id, t.role, t.status, t.school_id, s.subscription_status 
             FROM classwaves.users.teachers t
             JOIN classwaves.users.schools s ON t.school_id = s.id
             WHERE t.id = ? AND t.status = 'active' AND s.subscription_status = 'active'`,
            [decoded.userId]
          );
          schoolId = (user?.school_id as string | undefined);
        } else if (decoded.role === 'student') {
          // Verify student exists in active session participants with session context
          user = await databricksService.queryOne(
            `SELECT p.student_id as id, 'active' as status, cs.school_id
             FROM classwaves.sessions.participants p
             JOIN classwaves.sessions.classroom_sessions cs ON p.session_id = cs.id
             WHERE p.student_id = ? AND p.is_active = true
             ORDER BY p.join_time DESC
             LIMIT 1`,
            [decoded.userId]
          );
          if (user) {
            (user as any).role = 'student';
            schoolId = (user as any).school_id as string | undefined;
          }
        }

        if (!user) {
          return next(new Error(`User not found or inactive (role: ${decoded.role})`));
        }

        // Create security context for validation
        const securityContext: SecurityContext = {
          userId: decoded.userId,
          role: userRole as 'teacher' | 'student' | 'admin',
          schoolId,
          sessionId: decoded.sessionId,
          authenticatedAt: new Date(),
          ipAddress: socket.handshake.address || 'unknown',
          userAgent: socket.handshake.headers['user-agent'] || 'unknown'
        };

        // Enhanced namespace security validation
        const validationResult = await webSocketSecurityValidator.validateNamespaceAccess(
          socket,
          this.getNamespaceName(),
          securityContext
        );

        if (!validationResult.allowed) {
          const errorMessage = `Access denied to ${this.getNamespaceName()}: ${validationResult.reason}`;
          console.warn(`🚫 WebSocket Security: ${errorMessage}`, {
            userId: decoded.userId,
            role: userRole,
            namespace: this.getNamespaceName(),
            errorCode: validationResult.errorCode,
            ipAddress: securityContext.ipAddress
          });
          return next(new Error(errorMessage));
        }

        // Set enhanced socket data
        socket.data = {
          userId: decoded.userId,
          role: userRole,
          schoolId,
          sessionId: decoded.sessionId,
          connectedAt: new Date(),
          securityContext
        } as NamespaceSocketData & { securityContext: SecurityContext };

        const authDuration = Date.now() - startTime;
        console.log(`✅ ${this.getNamespaceName()} security validation passed for ${userRole} ${decoded.userId} in ${authDuration}ms`);

        next();
      } catch (error) {
        const authDuration = Date.now() - startTime;
        console.error(`❌ ${this.getNamespaceName()} enhanced auth error after ${authDuration}ms:`, error);
        next(new Error('Authentication failed'));
      }
    });
  }

  private setupEventHandlers() {
    this.namespace.on('connection', (socket) => {
      const userId = socket.data.userId;
      console.log(`${this.getNamespaceName()}: User ${userId} connected (${socket.id})`);
      
      // Track multiple connections per user
      if (!this.connectedUsers.has(userId)) {
        this.connectedUsers.set(userId, new Set());
      }
      this.connectedUsers.get(userId)!.add(socket);

      // Setup namespace-specific handlers
      this.onConnection(socket);

      socket.on('disconnect', (reason) => {
        console.log(`${this.getNamespaceName()}: User ${userId} disconnected (${socket.id}) - ${reason}`);
        
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
        console.error(`${this.getNamespaceName()}: Socket error for ${userId}:`, error);
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

  protected emitToRoom(room: string, event: string, data: any): void {
    this.namespace.to(room).emit(event, data);
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
