import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { verifyToken } from '../utils/jwt.utils';
import { redisService } from './redis.service';
import { databricksService } from './databricks.service';
import { databricksConfig } from '../config/databricks.config';
import { inMemoryAudioProcessor } from './audio/InMemoryAudioProcessor';
import { aiAnalysisBufferService } from './ai-analysis-buffer.service';
import { teacherPromptService } from './teacher-prompt.service';
import { alertPrioritizationService } from './alert-prioritization.service';
import { guidanceSystemHealthService } from './guidance-system-health.service';
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
  
  // Teacher dashboard session control
  'session:join': (data: { session_id?: string; sessionId?: string }) => void;
  'session:leave': (data: { session_id?: string; sessionId?: string }) => void;
  
  // Group leader readiness
  'group:leader_ready': (data: { sessionId: string; groupId: string; ready: boolean }) => void;
  
  // Student session control
  'student:session:join': (data: { sessionId: string }) => void;
  
  // REMOVED: 'session:update_status' - duplicates REST API logic
  // Session status updates should only go through REST endpoints to ensure
  // proper business logic, validation, and analytics recording

  // Delivery confirmation events
  'teacher:alert:delivery:confirm': (data: { alertId: string; deliveryId: string; sessionId: string }) => void;
  'teacher:batch:delivery:confirm': (data: { batchId: string; deliveryId: string; sessionId: string }) => void;
  'teacher:insight:delivery:confirm': (data: { insightId: string; insightType: 'tier1' | 'tier2'; sessionId: string }) => void;
}

interface ServerToClientEvents {
  // Replace participant-based events with group-based events
  'group:joined': (data: { groupId: string; sessionId: string; groupInfo: any }) => void;
  'group:left': (data: { groupId: string }) => void;
  'group:status_changed': (data: { groupId: string; status: string; isReady?: boolean }) => void;
  'session:status_changed': (data: { sessionId: string; status: string }) => void;
  'student:session:joined': (data: { sessionId: string; groupId: string; groupName: string }) => void;
  
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

  // AI Analysis Insights - New events for Phase B
  'group:tier1:insight': (data: {
    groupId: string;
    sessionId: string;
    insights: any;
    timestamp: string;
  }) => void;

  'group:tier2:insight': (data: {
    sessionId: string;
    insights: any;
    timestamp: string;
  }) => void;

  // Teacher Guidance System - Alert and Prompt Events
  'teacher:alert:immediate': (data: {
    alert: {
      id: string;
      prompt: any;
      priority: number;
      deliveryTime: string;
    };
  }) => void;

  'teacher:alert:batch': (data: {
    batchId: string;
    batchType: 'urgent' | 'regular' | 'low_priority';
    alerts: Array<{
      id: string;
      prompt: any;
      priority: number;
      contextFactors: any;
    }>;
    totalAlerts: number;
    deliveryTime: string;
  }) => void;

  'teacher:prompt:acknowledged': (data: { promptId: string; timestamp: string }) => void;
  'teacher:prompt:used': (data: { promptId: string; timestamp: string }) => void;
  'teacher:prompt:dismissed': (data: { promptId: string; timestamp: string }) => void;

  // Analytics events
  'analytics:finalized': (data: { sessionId: string; timestamp: string }) => void;

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
          : ['http://localhost:3001', 'http://localhost:3003'], // Frontend on 3001, Student Portal on 3003
        credentials: true,
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    // Diagnostic: server-level connection state
    this.io.engine.on('connection_error', (err: any) => {
      console.warn('⚠️  Engine.io connection error:', {
        code: (err as any)?.code,
        message: (err as any)?.message,
        req: {
          headers: (err as any)?.req?.headers,
          url: (err as any)?.req?.url,
        },
      });
    });

