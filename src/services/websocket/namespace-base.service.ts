import { Namespace, Socket } from 'socket.io';
import { verifyToken } from '../../utils/jwt.utils';
import { databricksService } from '../databricks.service';

export interface NamespaceSocketData {
  userId: string;
  sessionId?: string;
  role: 'teacher' | 'student';
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
      try {
        const token = socket.handshake.auth.token as string;
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        const decoded = verifyToken(token);
        if (!decoded || !decoded.userId) {
          return next(new Error('Invalid authentication token'));
        }

        // Support both teachers and students
        let user = null;
        let userRole = decoded.role; // Use role from token

        if (decoded.role === 'teacher' || decoded.role === 'admin') {
          // Verify teacher exists and is active
          user = await databricksService.queryOne(
            `SELECT id, role, status FROM classwaves.users.teachers WHERE id = ? AND status = 'active'`,
            [decoded.userId]
          );
        } else if (decoded.role === 'student') {
          // Verify student exists and is active  
          user = await databricksService.queryOne(
            `SELECT id, status FROM classwaves.users.students WHERE id = ? AND status = 'active'`,
            [decoded.userId]
          );
          // Students don't have a role column, so use token role
          if (user) {
            user.role = 'student';
          }
        }

        if (!user) {
          return next(new Error(`User not found or inactive (role: ${decoded.role})`));
        }

        // Set socket data
        socket.data = {
          userId: decoded.userId,
          role: userRole,
          connectedAt: new Date(),
        } as NamespaceSocketData;

        next();
      } catch (error) {
        console.error(`${this.getNamespaceName()} auth error:`, error);
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
