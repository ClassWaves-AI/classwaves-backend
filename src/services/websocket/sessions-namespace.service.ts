import { Socket } from 'socket.io';
import { NamespaceBaseService, NamespaceSocketData } from './namespace-base.service';
import { databricksService } from '../databricks.service';

interface SessionSocketData extends NamespaceSocketData {
  sessionId?: string;
  joinedRooms: Set<string>;
}

interface SessionJoinData {
  session_id?: string;
  sessionId?: string;
}

interface SessionStatusData {
  session_id?: string;
  sessionId?: string;
  status: 'active' | 'paused' | 'ended';
  teacher_notes?: string;
}

export class SessionsNamespaceService extends NamespaceBaseService {
  protected getNamespaceName(): string {
    return '/sessions';
  }

  protected onConnection(socket: Socket): void {
    const socketData = socket.data as SessionSocketData;
    socketData.joinedRooms = new Set();

    // Session management events
    socket.on('session:join', async (data: SessionJoinData) => {
      await this.handleSessionJoin(socket, data);
    });

    socket.on('session:leave', async (data: SessionJoinData) => {
      await this.handleSessionLeave(socket, data);
    });

    socket.on('session:update_status', async (data: SessionStatusData) => {
      await this.handleSessionStatusUpdate(socket, data);
    });

    // Group management events
    socket.on('group:join', async (data: { groupId: string; sessionId: string }) => {
      await this.handleGroupJoin(socket, data);
    });

    socket.on('group:leave', async (data: { groupId: string; sessionId: string }) => {
      await this.handleGroupLeave(socket, data);
    });

    socket.on('group:status_update', async (data: { 
      groupId: string; 
      sessionId: string; 
      status: string; 
      isReady?: boolean;
    }) => {
      await this.handleGroupStatusUpdate(socket, data);
    });

    // Audio streaming events
    socket.on('audio:start_stream', async (data: { groupId: string }) => {
      await this.handleAudioStreamStart(socket, data);
    });

    socket.on('audio:chunk', async (data: { groupId: string; audioData: Buffer; mimeType: string }) => {
      await this.handleAudioChunk(socket, data);
    });

    socket.on('audio:end_stream', async (data: { groupId: string }) => {
      await this.handleAudioStreamEnd(socket, data);
    });

    // Presence updates
    this.emitPresenceUpdate(socket.data.userId, 'connected');
  }

  protected onDisconnection(socket: Socket, reason: string): void {
    const socketData = socket.data as SessionSocketData;
    
    // Clean up joined rooms
    if (socketData.joinedRooms) {
      socketData.joinedRooms.forEach(room => {
        this.notifyRoomOfUserStatus(room, socket.data.userId, 'disconnected');
      });
    }
  }

  protected onUserFullyDisconnected(userId: string): void {
    // Update user presence to offline when all connections are closed
    this.emitPresenceUpdate(userId, 'disconnected');
  }

