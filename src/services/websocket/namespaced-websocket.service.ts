import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redisService } from '../redis.service';
import { SessionsNamespaceService } from './sessions-namespace.service';
import { GuidanceNamespaceService } from './guidance-namespace.service';
import type { Redis } from 'ioredis';

export class NamespacedWebSocketService {
  private io: SocketIOServer;
  private sessionsService!: SessionsNamespaceService;
  private guidanceService!: GuidanceNamespaceService;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(httpServer: HTTPServer) {
    // Initialize Socket.IO server
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? ['https://classwaves.com'] 
          : ['http://localhost:3001', 'http://localhost:3000', 'http://localhost:3003'],
        methods: ['GET', 'POST'],
        credentials: true
      },
      // Protect against oversized payloads in WS
      maxHttpBufferSize: 1 * 1024 * 1024, // 1 MB
      perMessageDeflate: {
        threshold: 16 * 1024, // only compress payloads >16KB
      },
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true
      }
    });

    // Diagnostics similar to legacy service: engine connection error visibility
    try {
      const anyIO: any = this.io as any;
      if (anyIO?.engine?.on) {
        anyIO.engine.on('connection_error', (err: any) => {
          try {
            console.warn('⚠️  Engine.io connection error:', {
              code: err?.code,
              message: err?.message,
              req: {
                headers: err?.req?.headers,
                url: err?.req?.url,
              },
            });
          } catch {}
        });
      }
    } catch {}

    this.setupRedisAdapter();
    this.initializeNamespaces();
  }

  private async setupRedisAdapter() {
    try {
      if (redisService.isConnected()) {
        const redisClient = redisService.getClient();
        this.pubClient = redisClient as unknown as Redis;
        this.subClient = (redisClient as any).duplicate();
        this.io.adapter(createAdapter(this.pubClient as any, this.subClient as any));
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

  public async shutdown(): Promise<void> {
    try {
      await this.io.close();
    } catch {}
    // Ensure Redis adapter clients are closed to avoid hanging the process
    try { await (this.subClient as any)?.quit?.(); } catch {}
    this.subClient = null;
    // Do not quit pubClient here; it belongs to redisService which handles its own shutdown
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

export async function closeNamespacedWebSocket(): Promise<void> {
  try {
    await namespacedWSService?.shutdown();
  } catch {}
  namespacedWSService = null;
}
