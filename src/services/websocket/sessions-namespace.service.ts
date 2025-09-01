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

interface GroupStatusData {
  groupId: string;
  sessionId: string;
  status: 'connected' | 'ready' | 'active' | 'paused' | 'issue';
  isReady?: boolean;
  issueReason?: string;
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

    socket.on('group:status_update', async (data: GroupStatusData) => {
      await this.handleGroupStatusUpdate(socket, data);
    });

    // Group leader ready signal
    socket.on('group:leader_ready', async (data: { sessionId: string; groupId: string; ready: boolean }) => {
      await this.handleGroupLeaderReady(socket, data);
    });

    // WaveListener issue reporting
    socket.on('wavelistener:issue', async (data: { sessionId: string; groupId: string; reason: 'permission_revoked' | 'stream_failed' | 'device_error' }) => {
      await this.handleWaveListenerIssue(socket, data);
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

      // Verify session exists and user has access (teachers own sessions, super_admin can access any session)
      let session;
      if (socket.data.role === 'super_admin') {
        // Super admin can join any session
        session = await databricksService.queryOne(
          `SELECT id, status, teacher_id, school_id FROM classwaves.sessions.classroom_sessions 
           WHERE id = ?`,
          [sessionId]
        );
      } else {
        // Regular users (teachers/admin) must own the session  
        session = await databricksService.queryOne(
          `SELECT id, status, teacher_id, school_id FROM classwaves.sessions.classroom_sessions 
           WHERE id = ? AND teacher_id = ?`,
          [sessionId, socket.data.userId]
        );
      }

      if (!session) {
        socket.emit('error', { 
          code: 'SESSION_NOT_FOUND', 
          message: socket.data.role === 'super_admin' ? 'Session not found' : 'Session not found or not owned by user'
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

      // Verify ownership or super_admin access
      let session;
      if (socket.data.role === 'super_admin') {
        // Super admin can update any session
        session = await databricksService.queryOne(
          `SELECT id FROM classwaves.sessions.classroom_sessions 
           WHERE id = ?`,
          [sessionId]
        );
      } else {
        // Regular users must own the session
        session = await databricksService.queryOne(
          `SELECT id FROM classwaves.sessions.classroom_sessions 
           WHERE id = ? AND teacher_id = ?`,
          [sessionId, socket.data.userId]
        );
      }

      if (!session) {
        socket.emit('error', { 
          code: 'SESSION_NOT_FOUND', 
          message: socket.data.role === 'super_admin' ? 'Session not found' : 'Session not found or not owned by user'
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

  private async handleGroupStatusUpdate(socket: Socket, data: GroupStatusData) {
    try {
      // Validate status value
      const validStatuses = ['connected', 'ready', 'active', 'paused', 'issue'];
      if (!validStatuses.includes(data.status)) {
        socket.emit('error', {
          code: 'INVALID_STATUS',
          message: `Invalid status '${data.status}'. Must be one of: ${validStatuses.join(', ')}`
        });
        return;
      }

      // Verify group exists and belongs to session
      const group = await databricksService.queryOne(`
        SELECT id, session_id, name, status as current_status
        FROM classwaves.sessions.student_groups 
        WHERE id = ? AND session_id = ?
      `, [data.groupId, data.sessionId]);
      
      if (!group) {
        socket.emit('error', {
          code: 'GROUP_NOT_FOUND',
          message: 'Group not found in specified session'
        });
        return;
      }

      // Prepare database update with enhanced issue tracking
      const updateData: any = {
        status: data.status,
        updated_at: new Date()
      };

      // Handle readiness state for specific statuses
      if (data.status === 'ready') {
        updateData.is_ready = true;
      } else if (data.status === 'issue') {
        updateData.is_ready = false;
        // Store issue reason if provided
        if (data.issueReason) {
          updateData.issue_reason = data.issueReason;
          updateData.issue_reported_at = new Date();
        }
      } else if (data.isReady !== undefined) {
        updateData.is_ready = data.isReady;
      }

      // Update group status in database
      await databricksService.update('student_groups', data.groupId, updateData);

      // Prepare broadcast payload with enhanced issue information
      const broadcastPayload = {
        groupId: data.groupId,
        sessionId: data.sessionId,
        status: data.status,
        isReady: updateData.is_ready,
        updatedBy: socket.data.userId,
        timestamp: new Date().toISOString(),
        ...(data.status === 'issue' && data.issueReason && { issueReason: data.issueReason })
      };

      // Broadcast to session participants (including teacher dashboard)
      const sessionBroadcastSuccess = this.emitToRoom(`session:${data.sessionId}`, 'group:status_changed', broadcastPayload);
      
      // Broadcast to group members with additional context
      const groupBroadcastSuccess = this.emitToRoom(`group:${data.groupId}`, 'group:status_update', {
        groupId: data.groupId,
        status: data.status,
        isReady: updateData.is_ready,
        ...(data.status === 'issue' && data.issueReason && { issueReason: data.issueReason })
      });

      // Log broadcast failures for monitoring
      if (!sessionBroadcastSuccess || !groupBroadcastSuccess) {
        console.error(`Broadcast failures for group status update:`, {
          sessionBroadcast: sessionBroadcastSuccess,
          groupBroadcast: groupBroadcastSuccess,
          sessionId: data.sessionId,
          groupId: data.groupId,
          status: data.status
        });
      }

      console.log(`Sessions namespace: Group ${group.name} status updated to ${data.status}${data.issueReason ? ` (reason: ${data.issueReason})` : ''}`);
    } catch (error) {
      console.error('Group status update error:', error);
      socket.emit('error', { 
        code: 'GROUP_UPDATE_FAILED', 
        message: 'Failed to update group status' 
      });
    }
  }

  private async handleGroupLeaderReady(socket: Socket, data: { sessionId: string; groupId: string; ready: boolean }) {
    try {
      // Generate idempotency key for this operation
      const idempotencyKey = `${data.sessionId}-${data.groupId}-${data.ready ? 'ready' : 'not-ready'}`;
      
      // Validate that group exists and belongs to session, and get current readiness state
      const group = await databricksService.queryOne(`
        SELECT leader_id, session_id, name, is_ready
        FROM classwaves.sessions.student_groups 
        WHERE id = ? AND session_id = ?
      `, [data.groupId, data.sessionId]);
      
      if (!group) {
        socket.emit('error', {
          code: 'GROUP_NOT_FOUND',
          message: 'Group not found',
        });
        return;
      }

      // Idempotency check: if state hasn't changed, skip database update and broadcast
      if (group.is_ready === data.ready) {
        console.log(`Sessions namespace: Group ${group.name} readiness state unchanged (${data.ready ? 'ready' : 'not ready'}) - idempotent skip`);
        
        // Still emit confirmation to requesting client for UX consistency
        socket.emit('group:leader_ready_confirmed', {
          groupId: data.groupId,
          sessionId: data.sessionId,
          isReady: data.ready,
          idempotencyKey
        });
        return;
      }

      // State has changed - proceed with update
      await databricksService.update('student_groups', data.groupId, {
        is_ready: data.ready,
        updated_at: new Date()
      });
      
      // Broadcast group status change to all session participants (including teacher dashboard)
      const broadcastSuccess = this.emitToRoom(`session:${data.sessionId}`, 'group:status_changed', {
        groupId: data.groupId,
        status: data.ready ? 'ready' : 'connected',
        isReady: data.ready,
        idempotencyKey
      });

      // Log broadcast failure for monitoring
      if (!broadcastSuccess) {
        console.error(`Failed to broadcast group readiness change for session ${data.sessionId}, group ${data.groupId}`);
      }
      
      // Emit confirmation to requesting client
      socket.emit('group:leader_ready_confirmed', {
        groupId: data.groupId,
        sessionId: data.sessionId,
        isReady: data.ready,
        idempotencyKey
      });
      
      console.log(`Sessions namespace: Group ${group.name} leader marked ${data.ready ? 'ready' : 'not ready'} in session ${data.sessionId} [${idempotencyKey}]`);
    } catch (error) {
      console.error('Sessions namespace: Group leader ready error:', error);
      socket.emit('error', {
        code: 'LEADER_READY_FAILED',
        message: 'Failed to update leader readiness',
      });
    }
  }

  private async handleWaveListenerIssue(socket: Socket, data: { sessionId: string; groupId: string; reason: 'permission_revoked' | 'stream_failed' | 'device_error' }) {
    try {
      // Verify group exists and belongs to session
      const group = await databricksService.queryOne(`
        SELECT id, session_id, name 
        FROM classwaves.sessions.student_groups 
        WHERE id = ? AND session_id = ?
      `, [data.groupId, data.sessionId]);
      
      if (!group) {
        socket.emit('error', {
          code: 'GROUP_NOT_FOUND',
          message: 'Group not found in specified session'
        });
        return;
      }

      // Update group to issue status with reason
      await databricksService.update('student_groups', data.groupId, {
        status: 'issue',
        is_ready: false,
        issue_reason: data.reason,
        issue_reported_at: new Date(),
        updated_at: new Date()
      });

      // Broadcast issue status to all session participants
      const sessionIssueBroadcast = this.emitToRoom(`session:${data.sessionId}`, 'group:status_changed', {
        groupId: data.groupId,
        sessionId: data.sessionId,
        status: 'issue',
        isReady: false,
        issueReason: data.reason,
        reportedBy: socket.data.userId,
        timestamp: new Date().toISOString()
      });

      // Notify group members about the issue
      const groupIssueBroadcast = this.emitToRoom(`group:${data.groupId}`, 'wavelistener:issue_reported', {
        groupId: data.groupId,
        reason: data.reason,
        reportedBy: socket.data.userId,
        timestamp: new Date().toISOString()
      });

      // Critical issue broadcasts must succeed - log failures for immediate attention
      if (!sessionIssueBroadcast || !groupIssueBroadcast) {
        console.error(`CRITICAL: Failed to broadcast WaveListener issue for group ${group.name}:`, {
          sessionBroadcast: sessionIssueBroadcast,
          groupBroadcast: groupIssueBroadcast,
          reason: data.reason,
          timestamp: new Date().toISOString()
        });
      }

      // Send confirmation back to reporting client
      socket.emit('wavelistener:issue_acknowledged', {
        groupId: data.groupId,
        sessionId: data.sessionId,
        reason: data.reason
      });

      console.log(`Sessions namespace: WaveListener issue reported for group ${group.name}: ${data.reason}`);
    } catch (error) {
      console.error('WaveListener issue handling error:', error);
      socket.emit('error', {
        code: 'WAVELISTENER_ISSUE_FAILED',
        message: 'Failed to report WaveListener issue'
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
