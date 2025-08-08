import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyToken } from '../utils/jwt.utils';
import { redisService } from './redis.service';
import { databricksService } from './databricks.service';
import { inMemoryAudioProcessor } from './audio/InMemoryAudioProcessor';
import { AuthRequest } from '../types/auth.types';
import { v4 as uuidv4 } from 'uuid';

function coerceToBuffer(payload: any): Buffer {
  if (Buffer.isBuffer(payload)) return payload;
  if (payload?.type === 'Buffer' && Array.isArray(payload.data)) return Buffer.from(payload.data);
  if (payload instanceof ArrayBuffer) return Buffer.from(new Uint8Array(payload));
  if (ArrayBuffer.isView(payload)) return Buffer.from(payload as Uint8Array);
  throw new Error('Unsupported audio payload format');
}

function validateMimeType(mimeType: string): void {
  const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/wav'];
  const normalized = mimeType.toLowerCase();
  if (!supported.some((s) => normalized.startsWith(s))) {
    throw new Error(`Unsupported audio format: ${mimeType}`);
  }
}

interface SocketData {
  userId: string;
  sessionId: string;
  schoolId: string;
  role: string;
}

interface ClientToServerEvents {
  joinSession: (sessionCode: string) => void;
  leaveSession: (sessionCode: string) => void;
  sendMessage: (data: { sessionCode: string; message: string }) => void;
  updatePresence: (data: { sessionCode: string; status: string }) => void;
  'group:join': (data: { groupId: string; sessionId: string }) => void;
  'group:status_update': (data: { groupId: string; isReady: boolean }) => void;
  
  // Audio processing events
  'audio:chunk': (data: { groupId: string; audioData: Buffer; format: string; timestamp: number }) => void;
  'audio:stream:start': (data: { groupId: string }) => void;
  'audio:stream:end': (data: { groupId: string }) => void;
}

interface ServerToClientEvents {
  // Replace participant-based events with group-based events
  'group:joined': (data: { groupId: string; sessionId: string; groupInfo: any }) => void;
  'group:left': (data: { groupId: string }) => void;
  'group:status_changed': (data: { groupId: string; status: string; isReady?: boolean }) => void;
  'session:status_changed': (data: { sessionId: string; status: string }) => void;
  
  // Group-centric real-time events
  'transcription:group:new': (data: { 
    id: string;
    groupId: string;
    groupName: string;
    text: string;
    timestamp: string;
    confidence: number;
    language?: string;
  }) => void;
  
  'insight:group:new': (data: {
    groupId: string;
    insightType: 'argumentation_quality' | 'collaboration_patterns' | 'conceptual_understanding' | 'topical_focus';
    message: string;
    severity: 'info' | 'warning' | 'success';
    timestamp: string;
  }) => void;

  // Audio streaming events  
  'audio:stream:start': (data: { groupId: string }) => void;
  'audio:stream:end': (data: { groupId: string }) => void;
  'audio:error': (data: { groupId: string; error: string }) => void;
  
  'error': (data: { code: string; message: string }) => void;
  
  // Legacy events for backward compatibility
  'sessionLeft': (data: { sessionCode: string }) => void;
  'presenceUpdated': (data: { sessionCode: string; userId: string; status: string }) => void;
  'messageReceived': (data: { sessionCode: string; userId: string; message: string; timestamp: Date }) => void;
}

export class WebSocketService {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents, {}, SocketData>;
  private connectedUsers: Map<string, Socket> = new Map();

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.NODE_ENV === 'production'
          ? ['https://classwaves.com', 'https://app.classwaves.com']
          : ['http://localhost:3001'], // Frontend runs on 3001
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    this.setupRedisAdapter();
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  private async setupRedisAdapter() {
    try {
      if (redisService.isConnected()) {
        const pubClient = redisService.getClient();
        
        // Create subscriber client with lazy connection to avoid conflicts
        const subClient = pubClient.duplicate({
          lazyConnect: true
        });
        
        // Only connect if not already connected
        if (subClient.status !== 'ready' && subClient.status !== 'connecting') {
          await subClient.connect();
        }
        
        this.io.adapter(createAdapter(pubClient, subClient));
        console.log('✅ WebSocket Redis adapter configured with pub/sub clients');
      } else {
        console.warn('⚠️  WebSocket using in-memory adapter (Redis not connected)');
      }
    } catch (error) {
      console.error('Failed to setup Redis adapter:', error);
      console.warn('⚠️  Falling back to in-memory WebSocket adapter');
    }
  }