    this.io.engine.on('heartbeat', (transport: any) => {
      // Low-cost heartbeat log to correlate timeouts (opt-in)
      if (process.env.WS_DEBUG === '1') {
        console.log('💓 WS heartbeat', transport?.name);
      }
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
        
        // Verify session exists for teacher/admin/super_admin; students don't maintain secure sessions
        let sessionOk = false;
        if (payload.role === 'teacher' || payload.role === 'admin' || payload.role === 'super_admin') {
          const sessionData = await redisService.getSession(payload.sessionId);
          if (sessionData) {
            sessionOk = true;
          } else {
            try {
              const { SecureSessionService } = await import('./secure-session.service');
              const secure = await SecureSessionService.getSecureSession(payload.sessionId as string);
              sessionOk = !!secure;
            } catch {
              sessionOk = false;
            }
          }
          if (!sessionOk) {
            return next(new Error('Session expired'));
          }
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
      console.log(`🔧 DEBUG: User ${socket.data.userId} connected via WebSocket with role ${socket.data.role}`);
      this.connectedUsers.set(socket.data.userId, socket);

      // Replace participant-based joinSession with group-based joinGroup
      // Session-level join for teacher dashboard
      socket.on('session:join', async (data: { session_id?: string; sessionId?: string }) => {
        try {
          const sessionId = (data?.session_id || data?.sessionId || '').trim();
          if (!sessionId) {
            socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'session_id is required' });
            return;
          }

          // Verify session belongs to authenticated teacher
          const session = await databricksService.queryOne(
            `SELECT id, status FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
            [sessionId, socket.data.userId]
          );
          if (!session) {
            socket.emit('error', { code: 'SESSION_NOT_FOUND', message: 'Session not found or not owned by user' });
            return;
          }

          await socket.join(`session:${sessionId}`);
          // Optionally echo current status so UI can sync
          socket.emit('session:status_changed', { sessionId, status: session.status });
        } catch (err) {
          socket.emit('error', { code: 'SESSION_JOIN_FAILED', message: 'Failed to join session' });
        }
      });

      socket.on('session:leave', async (data: { session_id?: string; sessionId?: string }) => {
        try {
          const sessionId = (data?.session_id || data?.sessionId || '').trim();
          if (!sessionId) return;
          await socket.leave(`session:${sessionId}`);
          socket.emit('sessionLeft', { sessionCode: sessionId });
        } catch (err) {
          socket.emit('error', { code: 'SESSION_LEAVE_FAILED', message: 'Failed to leave session' });
        }
      });

      // Student-specific session join handler
      // Students need to join session rooms to receive group status updates
      socket.on('student:session:join', async (data: { sessionId: string }) => {
        try {
          const { sessionId } = data;
          if (!sessionId) {
            socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'sessionId is required' });
            return;
          }

          // Verify student is a participant in this session
          const participant = await databricksService.queryOne(
            `SELECT p.id, p.session_id, p.student_id, p.group_id, sg.name as group_name
             FROM ${databricksConfig.catalog}.sessions.participants p 
             LEFT JOIN ${databricksConfig.catalog}.sessions.student_groups sg ON p.group_id = sg.id
             WHERE p.session_id = ? AND p.student_id = ?`,
            [sessionId, socket.data.userId]
          );
          
          if (!participant) {
            socket.emit('error', { 
              code: 'SESSION_ACCESS_DENIED', 
              message: 'Student not enrolled in this session' 
            });
            return;
          }

          // Join session room to receive group status updates
          await socket.join(`session:${sessionId}`);
          
          // Also join group-specific room if assigned
          if (participant.group_id) {
            await socket.join(`group:${participant.group_id}`);
          }

          socket.emit('student:session:joined', { 
            sessionId,
            groupId: participant.group_id,
            groupName: participant.group_name
          });
          
          console.log(`Student ${socket.data.userId} joined session ${sessionId} and group ${participant.group_id}`);
        } catch (error) {
          console.error('Student session join error:', error);
          socket.emit('error', { 
            code: 'STUDENT_SESSION_JOIN_FAILED', 
            message: 'Failed to join session as student' 
          });
        }
      });

      // Phase 5: Handle group leader ready signal
      // Groups are pre-configured in declarative workflow
      socket.on('group:leader_ready', async (data: { sessionId: string; groupId: string; ready: boolean }) => {
        try {
          // Validate that student is the designated leader for this group
          const group = await databricksService.queryOne(`
            SELECT leader_id, session_id, name 
            FROM ${databricksConfig.catalog}.sessions.student_groups 
            WHERE id = ? AND session_id = ?
          `, [data.groupId, data.sessionId]);
          
          if (!group) {
            socket.emit('error', {
              code: 'GROUP_NOT_FOUND',
              message: 'Group not found',
            });
            return;
          }

          // Note: Group leader validation will be added in future iterations
          // Currently accepting any readiness signal for MVP flexibility
          
          // Update group readiness status
          await databricksService.update('student_groups', data.groupId, {
            is_ready: data.ready,
          });
          
          // Record analytics for leader readiness
          if (data.ready) {
            await recordLeaderReady(data.sessionId, data.groupId, group.leader_id);
          }
          
          // Broadcast group status change to teacher clients
          const broadcastEvent = {
            groupId: data.groupId,
            status: data.ready ? 'ready' : 'waiting',
            isReady: data.ready
          };
          
          console.log(`🎯 [WEBSOCKET DEBUG] Broadcasting group:status_changed to session:${data.sessionId}`);
          console.log(`🎯 [WEBSOCKET DEBUG] Broadcast payload:`, broadcastEvent);
          
          this.io.to(`session:${data.sessionId}`).emit('group:status_changed', broadcastEvent);
          
          console.log(`🎯 Group ${group.name} leader marked ${data.ready ? 'ready' : 'not ready'} in session ${data.sessionId}`);
        } catch (error) {
          console.error('Error handling group leader ready:', error);
          socket.emit('error', {
            code: 'LEADER_READY_FAILED',
            message: 'Failed to update leader readiness',
          });
        }
      });

      // Handle audio chunk processing (windowed)
      socket.on('audio:chunk', async (data: { groupId: string; audioData: Buffer; format: string; timestamp: number }) => {
        try {
          // Backpressure diagnostics: drop too-large payloads to prevent disconnects
          const approxSize = (data as any)?.audioData?.length || 0;
          if (approxSize > 1024 * 1024 * 2) { // >2MB
            console.warn(`⚠️  Dropping oversized audio chunk (~${approxSize} bytes) for group ${data.groupId}`);
            socket.emit('audio:error', { groupId: data.groupId, error: 'Payload too large' });
            return;
          }

          // Socket-level backpressure: consult processor window state and drop oldest/reject when overloaded
          const windowInfo = inMemoryAudioProcessor.getGroupWindowInfo(data.groupId);
          // Heuristics: if queued bytes exceed ~5MB or chunks > 50, reject this chunk
          if (windowInfo.bytes > 5 * 1024 * 1024 || windowInfo.chunks > 50) {
            // Increment metric via processor (reusing the drop counter by simulating 1 dropped chunk)
            // We cannot directly access the private counter; instead, trigger backpressure handling which increments it
            try { await (inMemoryAudioProcessor as any).handleBackPressure?.(data.groupId); } catch { /* ignore */ }
            console.warn(`⚠️  Socket backpressure: rejecting audio chunk for group ${data.groupId} (bytes=${windowInfo.bytes}, chunks=${windowInfo.chunks})`);
            socket.emit('audio:error', { groupId: data.groupId, error: 'Backpressure: please slow down' });
            return;
          }

          // Coerce payload and validate mime
          const audioBuffer = coerceToBuffer(data.audioData);
          validateMimeType(data.format);
          console.log(`🎤 Processing audio chunk for group ${data.groupId}, format: ${data.format}, size: ${audioBuffer.length} bytes`);
          
          // Process audio with InMemoryAudioProcessor (zero-disk guarantee, windowed)
          const result = await inMemoryAudioProcessor.ingestGroupAudioChunk(
            data.groupId,
            audioBuffer,
            data.format,
            socket.data.sessionId,
            socket.data.schoolId
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
            
            // ✅ AI ANALYSIS INTEGRATION: Buffer transcription for AI analysis
            try {
              await aiAnalysisBufferService.bufferTranscription(
                data.groupId,
                socket.data.sessionId,
                result.text
              );
              
              // Check if we should trigger analysis
              await this.checkAndTriggerAIAnalysis(data.groupId, socket.data.sessionId, socket.data.userId);
            } catch (error) {
              console.error(`⚠️ AI buffering failed for group ${data.groupId}:`, error);
              // Don't fail the main transcription flow
            }
            
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

      // ============================================================================
      // Delivery Confirmation Handlers
      // ============================================================================

      // Handle alert delivery confirmation
      socket.on('teacher:alert:delivery:confirm', async (data: { alertId: string; deliveryId: string; sessionId: string }) => {
        try {
          // Verify session ownership
          const session = await databricksService.queryOne(
            `SELECT id FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
            [data.sessionId, socket.data.userId]
          );

          if (session) {
            await alertPrioritizationService.confirmAlertDelivery(data.alertId, data.deliveryId, data.sessionId);
            console.log(`✅ Alert delivery confirmed by teacher: ${data.alertId}`);
          }
        } catch (error) {
          console.error(`❌ Failed to confirm alert delivery:`, error);
          socket.emit('error', { code: 'CONFIRMATION_FAILED', message: 'Failed to confirm alert delivery' });
        }
      });

      // Handle batch delivery confirmation
      socket.on('teacher:batch:delivery:confirm', async (data: { batchId: string; deliveryId: string; sessionId: string }) => {
        try {
          // Verify session ownership
          const session = await databricksService.queryOne(
            `SELECT id FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
            [data.sessionId, socket.data.userId]
          );

          if (session) {
            await alertPrioritizationService.confirmBatchDelivery(data.batchId, data.deliveryId, data.sessionId);
            console.log(`✅ Batch delivery confirmed by teacher: ${data.batchId}`);
          }
        } catch (error) {
          console.error(`❌ Failed to confirm batch delivery:`, error);
          socket.emit('error', { code: 'CONFIRMATION_FAILED', message: 'Failed to confirm batch delivery' });
        }
      });

      // Handle AI insight delivery confirmation
      socket.on('teacher:insight:delivery:confirm', async (data: { insightId: string; insightType: 'tier1' | 'tier2'; sessionId: string }) => {
        try {
          // Verify session ownership
          const session = await databricksService.queryOne(
            `SELECT id FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
            [data.sessionId, socket.data.userId]
          );

          if (session) {
            // Log insight delivery confirmation
            await databricksService.recordAuditLog({
              actorId: socket.data.userId,
              actorType: 'teacher',
              eventType: 'ai_insight_delivery_confirmed',
              eventCategory: 'system_interaction',
              resourceType: 'ai_insight',
              resourceId: data.insightId,
              schoolId: socket.data.schoolId,
              description: `Teacher confirmed receipt of ${data.insightType} AI insight`,
              complianceBasis: 'system_monitoring',
              dataAccessed: `${data.insightType}_insight_delivery_confirmation`
            });

            console.log(`✅ AI insight delivery confirmed by teacher: ${data.insightId} (${data.insightType})`);
          }
        } catch (error) {
          console.error(`❌ Failed to confirm insight delivery:`, error);
          socket.emit('error', { code: 'CONFIRMATION_FAILED', message: 'Failed to confirm insight delivery' });
        }
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
    for (const socketId of Array.from(room)) {
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

  // ============================================================================
  // AI Analysis Integration Methods
  // ============================================================================

  /**
   * Check if AI analysis should be triggered and execute if ready
   */
  private async checkAndTriggerAIAnalysis(groupId: string, sessionId: string, teacherId: string): Promise<void> {
    try {
      // Get buffered transcripts for analysis
      const tier1Transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', groupId, sessionId);
      const tier2Transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier2', groupId, sessionId);

      // Check Tier 1 analysis (30s window)
      if (tier1Transcripts.length >= 3 && this.shouldTriggerTier1Analysis(tier1Transcripts)) {
        await this.triggerTier1Analysis(groupId, sessionId, teacherId, tier1Transcripts);
      }

      // Check Tier 2 analysis (3min window)  
      if (tier2Transcripts.length >= 8 && this.shouldTriggerTier2Analysis(tier2Transcripts)) {
        await this.triggerTier2Analysis(sessionId, teacherId, tier2Transcripts);
      }

    } catch (error) {
      console.error(`❌ AI analysis check failed for group ${groupId}:`, error);
    }
  }

  /**
   * Determine if Tier 1 analysis should be triggered
   */
  private shouldTriggerTier1Analysis(transcripts: string[]): boolean {
    // Simple heuristic: trigger every 30 seconds with minimum content
    const combinedLength = transcripts.join(' ').length;
    return combinedLength > 100; // Minimum content threshold
  }

  /**
   * Determine if Tier 2 analysis should be triggered
   */
  private shouldTriggerTier2Analysis(transcripts: string[]): boolean {
    // Simple heuristic: trigger every 3 minutes with substantial content
    const combinedLength = transcripts.join(' ').length;
    return combinedLength > 500; // Substantial content threshold
  }

  /**
   * Trigger Tier 1 AI analysis and broadcast insights
   */
  private async triggerTier1Analysis(groupId: string, sessionId: string, teacherId: string, transcripts: string[]): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log(`🧠 Triggering Tier 1 analysis for group ${groupId}`);

      // Import AI analysis controller dynamically to avoid circular dependencies
      const { databricksAIService } = await import('./databricks-ai.service');

      // Perform Tier 1 analysis
      const insights = await databricksAIService.analyzeTier1(transcripts, {
        groupId,
        sessionId,
        focusAreas: ['topical_cohesion', 'conceptual_density'],
        windowSize: 30,
        includeMetadata: true
      });

      // Broadcast insights to teacher dashboard
      this.emitToSession(sessionId, 'group:tier1:insight', {
        groupId,
        sessionId,
        insights,
        timestamp: insights.analysisTimestamp
      });

      // Generate teacher prompts from insights
      await this.generateTeacherPromptsFromInsights(insights, sessionId, groupId, teacherId);

      // Mark buffer as analyzed
      await aiAnalysisBufferService.markBufferAnalyzed('tier1', groupId, sessionId);

      // ✅ HEALTH MONITORING: Record successful AI analysis
      const duration = Date.now() - startTime;
      guidanceSystemHealthService.recordSuccess('aiAnalysis', 'tier1_analysis', duration);

      console.log(`✅ Tier 1 analysis completed and broadcasted for group ${groupId}`);

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Tier 1 analysis failed for group ${groupId}:`, error);
      
      // ✅ HEALTH MONITORING: Record failed AI analysis
      guidanceSystemHealthService.recordFailure('aiAnalysis', 'tier1_analysis', duration, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Trigger Tier 2 AI analysis and broadcast insights  
   */
  private async triggerTier2Analysis(sessionId: string, teacherId: string, transcripts: string[]): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log(`🧠 Triggering Tier 2 analysis for session ${sessionId}`);

      // Import AI analysis controller dynamically
      const { databricksAIService } = await import('./databricks-ai.service');

      // Perform Tier 2 analysis
      const insights = await databricksAIService.analyzeTier2(transcripts, {
        sessionId,
        groupIds: [], // Will be populated by the analysis
        analysisDepth: 'standard',
        includeComparative: true,
        includeMetadata: true
      });

      // Broadcast insights to teacher dashboard
      this.emitToSession(sessionId, 'group:tier2:insight', {
        sessionId,
        insights,
        timestamp: insights.analysisTimestamp
      });

      // Generate teacher prompts from deeper insights
      await this.generateTeacherPromptsFromInsights(insights, sessionId, undefined, teacherId);

      // ✅ HEALTH MONITORING: Record successful AI analysis
      const duration = Date.now() - startTime;
      guidanceSystemHealthService.recordSuccess('aiAnalysis', 'tier2_analysis', duration);

      console.log(`✅ Tier 2 analysis completed and broadcasted for session ${sessionId}`);

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Tier 2 analysis failed for session ${sessionId}:`, error);
      
      // ✅ HEALTH MONITORING: Record failed AI analysis
      guidanceSystemHealthService.recordFailure('aiAnalysis', 'tier2_analysis', duration, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Generate teacher prompts from AI insights and deliver via alert system
   */
  private async generateTeacherPromptsFromInsights(
    insights: any, 
    sessionId: string, 
    groupId: string | undefined, 
    teacherId: string
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Generate contextual teacher prompts
      const prompts = await teacherPromptService.generatePrompts(insights, {
        sessionId,
        groupId: groupId || 'session-level',
        teacherId,
        sessionPhase: 'development', // TODO: Get actual phase from session state
        subject: 'general', // TODO: Get from session data
        learningObjectives: [], // TODO: Get from session data
        groupSize: 4, // TODO: Get from actual group data
        sessionDuration: 60 // TODO: Get from session data
      });

      // Prioritize and deliver prompts via alert system
      let successfulDeliveries = 0;
      for (const prompt of prompts) {
        try {
          await alertPrioritizationService.prioritizeAlert(prompt, {
            sessionId,
            teacherId,
            sessionPhase: 'development',
            currentAlertCount: 0, // TODO: Track actual count
            teacherEngagementScore: 0.7 // TODO: Calculate from user activity
          });
          successfulDeliveries++;
        } catch (deliveryError) {
          console.error(`❌ Failed to deliver prompt ${prompt.id}:`, deliveryError);
          
          // ✅ HEALTH MONITORING: Record alert delivery failure
          guidanceSystemHealthService.recordFailure('alertDelivery', 'prompt_delivery', Date.now() - startTime, deliveryError instanceof Error ? deliveryError.message : 'Unknown delivery error');
        }
      }

      // ✅ HEALTH MONITORING: Record successful prompt generation
      const duration = Date.now() - startTime;
      guidanceSystemHealthService.recordSuccess('promptGeneration', 'prompt_generation', duration);
      
      // ✅ HEALTH MONITORING: Record alert delivery success rate
      if (successfulDeliveries > 0) {
        guidanceSystemHealthService.recordSuccess('alertDelivery', 'prompt_delivery', duration);
      }

      console.log(`📝 Generated ${prompts.length} teacher prompts from AI insights (${successfulDeliveries} delivered)`);

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Teacher prompt generation failed:`, error);
      
      // ✅ HEALTH MONITORING: Record prompt generation failure
      guidanceSystemHealthService.recordFailure('promptGeneration', 'prompt_generation', duration, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  // Get IO instance for advanced usage
  public getIO() {
    return this.io;
  }
}

let wsService: WebSocketService | null = null;

export function initializeWebSocket(httpServer: HTTPServer): WebSocketService {
  console.log('🔧 DEBUG: Initializing WebSocket service...');
  if (!wsService) {
    wsService = new WebSocketService(httpServer);
    console.log('🔧 DEBUG: WebSocket service created successfully');
  }
  return wsService;
}

export function getWebSocketService(): WebSocketService | null {
  return wsService;
}

/**
 * Helper: Record leader ready analytics event
 */
async function recordLeaderReady(sessionId: string, groupId: string, leaderId: string): Promise<void> {
  const { logAnalyticsOperation } = await import('../utils/analytics-logger');
  
  try {
    const readyAt = new Date();
    
    // Update group_analytics with leader ready timestamp
    await logAnalyticsOperation(
      'leader_ready_analytics',
      'group_analytics',
      () => databricksService.upsert('group_analytics', 
        { group_id: groupId },
        {
          leader_ready_at: readyAt,
          calculation_timestamp: readyAt,
        }
      ),
      {
        sessionId,
        recordCount: 1,
        metadata: {
          groupId,
          leaderId,
          readyTimestamp: readyAt.toISOString(),
          operation: 'upsert'
        },
        sampleRate: 0.5, // Sample 50% of leader ready events
      }
    );

    // NEW: Enhanced session events logging using analytics query router
    try {
      // Get teacher ID for proper event attribution
      const session = await databricksService.queryOne(
        `SELECT teacher_id FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ?`,
        [sessionId]
      );
      
      const { analyticsQueryRouterService } = await import('./analytics-query-router.service');
      await analyticsQueryRouterService.logSessionEvent(
        sessionId,
        session?.teacher_id || 'system',
        'leader_ready',
        {
          groupId,
          leaderId,
          timestamp: readyAt.toISOString(),
          source: 'websocket_service'
        }
      );
    } catch (error) {
      console.error('Failed to log leader ready event via analytics router:', error);
    }
  } catch (error) {
    console.error('Failed to record leader ready analytics:', error);
    // Don't throw - analytics failure shouldn't block readiness update
  }
}

// Export a proxy object that can be used before initialization
export const websocketService = {
  get io() {
    return wsService?.getIO() || null;
  },
  createSessionRoom(sessionId: string) {
    if (!wsService) return;
    wsService.getIO().socketsJoin(`session:${sessionId}`);
  },
  emitToSession(sessionId: string, event: string, data: any) {
    if (!wsService) return;
    wsService.getIO().to(`session:${sessionId}`).emit(event as any, data);
  },
  on(event: string, callback: (...args: any[]) => void) {
    if (!wsService) return;
    wsService.getIO().on(event as any, callback);
  },
  emit(event: string, data: any) {
    if (!wsService) return;
    wsService.getIO().emit(event as any, data);
  },
  notifySessionUpdate(sessionId: string, payload: any) {
    if (!wsService) return;
    this.emitToSession(sessionId, 'session:status_changed', payload);
  },
  endSession(sessionId: string) {
    if (!wsService) return;
    this.emitToSession(sessionId, 'session:status_changed', { sessionId, status: 'ended' });
  }
};