  protected onError(socket: Socket, error: Error): void {
    socket.emit('error', {
      code: 'SESSION_ERROR',
      message: 'An error occurred in session namespace',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }

  // Session Management Handlers
  private async handleSessionJoin(socket: Socket, data: SessionJoinData) {
    try {
      const sessionId = (data?.session_id || data?.sessionId || '').trim();
      if (!sessionId) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'session_id is required' });
        return;
      }

      // Verify session belongs to authenticated user
      const session = await databricksService.queryOne(
        `SELECT id, status, teacher_id FROM classwaves.sessions.classroom_sessions 
         WHERE id = ? AND teacher_id = ?`,
        [sessionId, socket.data.userId]
      );

      if (!session) {
        socket.emit('error', { 
          code: 'SESSION_NOT_FOUND', 
          message: 'Session not found or not owned by user' 
        });
        return;
      }

      const roomName = `session:${sessionId}`;
      await socket.join(roomName);
      
      // Track joined room
      const socketData = socket.data as SessionSocketData;
      socketData.sessionId = sessionId;
      socketData.joinedRooms.add(roomName);

      // Notify others in the session
      socket.to(roomName).emit('user:joined', {
        sessionId,
        userId: socket.data.userId,
        role: socket.data.role
      });

      // Send session status to user
      socket.emit('session:status_changed', { 
        sessionId, 
        status: session.status 
      });

      console.log(`Sessions namespace: User ${socket.data.userId} joined session ${sessionId}`);
    } catch (error) {
      console.error('Session join error:', error);
      socket.emit('error', { 
        code: 'SESSION_JOIN_FAILED', 
        message: 'Failed to join session' 
      });
    }
  }

  private async handleSessionLeave(socket: Socket, data: SessionJoinData) {
    try {
      const sessionId = (data?.session_id || data?.sessionId || '').trim();
      if (!sessionId) return;

      const roomName = `session:${sessionId}`;
      await socket.leave(roomName);

      // Update tracking
      const socketData = socket.data as SessionSocketData;
      socketData.joinedRooms.delete(roomName);
      if (socketData.sessionId === sessionId) {
        socketData.sessionId = undefined;
      }

      // Notify others
      socket.to(roomName).emit('user:left', {
        sessionId,
        userId: socket.data.userId
      });

      socket.emit('session:left', { sessionId });
    } catch (error) {
      console.error('Session leave error:', error);
      socket.emit('error', { 
        code: 'SESSION_LEAVE_FAILED', 
        message: 'Failed to leave session' 
      });
    }
  }

  private async handleSessionStatusUpdate(socket: Socket, data: SessionStatusData) {
    try {
      const sessionId = (data?.session_id || data?.sessionId || '').trim();
      if (!sessionId) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'session_id is required' });
        return;
      }

      // Verify ownership
      const session = await databricksService.queryOne(
        `SELECT id FROM classwaves.sessions.classroom_sessions 
         WHERE id = ? AND teacher_id = ?`,
        [sessionId, socket.data.userId]
      );

      if (!session) {
        socket.emit('error', { 
          code: 'SESSION_NOT_FOUND', 
          message: 'Session not found or not owned by user' 
        });
        return;
      }

      // Update session status in database
      await databricksService.update('classroom_sessions', sessionId, {
        status: data.status,
        teacher_notes: data.teacher_notes || null
      });

      // Broadcast to all users in the session
      this.emitToRoom(`session:${sessionId}`, 'session:status_changed', {
        sessionId,
        status: data.status,
        updatedBy: socket.data.userId
      });

      console.log(`Sessions namespace: Session ${sessionId} status updated to ${data.status}`);
    } catch (error) {
      console.error('Session status update error:', error);
      socket.emit('error', { 
        code: 'SESSION_UPDATE_FAILED', 
        message: 'Failed to update session status' 
      });
    }
  }

  // Group Management Handlers
  private async handleGroupJoin(socket: Socket, data: { groupId: string; sessionId: string }) {
    try {
      // Verify group exists and belongs to session
      const group = await databricksService.queryOne(
        `SELECT g.id, g.session_id, s.teacher_id 
         FROM classwaves.sessions.groups g
         JOIN classwaves.sessions.classroom_sessions s ON g.session_id = s.id
         WHERE g.id = ? AND g.session_id = ?`,
        [data.groupId, data.sessionId]
      );

      if (!group) {
        socket.emit('error', { 
          code: 'GROUP_NOT_FOUND', 
          message: 'Group not found in specified session' 
        });
        return;
      }

      const roomName = `group:${data.groupId}`;
      await socket.join(roomName);

      // Track room
      const socketData = socket.data as SessionSocketData;
      socketData.joinedRooms.add(roomName);

      // Notify group members
      socket.to(roomName).emit('group:user_joined', {
        groupId: data.groupId,
        sessionId: data.sessionId,
        userId: socket.data.userId,
        role: socket.data.role
      });

      socket.emit('group:joined', {
        groupId: data.groupId,
        sessionId: data.sessionId
      });

      console.log(`Sessions namespace: User ${socket.data.userId} joined group ${data.groupId}`);
    } catch (error) {
      console.error('Group join error:', error);
      socket.emit('error', { 
        code: 'GROUP_JOIN_FAILED', 
        message: 'Failed to join group' 
      });
    }
  }

  private async handleGroupLeave(socket: Socket, data: { groupId: string; sessionId: string }) {
    try {
      const roomName = `group:${data.groupId}`;
      await socket.leave(roomName);

      // Update tracking
      const socketData = socket.data as SessionSocketData;
      socketData.joinedRooms.delete(roomName);

      // Notify group members
      socket.to(roomName).emit('group:user_left', {
        groupId: data.groupId,
        sessionId: data.sessionId,
        userId: socket.data.userId
      });

      socket.emit('group:left', {
        groupId: data.groupId,
        sessionId: data.sessionId
      });
    } catch (error) {
      console.error('Group leave error:', error);
      socket.emit('error', { 
        code: 'GROUP_LEAVE_FAILED', 
        message: 'Failed to leave group' 
      });
    }
  }

  private async handleGroupStatusUpdate(socket: Socket, data: { 
    groupId: string; 
    sessionId: string; 
    status: string; 
    isReady?: boolean;
  }) {
    try {
      // Update group status in database
      await databricksService.update('groups', data.groupId, {
        status: data.status,
        is_ready: data.isReady !== undefined ? data.isReady : null
      });

      // Broadcast to session and group members
      this.emitToRoom(`session:${data.sessionId}`, 'group:status_changed', {
        groupId: data.groupId,
        sessionId: data.sessionId,
        status: data.status,
        isReady: data.isReady,
        updatedBy: socket.data.userId
      });

      this.emitToRoom(`group:${data.groupId}`, 'group:status_update', {
        groupId: data.groupId,
        status: data.status,
        isReady: data.isReady
      });

      console.log(`Sessions namespace: Group ${data.groupId} status updated to ${data.status}`);
    } catch (error) {
      console.error('Group status update error:', error);
      socket.emit('error', { 
        code: 'GROUP_UPDATE_FAILED', 
        message: 'Failed to update group status' 
      });
    }
  }

  // Audio Streaming Handlers
  private async handleAudioStreamStart(socket: Socket, data: { groupId: string }) {
    try {
      const roomName = `group:${data.groupId}`;
      
      // Notify group members that audio stream started
      this.emitToRoom(roomName, 'audio:stream_started', {
        groupId: data.groupId,
        userId: socket.data.userId
      });

      socket.emit('audio:stream_ready', { groupId: data.groupId });
    } catch (error) {
      console.error('Audio stream start error:', error);
      socket.emit('error', { 
        code: 'AUDIO_START_FAILED', 
        message: 'Failed to start audio stream' 
      });
    }
  }

  private async handleAudioChunk(socket: Socket, data: { 
    groupId: string; 
    audioData: Buffer; 
    mimeType: string;
  }) {
    try {
      // Forward audio data to AI processing service
      // This would integrate with your existing audio processing pipeline
      
      // For now, just notify group that audio is being processed
      this.emitToRoom(`group:${data.groupId}`, 'audio:processing', {
        groupId: data.groupId,
        userId: socket.data.userId,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Audio chunk processing error:', error);
      socket.emit('error', { 
        code: 'AUDIO_PROCESSING_FAILED', 
        message: 'Failed to process audio chunk' 
      });
    }
  }

  private async handleAudioStreamEnd(socket: Socket, data: { groupId: string }) {
    try {
      const roomName = `group:${data.groupId}`;
      
      // Notify group members that audio stream ended
      this.emitToRoom(roomName, 'audio:stream_ended', {
        groupId: data.groupId,
        userId: socket.data.userId,
        endTime: new Date()
      });

      socket.emit('audio:stream_stopped', { groupId: data.groupId });
    } catch (error) {
      console.error('Audio stream end error:', error);
      socket.emit('error', { 
        code: 'AUDIO_END_FAILED', 
        message: 'Failed to end audio stream' 
      });
    }
  }

  // Utility Methods
  private emitPresenceUpdate(userId: string, status: 'connected' | 'disconnected') {
    // Emit to all sessions this user is part of
    const userSockets = this.connectedUsers.get(userId);
    if (userSockets) {
      userSockets.forEach(socket => {
        const socketData = socket.data as SessionSocketData;
        if (socketData.joinedRooms) {
          socketData.joinedRooms.forEach(room => {
            if (room.startsWith('session:')) {
              this.notifyRoomOfUserStatus(room, userId, status);
            }
          });
        }
      });
    }
  }

  private notifyRoomOfUserStatus(room: string, userId: string, status: string) {
    this.namespace.to(room).emit('presence:updated', {
      userId,
      status,
      timestamp: new Date()
    });
  }

  // Public API for other services
  public emitToSession(sessionId: string, event: string, data: any): void {
    this.emitToRoom(`session:${sessionId}`, event, data);
  }

  public emitToGroup(groupId: string, event: string, data: any): void {
    this.emitToRoom(`group:${groupId}`, event, data);
  }

  public getSessionParticipants(sessionId: string): string[] {
    const room = this.namespace.adapter.rooms.get(`session:${sessionId}`);
    if (!room) return [];

    const participants: string[] = [];
    for (const socketId of room) {
      const socket = this.namespace.sockets.get(socketId);
      if (socket?.data.userId) {
        participants.push(socket.data.userId);
      }
    }
    return participants;
  }
}
