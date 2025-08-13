import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisService } from '../redis.service';
import { SessionsNamespaceService } from './sessions-namespace.service';
import { GuidanceNamespaceService } from './guidance-namespace.service';

export class NamespacedWebSocketService {
  private io: SocketIOServer;
  private sessionsService!: SessionsNamespaceService;
  private guidanceService!: GuidanceNamespaceService;

  constructor(httpServer: HTTPServer) {
    // Initialize Socket.IO server
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? ['https://classwaves.com'] 
          : ['http://localhost:3001', 'http://localhost:3000'],
        methods: ['GET', 'POST'],
        credentials: true
      },
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true
      }
    });

    this.setupRedisAdapter();
    this.initializeNamespaces();
  }

  private async setupRedisAdapter() {
    try {
      if (redisService.isConnected()) {
        const redisClient = redisService.getClient();
        const subClient = redisClient.duplicate();
        
        this.io.adapter(createAdapter(redisClient, subClient));
        console.log('✅ WebSocket Redis adapter configured');
      } else {
        console.warn('⚠️ WebSocket running without Redis adapter (degraded mode)');
      }
    } catch (error) {
      console.error('❌ Failed to setup WebSocket Redis adapter:', error);
      console.warn('⚠️ WebSocket continuing without Redis adapter');
    }
  }

  private initializeNamespaces() {
    // Initialize Sessions namespace (/sessions)
    const sessionsNamespace = this.io.of('/sessions');
    this.sessionsService = new SessionsNamespaceService(sessionsNamespace);
    console.log('✅ Sessions namespace service initialized');

    // Initialize Guidance namespace (/guidance) 
    const guidanceNamespace = this.io.of('/guidance');
    this.guidanceService = new GuidanceNamespaceService(guidanceNamespace);
    console.log('✅ Guidance namespace service initialized');
  }

  public getIO(): SocketIOServer {
    return this.io;
  }

  public getSessionsService(): SessionsNamespaceService {
    return this.sessionsService;
  }

  public getGuidanceService(): GuidanceNamespaceService {
    return this.guidanceService;
  }
}

let namespacedWSService: NamespacedWebSocketService | null = null;

export function initializeNamespacedWebSocket(httpServer: HTTPServer): NamespacedWebSocketService {
  if (!namespacedWSService) {
    namespacedWSService = new NamespacedWebSocketService(httpServer);
    console.log('✅ Namespaced WebSocket service created');
  }
  return namespacedWSService;
}

export function getNamespacedWebSocketService(): NamespacedWebSocketService | null {
  return namespacedWSService;
}