  private setupMiddleware() {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token;
        
        if (!token) {
          return next(new Error('Authentication required'));
        }

        // Verify JWT token
        const payload = verifyToken(token);
        
        // Verify session exists in Redis
        const sessionData = await redisService.getSession(payload.sessionId);
        if (!sessionData) {
          return next(new Error('Session expired'));
        }

        // Attach user data to socket
        socket.data = {
          userId: payload.userId,
          sessionId: payload.sessionId,
          schoolId: payload.schoolId,
          role: payload.role,
        };

        next();
      } catch (error) {
        next(new Error('Invalid authentication token'));
      }
    });
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`User ${socket.data.userId} connected via WebSocket`);
      this.connectedUsers.set(socket.data.userId, socket);

      // Replace participant-based joinSession with group-based joinGroup
      socket.on('group:join', async (data: { groupId: string; sessionId: string }) => {
        try {
          // Verify group exists and session is active
          const group = await databricksService.queryOne(`
            SELECT sg.*, cs.status as session_status
            FROM classwaves.sessions.student_groups sg
            JOIN classwaves.sessions.classroom_sessions cs ON sg.session_id = cs.id
            WHERE sg.id = ? AND cs.id = ?
          `, [data.groupId, data.sessionId]);
          
          if (!group || group.session_status !== 'active') {
            socket.emit('error', {
              code: 'GROUP_JOIN_FAILED',
              message: 'Group not found or session not active',
            });
            return;
          }
          
          await socket.join(`session:${data.sessionId}`);
          await socket.join(`group:${data.groupId}`);
          
          socket.emit('group:joined', { 
            groupId: data.groupId, 
            sessionId: data.sessionId,
            groupInfo: group 
          });
          
          // Notify teacher dashboard
          socket.to(`session:${data.sessionId}`).emit('group:status_changed', {
            groupId: data.groupId,
            status: 'connected'
          });
        } catch (error) {
          socket.emit('error', {
            code: 'GROUP_JOIN_FAILED',
            message: 'Failed to join group session',
          });
        }
      });

      // Handle group status updates from kiosk
      socket.on('group:status_update', async (data: { groupId: string; isReady: boolean }) => {
        try {
          // Update group status in database
          await databricksService.update('student_groups', data.groupId, {
            is_ready: data.isReady,
            updated_at: new Date(),
          });
          
          // Get session ID for this group
          const group = await databricksService.queryOne(`
            SELECT session_id FROM classwaves.sessions.student_groups WHERE id = ?
          `, [data.groupId]);
          
          if (group) {
            // Broadcast to teacher dashboard
            this.io.to(`session:${group.session_id}`).emit('group:status_changed', {
              groupId: data.groupId,
              status: data.isReady ? 'ready' : 'waiting',
              isReady: data.isReady
            });
          }
        } catch (error) {
          socket.emit('error', {
            code: 'STATUS_UPDATE_FAILED',
            message: 'Failed to update group status',
          });
        }
      });

      // Handle audio chunk processing (windowed)
      socket.on('audio:chunk', async (data: { groupId: string; audioData: Buffer; format: string; timestamp: number }) => {
        try {
          // Coerce payload and validate mime
          const audioBuffer = coerceToBuffer(data.audioData);
          validateMimeType(data.format);
          console.log(`🎤 Processing audio chunk for group ${data.groupId}, format: ${data.format}, size: ${audioBuffer.length} bytes`);
          
          // Process audio with InMemoryAudioProcessor (zero-disk guarantee, windowed)
          const result = await inMemoryAudioProcessor.ingestGroupAudioChunk(
            data.groupId,
            audioBuffer,
            data.format,
            socket.data.sessionId
          );
          
          if (result) {
            // Broadcast transcription to teacher dashboard
            this.io.to(`session:${socket.data.sessionId}`).emit('transcription:group:new', {
              id: uuidv4(),
              groupId: data.groupId,
              groupName: `Group ${data.groupId}`,
              text: result.text,
              timestamp: result.timestamp,
              confidence: result.confidence,
              language: result.language
            });
            
            // Store transcription in database for AI analysis
            await databricksService.insert('transcriptions', {
              id: uuidv4(),
              session_id: socket.data.sessionId,
              group_id: data.groupId,
              speaker_id: 'group', // Group-based transcription
              speaker_name: `Group ${data.groupId}`,
              text: result.text,
              confidence: result.confidence,
              language: result.language || 'en',
              duration: result.duration || 0,
              audio_format: data.format,
              processing_time_ms: Date.now() - data.timestamp,
              created_at: new Date(),
              timestamp: new Date(result.timestamp)
            });
            
            console.log(`✅ Window submitted for group ${data.groupId}: "${result.text.substring(0, 50)}..."`);
          }
          
        } catch (error) {
          console.error(`❌ Audio processing failed for group ${data.groupId}:`, error);
          socket.emit('audio:error', { 
            groupId: data.groupId, 
            error: error instanceof Error ? error.message : 'Audio processing failed'
          });
        }
      });

      // Handle audio stream lifecycle - start
      socket.on('audio:stream:start', async (data: { groupId: string }) => {
        try {
          console.log(`🎤 Audio stream started for group ${data.groupId}`);
          
          // Join group room for audio streaming
          await socket.join(`group:${data.groupId}:audio`);
          
          // Notify teacher dashboard that group is recording
          this.io.to(`session:${socket.data.sessionId}`).emit('audio:stream:start', {
            groupId: data.groupId
          });
          
          // Update group status to recording
          await databricksService.update('student_groups', data.groupId, {
            is_recording: true,
            updated_at: new Date()
          });
          
        } catch (error) {
          console.error(`❌ Failed to start audio stream for group ${data.groupId}:`, error);
          socket.emit('audio:error', {
            groupId: data.groupId,
            error: 'Failed to start audio stream'
          });
        }
      });

      // Handle audio stream lifecycle - end
      socket.on('audio:stream:end', async (data: { groupId: string }) => {
        try {
          console.log(`🎤 Audio stream ended for group ${data.groupId}`);
          
          // Leave group audio room
          await socket.leave(`group:${data.groupId}:audio`);
          
          // Notify teacher dashboard that group stopped recording
          this.io.to(`session:${socket.data.sessionId}`).emit('audio:stream:end', {
            groupId: data.groupId
          });
          
          // Update group status
          await databricksService.update('student_groups', data.groupId, {
            is_recording: false,
            updated_at: new Date()
          });
          
        } catch (error) {
          console.error(`❌ Failed to end audio stream for group ${data.groupId}:`, error);
          socket.emit('audio:error', {
            groupId: data.groupId,
            error: 'Failed to end audio stream'
          });
        }
      });

      // Handle leaving a classroom session
      socket.on('leaveSession', async (sessionCode) => {
        await socket.leave(`session:${sessionCode}`);
        
        socket.emit('sessionLeft', { sessionCode });
        
        // Notify others in the session
        socket.to(`session:${sessionCode}`).emit('presenceUpdated', {
          sessionCode,
          userId: socket.data.userId,
          status: 'left',
        });
      });

      // Handle sending messages
      socket.on('sendMessage', async ({ sessionCode, message }) => {
        // Verify user is in the session
        if (!socket.rooms.has(`session:${sessionCode}`)) {
          socket.emit('error', {
            code: 'NOT_IN_SESSION',
            message: 'You must join the session first',
          });
          return;
        }

        // Broadcast message to all in session
        this.io.to(`session:${sessionCode}`).emit('messageReceived', {
          sessionCode,
          userId: socket.data.userId,
          message,
          timestamp: new Date(),
        });
      });

      // Handle presence updates
      socket.on('updatePresence', async ({ sessionCode, status }) => {
        if (!socket.rooms.has(`session:${sessionCode}`)) {
          return;
        }

        socket.to(`session:${sessionCode}`).emit('presenceUpdated', {
          sessionCode,
          userId: socket.data.userId,
          status,
        });
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        console.log(`User ${socket.data.userId} disconnected`);
        this.connectedUsers.delete(socket.data.userId);
        
        // Notify all rooms the user was in
        socket.rooms.forEach((room) => {
          if (room.startsWith('session:')) {
            const sessionCode = room.replace('session:', '');
            socket.to(room).emit('presenceUpdated', {
              sessionCode,
              userId: socket.data.userId,
              status: 'disconnected',
            });
          }
        });
      });
    });
  }

  // Emit event to specific user
  public emitToUser(userId: string, event: keyof ServerToClientEvents, data: any) {
    const socket = this.connectedUsers.get(userId);
    if (socket) {
      socket.emit(event, data);
    }
  }


  // Get all connected users in a session
  public async getSessionParticipants(sessionCode: string): Promise<string[]> {
    const room = this.io.sockets.adapter.rooms.get(`session:${sessionCode}`);
    if (!room) return [];

    const participants: string[] = [];
    for (const socketId of room) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket?.data.userId) {
        participants.push(socket.data.userId);
      }
    }
    return participants;
  }

  // Disconnect a specific user
  public disconnectUser(userId: string) {
    const socket = this.connectedUsers.get(userId);
    if (socket) {
      socket.disconnect();
    }
  }

  // Add this method to emit events to specific sessions
  public emitToSession(sessionId: string, event: keyof ServerToClientEvents, data: any): void {
    this.io.to(`session:${sessionId}`).emit(event, data);
  }

  // Add this method to emit events to specific groups
  public emitToGroup(groupId: string, event: keyof ServerToClientEvents, data: any): void {
    this.io.to(`group:${groupId}`).emit(event, data);
  }

  // Get IO instance for advanced usage
  public getIO() {
    return this.io;
  }
}

let wsService: WebSocketService | null = null;

export function initializeWebSocket(httpServer: HTTPServer): WebSocketService {
  if (!wsService) {
    wsService = new WebSocketService(httpServer);
  }
  return wsService;
}

export function getWebSocketService(): WebSocketService | null {
  return wsService;
}

// Export a proxy object that can be used before initialization
export const websocketService = {
  get io() {
    return wsService?.getIO() || null;
  }
};