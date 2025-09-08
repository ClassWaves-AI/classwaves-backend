import { Socket, Namespace } from 'socket.io';
import { NamespaceBaseService, NamespaceSocketData } from './namespace-base.service';
import { databricksService } from '../databricks.service';
import { redisService } from '../redis.service';
import * as client from 'prom-client';
import { SessionJoinPayloadSchema, SessionStatusUpdateSchema, GroupJoinLeaveSchema, GroupLeaderReadySchema, WaveListenerIssueSchema, GroupStatusUpdateSchema, AudioChunkPayloadSchema, AudioStreamLifecycleSchema } from '@classwaves/shared';
import { DedupeWindow, computeGroupBroadcastHash } from './utils/dedupe.util';
import { RedisRateLimiter } from './utils/rate-limiter.util';
import { SessionSnapshotCache } from './utils/snapshot-cache.util';
import { cachePort } from '../../utils/cache.port.instance';

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
  // Modularized helpers
  private groupDedupe: DedupeWindow;
  private rateLimiter: RedisRateLimiter;
  private snapshotCache: SessionSnapshotCache<any>;
  // Group membership cache: key = sessionId:groupId
  private membershipCache: Map<string, { members: Set<string>; leaderId?: string; expires: number } > = new Map();
  // Observability: track session activation and first transcript
  private sessionActivatedAt: Map<string, number> = new Map();
  private sessionFirstTranscribed: Set<string> = new Set();

  // Observability metrics
  private static sttTTFHistogram = (() => {
    try {
      return new client.Histogram({
        name: 'stt_time_to_first_transcript_ms',
        help: 'Time from session activation to first transcript',
        buckets: [200, 500, 1000, 2000, 5000, 10000, 20000, 60000],
        labelNames: ['school']
      });
    } catch {
      return client.register.getSingleMetric('stt_time_to_first_transcript_ms') as client.Histogram<string>;
    }
  })();
  private static wsAudioBytesTotal = (() => {
    try {
      return new client.Counter({
        name: 'ws_audio_bytes_total',
        help: 'Total accepted WS audio bytes by school',
        labelNames: ['school']
      });
    } catch {
      return client.register.getSingleMetric('ws_audio_bytes_total') as client.Counter<string>;
    }
  })();

  // Audio backpressure per socket
  private audioCounters: Map<string, { windowStart: number; events: number; bytes: number }> = new Map();
  private readonly maxAudioEventsPerSec = parseInt(process.env.WS_MAX_AUDIO_EVENTS_PER_SEC || '20', 10);
  private readonly maxAudioBytesPerSec = parseInt(process.env.WS_MAX_AUDIO_BYTES_PER_SEC || String(1024 * 1024), 10); // 1MB
  // Soft backpressure hinting
  private dropStreak: Map<string, { count: number; lastHintAt: number }> = new Map();
  private readonly hintThreshold = parseInt(process.env.WS_BACKPRESSURE_HINT_THRESHOLD || '3', 10);
  private readonly hintCooldownMs = parseInt(process.env.WS_BACKPRESSURE_HINT_COOLDOWN_MS || '5000', 10);

  // Prometheus metrics (lazy inits)
  private static wsEventCounter = new client.Counter({ name: 'ws_events_total', help: 'Total WS events processed', labelNames: ['namespace', 'event', 'status'] });
  private static wsEventLatency = new client.Histogram({ name: 'ws_event_latency_ms', help: 'WS handler latency (ms)', buckets: [5,10,25,50,100,250,500,1000], labelNames: ['namespace', 'event'] });
  private static wsErrorCounter = (() => {
    try {
      return new client.Counter({
        name: 'ws_events_errors_total',
        help: 'Total WebSocket errors emitted (by namespace/event/school)',
        labelNames: ['namespace', 'event', 'school']
      });
    } catch {
      return client.register.getSingleMetric('ws_events_errors_total') as client.Counter<string>;
    }
  })();
  private static backpressureHintsTotal = (() => {
    try {
      return new client.Counter({
        name: 'ws_backpressure_hints_total',
        help: 'Soft backpressure hints emitted to clients',
        labelNames: ['school']
      });
    } catch {
      return client.register.getSingleMetric('ws_backpressure_hints_total') as client.Counter<string>;
    }
  })();
  private static aiTriggersSuppressedTotal = (() => {
    try {
      return new client.Counter({
        name: 'ai_triggers_suppressed_total',
        help: 'AI triggers suppressed due to session ending',
        labelNames: ['school']
      });
    } catch {
      return client.register.getSingleMetric('ai_triggers_suppressed_total') as client.Counter<string>;
    }
  })();
  // Track per-group transcript tails to merge overlapping windows
  private lastTranscriptTailTokens: Map<string, string[]> = new Map();
  private lastTranscriptText: Map<string, string> = new Map();

  // Merge helper: compute tokens from text (lowercased alnum words, keep positions for slicing)
  private tokenizeWithPositions(text: string): Array<{ token: string; start: number; end: number }> {
    const out: Array<{ token: string; start: number; end: number }> = [];
    const re = /[A-Za-z0-9]+(?:'[A-Za-z0-9]+)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      out.push({ token: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  // Collapse immediate repeated words and duplicate consecutive clauses
  private normalizeTranscript(text: string): string {
    try {
      let t = String(text || '');
      t = t.replace(/\u2026/g, '…').replace(/\.{3,}/g, '…');
      t = t.replace(/\s+/g, ' ').trim();
      // Collapse immediate repeated words (case-insensitive)
      t = t.replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1');
      // Collapse immediate duplicate clauses
      const parts = t.split(/(?<=[\.!?…])\s+/);
      const out: string[] = [];
      for (const p of parts) {
        const norm = p.trim();
        if (!norm) continue;
        if (out.length === 0 || out[out.length - 1].trim().toLowerCase() !== norm.toLowerCase()) {
          out.push(norm);
        }
      }
      return out.join(' ');
    } catch {
      return text;
    }
  }

  // Merge overlapping window output against the previous tail for this group
  private mergeOverlappingTranscript(groupId: string, newText: string, tailSizeTokens: number = 30): string {
    const prevTail = this.lastTranscriptTailTokens.get(groupId) || [];
    const tokensWithPos = this.tokenizeWithPositions(newText);
    const newTokens = tokensWithPos.map(t => t.token);
    // Find maximum m where last m prev tokens == first m new tokens
    let overlap = 0;
    const maxCheck = Math.min(prevTail.length, newTokens.length, tailSizeTokens);
    for (let m = maxCheck; m > 0; m--) {
      let match = true;
      for (let i = 0; i < m; i++) {
        if (prevTail[prevTail.length - m + i] !== newTokens[i]) { match = false; break; }
      }
      if (match) { overlap = m; break; }
    }
    // Compute slice start in original text using positions of overlapped tokens
    let sliced = newText;
    if (overlap > 0) {
      // Cut starting at the next token after the overlapped region to also skip punctuation (e.g., ". ")
      const cutIdx = tokensWithPos[overlap]?.start ?? tokensWithPos[overlap - 1]?.end ?? 0;
      sliced = newText.slice(cutIdx).trimStart();
    }
    // Normalize inside the new slice to drop obvious repeats (stutter, duplicate clauses)
    const cleaned = this.normalizeTranscript(sliced);
    // Update tail tokens for next time
    const cleanedTokens = this.tokenizeWithPositions(cleaned).map(t => t.token);
    const combined = [...prevTail, ...cleanedTokens];
    const nextTail = combined.slice(Math.max(0, combined.length - tailSizeTokens));
    this.lastTranscriptTailTokens.set(groupId, nextTail);
    return cleaned;
  }
  protected getNamespaceName(): string {
    return '/sessions';
  }

  constructor(namespace: Namespace) {
    super(namespace);
    this.groupDedupe = new DedupeWindow(25);
    this.rateLimiter = new RedisRateLimiter(redisService.getClient());
    this.snapshotCache = new SessionSnapshotCache<any>({
      cache: cachePort,
      counter: cachePort as any,
      ttlSeconds: parseInt(process.env.WS_SNAPSHOT_TTL || '5', 10),
      build: (sid) => this.buildSessionSnapshot(sid),
    });
  }

  protected onConnection(socket: Socket): void {
    const socketData = socket.data as SessionSocketData;
    socketData.joinedRooms = new Set();

    // Session management events
    socket.on('session:join', async (data: SessionJoinData, ack?: (resp: any) => void) => {
      await this.handleSessionJoin(socket, data, ack);
    });

    socket.on('session:leave', async (data: SessionJoinData) => {
      await this.handleSessionLeave(socket, data);
    });

    socket.on('session:update_status', async (data: SessionStatusData) => {
      // REST-first enforcement: disallow status updates via WebSocket
      try {
        const parsed = SessionStatusUpdateSchema.safeParse({
          sessionId: (data?.session_id || data?.sessionId || '').trim(),
          status: data?.status,
          teacher_notes: (data as any)?.teacher_notes,
        });
        if (!parsed.success) {
          socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid session status update payload' });
          SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'session:update_status', school: (socket.data as any)?.schoolId || 'unknown' });
          return;
        }
        // Notify client that this operation is not allowed via WS
        socket.emit('error', {
          code: 'UNSUPPORTED_OPERATION',
          message: 'Session status changes must use REST API. WebSocket is notify-only.'
        });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'session:update_status', school: (socket.data as any)?.schoolId || 'unknown' });
      } catch {
        socket.emit('error', { code: 'SESSION_UPDATE_FORBIDDEN', message: 'Use REST endpoint to change session status' });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'session:update_status', school: (socket.data as any)?.schoolId || 'unknown' });
      }
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

    // Student-specific session join handler (namespaced)
    socket.on('student:session:join', async (data: { sessionId: string }, ack?: (resp: any) => void) => {
      await this.handleStudentSessionJoin(socket, data, ack);
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
    // Canonical event name support
    socket.on('audio:stream:start', async (data: { groupId: string }) => {
      await this.handleAudioStreamStart(socket, data);
    });

    socket.on('audio:chunk', async (data: { groupId: string; audioData: Buffer; mimeType: string }) => {
      await this.handleAudioChunk(socket, data);
    });

    socket.on('audio:end_stream', async (data: { groupId: string }) => {
      await this.handleAudioStreamEnd(socket, data);
    });
    // Canonical event name support
    socket.on('audio:stream:end', async (data: { groupId: string }) => {
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
  private async handleSessionJoin(socket: Socket, data: SessionJoinData, ack?: (resp: any) => void) {
    const stopTimer = SessionsNamespaceService.wsEventLatency.startTimer({ namespace: this.getNamespaceName(), event: 'session:join' });
    try {
      // Simple per-socket rate limit (5 joins per 10s)
      if (!(await this.rateLimiter.allow(`ws:rate:session:join:${socket.id}`, 5, 10))) {
        socket.emit('error', { code: 'RATE_LIMIT', message: 'Too many join attempts, please wait' });
        if (ack) ack({ ok: false, error: 'RATE_LIMIT' });
        return;
      }
      // Validate payload
      const parsed = SessionJoinPayloadSchema.safeParse({ sessionId: (data?.session_id || data?.sessionId || '').trim() });
      if (!parsed.success) {
        SessionsNamespaceService.wsEventCounter.inc({ namespace: this.getNamespaceName(), event: 'session:join', status: 'invalid' });
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'session_id is required' });
        if (ack) ack({ ok: false, error: 'INVALID_PAYLOAD' });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'session:join', school: (socket.data as any)?.schoolId || 'unknown' });
        return;
      }
      const sessionId = parsed.data.sessionId;
      if (!sessionId) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'session_id is required' });
        if (ack) ack({ ok: false, error: 'INVALID_PAYLOAD' });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'session:join', school: (socket.data as any)?.schoolId || 'unknown' });
        return;
      }

      // Verify session exists and user has access (teachers own sessions, super_admin can access any session)
      let session: any = null;
      try {
        const { getCompositionRoot } = await import('../../app/composition-root');
        const repo = getCompositionRoot().getSessionRepository();
        session = socket.data.role === 'super_admin'
          ? await repo.getBasic(sessionId)
          : await repo.getOwnedSessionBasic(sessionId, socket.data.userId);
      } catch {}
      if (!session) {
        if (socket.data.role === 'super_admin') {
          session = await databricksService.queryOne(
            `SELECT id, status, teacher_id, school_id FROM classwaves.sessions.classroom_sessions 
             WHERE id = ?`,
            [sessionId]
          );
        } else {
          session = await databricksService.queryOne(
            `SELECT id, status, teacher_id, school_id FROM classwaves.sessions.classroom_sessions 
             WHERE id = ? AND teacher_id = ?`,
            [sessionId, socket.data.userId]
          );
        }
      }

      if (!session) {
        socket.emit('error', { 
          code: 'SESSION_NOT_FOUND', 
          message: socket.data.role === 'super_admin' ? 'Session not found' : 'Session not found or not owned by user'
        });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'session:join', school: (socket.data as any)?.schoolId || 'unknown' });
        return;
      }

      const roomName = `session:${sessionId}`;
      await socket.join(roomName);
      // Cross-cluster presence counter (best-effort)
      try { await redisService.getClient().incr(`ws:sessionParticipantsCount:${sessionId}`); } catch {}
      
      // Track joined room
      const socketData = socket.data as SessionSocketData;
      socketData.sessionId = sessionId;
      // Store schoolId on socket for metrics/backpressure labeling
      (socket.data as any).schoolId = (session as any)?.school_id || (socket.data as any)?.schoolId || 'unknown';
      socketData.joinedRooms.add(roomName);

      // Notify others in the session
      socket.to(roomName).emit('user:joined', {
        sessionId,
        userId: socket.data.userId,
        role: socket.data.role,
        traceId: (socket.data as any)?.traceId || undefined,
      });

      // Send session status to user
      socket.emit('session:status_changed', { 
        sessionId, 
        status: session.status,
        traceId: (socket.data as any)?.traceId || undefined,
      });

      // Inline snapshot via ack for race-free hydration
      try {
        const snapshot = await this.snapshotCache.get(sessionId);
        if (ack) {
          ack({ ok: true, snapshot });
        } else {
          socket.emit('session:state', { ...snapshot, traceId: (socket.data as any)?.traceId || undefined });
        }
      } catch (e) {
        if (process.env.API_DEBUG === '1') {
          console.warn('Failed to emit session snapshot (non-blocking):', e instanceof Error ? e.message : String(e));
        }
        if (ack) ack({ ok: true });
      }

      if (process.env.API_DEBUG === '1') {
        console.log(`Sessions namespace: User ${socket.data.userId} joined session ${sessionId}`);
      }
      SessionsNamespaceService.wsEventCounter.inc({ namespace: this.getNamespaceName(), event: 'session:join', status: 'ok' });
    } catch (error) {
      console.error('Session join error:', error);
      socket.emit('error', { 
        code: 'SESSION_JOIN_FAILED', 
        message: 'Failed to join session' 
      });
      if (ack) ack({ ok: false, error: 'SESSION_JOIN_FAILED' });
      SessionsNamespaceService.wsEventCounter.inc({ namespace: this.getNamespaceName(), event: 'session:join', status: 'error' });
      SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'session:join', school: (socket.data as any)?.schoolId || 'unknown' });
    } finally {
      stopTimer();
    }
  }

  private async handleStudentSessionJoin(socket: Socket, data: { sessionId: string }, ack?: (resp: any) => void) {
    const stopTimer = SessionsNamespaceService.wsEventLatency.startTimer({ namespace: this.getNamespaceName(), event: 'student:session:join' });
    try {
      const parsed = SessionJoinPayloadSchema.safeParse({ sessionId: (data?.sessionId || '').trim() });
      if (!parsed.success) {
        SessionsNamespaceService.wsEventCounter.inc({ namespace: this.getNamespaceName(), event: 'student:session:join', status: 'invalid' });
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'sessionId is required' });
        if (ack) ack({ ok: false, error: 'INVALID_PAYLOAD' });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'student:session:join', school: (socket.data as any)?.schoolId || 'unknown' });
        return;
      }
      const sessionId = parsed.data.sessionId;
      if (!sessionId) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'sessionId is required' });
        if (ack) ack({ ok: false, error: 'INVALID_PAYLOAD' });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'student:session:join', school: (socket.data as any)?.schoolId || 'unknown' });
        return;
      }

      // Join session room early so teacher sees presence even if DB is slow
      const sessionRoom = `session:${sessionId}`;
      const sData = socket.data as SessionSocketData;
      if (!sData.joinedRooms) sData.joinedRooms = new Set();
      await Promise.resolve((socket as any).join?.(sessionRoom));
      sData.joinedRooms.add(sessionRoom);
      sData.sessionId = sessionId;

      // Verify student is a participant in this session
      // Use dynamic import to ensure Jest spies intercept this call reliably
      const db = await import('../databricks.service');
      const participant = await (db as any).databricksService.queryOne(
        `SELECT p.id, p.session_id, p.student_id, p.group_id, sg.name as group_name
         FROM classwaves.sessions.participants p 
         LEFT JOIN classwaves.sessions.student_groups sg ON p.group_id = sg.id
         WHERE p.session_id = ?
         ORDER BY p.join_time DESC
         LIMIT 1`,
        [sessionId]
      );

      if (!participant) {
        socket.emit('error', { 
          code: 'SESSION_ACCESS_DENIED', 
          message: 'Student not enrolled in this session' 
        });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'student:session:join', school: (socket.data as any)?.schoolId || 'unknown' });
        return;
      }

      // Already joined above

      // Also join group room if assigned
      if (participant.group_id) {
        const groupRoom = `group:${participant.group_id}`;
        await socket.join(groupRoom);
        sData.joinedRooms.add(groupRoom);

        // Emit presence at session level so teacher Live Groups updates
        this.emitToRoom(sessionRoom, 'group:joined', {
          groupId: participant.group_id,
          sessionId
        });

        // Notify group members about the user presence for consistency
        this.emitToRoom(groupRoom, 'group:user_joined', {
          groupId: participant.group_id,
          sessionId,
          userId: socket.data.userId,
          role: socket.data.role
        });
      }

      const joinedPayload = { sessionId, groupId: participant.group_id, groupName: participant.group_name };
      socket.emit('student:session:joined', joinedPayload);

      // Notify presence to session room
      this.notifyRoomOfUserStatus(sessionRoom, socket.data.userId, 'connected');

      // Inline snapshot for student via ack if available
      try {
        const snapshot = await this.snapshotCache.get(sessionId);
        if (ack) {
          ack({ ok: true, snapshot, joined: joinedPayload });
        } else {
          socket.emit('session:state', snapshot);
        }
      } catch (e) {
        if (process.env.API_DEBUG === '1') {
          console.warn('Failed to emit session snapshot for student (non-blocking):', e instanceof Error ? e.message : String(e));
        }
        if (ack) ack({ ok: true, joined: joinedPayload });
      }

      if (process.env.API_DEBUG === '1') {
        console.log(`Sessions namespace: Student ${socket.data.userId} joined session ${sessionId}${participant.group_id ? ` and group ${participant.group_id}` : ''}`);
      }
      SessionsNamespaceService.wsEventCounter.inc({ namespace: this.getNamespaceName(), event: 'student:session:join', status: 'ok' });
    } catch (error) {
      console.error('Student session join error (namespaced):', error);
      socket.emit('error', { 
        code: 'STUDENT_SESSION_JOIN_FAILED', 
        message: 'Failed to join session as student' 
      });
      if (ack) ack({ ok: false, error: 'STUDENT_SESSION_JOIN_FAILED' });
      SessionsNamespaceService.wsEventCounter.inc({ namespace: this.getNamespaceName(), event: 'student:session:join', status: 'error' });
      SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'student:session:join', school: (socket.data as any)?.schoolId || 'unknown' });
    } finally {
      stopTimer();
    }
  }

  private async handleSessionLeave(socket: Socket, data: SessionJoinData) {
    try {
      const parsed = SessionJoinPayloadSchema.safeParse({ sessionId: (data?.session_id || data?.sessionId || '').trim() });
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'sessionId is required' });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'session:leave', school: (socket.data as any)?.schoolId || 'unknown' });
        return;
      }
      const sessionId = parsed.data.sessionId;

      const roomName = `session:${sessionId}`;
      await socket.leave(roomName);
      try { await redisService.getClient().decr(`ws:sessionParticipantsCount:${sessionId}`); } catch {}

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

  private async handleSessionStatusUpdate(_socket: Socket, _data: SessionStatusData) {
    // Deprecated: retained for backward-compat wiring but enforced above.
    return;
  }

  // Group Management Handlers
  private async handleGroupJoin(socket: Socket, data: { groupId: string; sessionId: string }) {
    try {
      // Validate payload
      const parsed = GroupJoinLeaveSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid group join payload' });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'group:join', school: (socket.data as any)?.schoolId || 'unknown' });
        return;
      }

      // Verify group exists and belongs to session
      const group = await databricksService.queryOne(
        `SELECT g.id, g.session_id, s.teacher_id 
         FROM classwaves.sessions.groups g
         JOIN classwaves.sessions.classroom_sessions s ON g.session_id = s.id
         WHERE g.id = ? AND g.session_id = ?`,
        [parsed.data.groupId, parsed.data.sessionId]
      );

      if (!group) {
        socket.emit('error', { 
          code: 'GROUP_NOT_FOUND', 
          message: 'Group not found in specified session' 
        });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'group:join', school: (socket.data as any)?.schoolId || 'unknown' });
        return;
      }

      const roomName = `group:${parsed.data.groupId}`;
      await socket.join(roomName);

      // Track room
      const socketData = socket.data as SessionSocketData;
      socketData.joinedRooms.add(roomName);

      // Notify group members
      socket.to(roomName).emit('group:user_joined', {
        groupId: parsed.data.groupId,
        sessionId: parsed.data.sessionId,
        userId: socket.data.userId,
        role: socket.data.role,
        traceId: (socket.data as any)?.traceId || undefined,
      });

      socket.emit('group:joined', {
        groupId: parsed.data.groupId,
        sessionId: parsed.data.sessionId,
        traceId: (socket.data as any)?.traceId || undefined,
      });

      console.log(`Sessions namespace: User ${socket.data.userId} joined group ${parsed.data.groupId}`);
    } catch (error) {
      console.error('Group join error:', error);
      socket.emit('error', { 
        code: 'GROUP_JOIN_FAILED', 
        message: 'Failed to join group' 
      });
      SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'group:join', school: (socket.data as any)?.schoolId || 'unknown' });
    }
  }

  private async handleGroupLeave(socket: Socket, data: { groupId: string; sessionId: string }) {
    try {
      // Validate payload
      const parsed = GroupJoinLeaveSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid group leave payload' });
        SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'group:leave', school: (socket.data as any)?.schoolId || 'unknown' });
        return;
      }

      const roomName = `group:${parsed.data.groupId}`;
      await socket.leave(roomName);

      // Update tracking
      const socketData = socket.data as SessionSocketData;
      socketData.joinedRooms.delete(roomName);

      // Notify group members
      socket.to(roomName).emit('group:user_left', {
        groupId: parsed.data.groupId,
        sessionId: parsed.data.sessionId,
        userId: socket.data.userId,
        traceId: (socket.data as any)?.traceId || undefined,
      });

      socket.emit('group:left', {
        groupId: parsed.data.groupId,
        sessionId: parsed.data.sessionId,
        traceId: (socket.data as any)?.traceId || undefined,
      });
      // Reset transcript merge state for this group
      try {
        this.lastTranscriptTailTokens.delete(parsed.data.groupId);
        this.lastTranscriptText.delete(parsed.data.groupId);
      } catch {}
    } catch (error) {
      console.error('Group leave error:', error);
      socket.emit('error', { 
        code: 'GROUP_LEAVE_FAILED', 
        message: 'Failed to leave group' 
      });
      SessionsNamespaceService.wsErrorCounter.inc({ namespace: this.getNamespaceName(), event: 'group:leave', school: (socket.data as any)?.schoolId || 'unknown' });
    }
  }

  private async handleGroupStatusUpdate(socket: Socket, data: GroupStatusData) {
    try {
      // Rate limit group status updates (20 per 10s)
      if (!(await this.rateLimiter.allow(`ws:rate:group:status_update:${socket.id}`, 20, 10))) {
        socket.emit('error', { code: 'RATE_LIMIT', message: 'Too many status updates' });
        return;
      }
      // Validate payload shape
      const parsed = GroupStatusUpdateSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid group status update payload' });
        return;
      }
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
      const sessionBroadcastSuccess = this.emitToRoom(`session:${data.sessionId}`, 'group:status_changed', { ...broadcastPayload, traceId: (socket.data as any)?.traceId || undefined });
      
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

      // Dedupe rapid duplicate broadcasts
      this.groupDedupe.isDuplicate(`${broadcastPayload.sessionId}:${broadcastPayload.groupId}`, computeGroupBroadcastHash(broadcastPayload));

      if (process.env.API_DEBUG === '1') {
        console.log(`Sessions namespace: Group ${group.name} status updated to ${data.status}${data.issueReason ? ` (reason: ${data.issueReason})` : ''}`);
      }

      // Invalidate cached snapshot and bump version
      await this.snapshotCache.invalidate(data.sessionId);
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
      // Validate payload
      const parsed = GroupLeaderReadySchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid leader_ready payload' });
        return;
      }
      const { sessionId, groupId, ready } = parsed.data;

      // Generate idempotency key for this operation
      const idempotencyKey = `${sessionId}-${groupId}-${ready ? 'ready' : 'not-ready'}`;
      
      // Validate that group exists and belongs to session, and get current readiness state
      const group = await databricksService.queryOne(`
        SELECT leader_id, session_id, name, is_ready
        FROM classwaves.sessions.student_groups 
        WHERE id = ? AND session_id = ?
      `, [groupId, sessionId]);
      
      if (!group) {
        socket.emit('error', {
          code: 'GROUP_NOT_FOUND',
          message: 'Group not found',
        });
        return;
      }

      // Idempotency check: if state hasn't changed, skip database update and broadcast
      if (group.is_ready === ready) {
        console.log(`Sessions namespace: Group ${group.name} readiness state unchanged (${ready ? 'ready' : 'not ready'}) - idempotent skip`);
        
        // Still emit confirmation to requesting client for UX consistency
        socket.emit('group:leader_ready_confirmed', {
          groupId,
          sessionId,
          isReady: ready,
          idempotencyKey
        });
        return;
      }

      // State has changed - proceed with update
      await databricksService.update('student_groups', groupId, {
        is_ready: ready,
        updated_at: new Date()
      });
      
      // Broadcast group status change to all session participants (including teacher dashboard)
      const payload = { groupId, sessionId, status: ready ? 'ready' : 'waiting', isReady: ready, idempotencyKey, updatedBy: socket.data.userId, timestamp: new Date().toISOString() };
      const broadcastSuccess = this.emitToRoom(`session:${sessionId}`, 'group:status_changed', { ...payload, traceId: (socket.data as any)?.traceId || undefined });

      // Log broadcast failure for monitoring
      if (!broadcastSuccess) {
        console.error(`Failed to broadcast group readiness change for session ${data.sessionId}, group ${data.groupId}`);
      }
      
      // Emit confirmation to requesting client
      socket.emit('group:leader_ready_confirmed', {
        groupId,
        sessionId,
        isReady: ready,
        idempotencyKey
      });
      
      this.groupDedupe.isDuplicate(`${payload.sessionId}:${payload.groupId}`, computeGroupBroadcastHash(payload));

      if (process.env.API_DEBUG === '1') {
        console.log(`Sessions namespace: Group ${group.name} leader marked ${ready ? 'ready' : 'not ready'} in session ${sessionId} [${idempotencyKey}]`);
      }

      // Invalidate cached snapshot and bump version
      await this.snapshotCache.invalidate(sessionId);
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
      // Validate payload
      const parsed = WaveListenerIssueSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'Invalid WaveListener issue payload' });
        return;
      }
      const { sessionId, groupId, reason } = parsed.data;

      // Verify group exists and belongs to session
      const group = await databricksService.queryOne(`
        SELECT id, session_id, name 
        FROM classwaves.sessions.student_groups 
        WHERE id = ? AND session_id = ?
      `, [groupId, sessionId]);
      
      if (!group) {
        socket.emit('error', {
          code: 'GROUP_NOT_FOUND',
          message: 'Group not found in specified session'
        });
        return;
      }

      // Update group to issue status with reason
      await databricksService.update('student_groups', groupId, {
        status: 'issue',
        is_ready: false,
        issue_reason: reason,
        issue_reported_at: new Date(),
        updated_at: new Date()
      });

      // Broadcast issue status to all session participants
      const sessionIssueBroadcast = this.emitToRoom(`session:${sessionId}`, 'group:status_changed', {
        groupId,
        sessionId,
        status: 'issue',
        isReady: false,
        issueReason: reason,
        reportedBy: socket.data.userId,
        timestamp: new Date().toISOString(),
        traceId: (socket.data as any)?.traceId || undefined,
      });

      // Notify group members about the issue
      const groupIssueBroadcast = this.emitToRoom(`group:${groupId}`, 'wavelistener:issue_reported', {
        groupId,
        reason,
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

      if (process.env.API_DEBUG === '1') {
        console.log(`Sessions namespace: WaveListener issue reported for group ${group.name}: ${data.reason}`);
      }

      // Invalidate cached snapshot and bump version
      await this.snapshotCache.invalidate(data.sessionId);
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
      // Validate payload using shared schema
      const parsed = AudioStreamLifecycleSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'groupId is required' });
        return;
      }

      const roomName = `group:${data.groupId}`;
      
      // Notify group members that audio stream started
      this.emitToRoom(roomName, 'audio:stream_started', {
        groupId: data.groupId,
        userId: socket.data.userId
      });

      socket.emit('audio:stream_ready', { groupId: data.groupId });
      // Reset transcript merge state on fresh stream start
      try {
        this.lastTranscriptTailTokens.delete(data.groupId);
        this.lastTranscriptText.delete(data.groupId);
      } catch {}

      // Emit canonical session-level event for teacher dashboards and clients
      const sData = socket.data as SessionSocketData;
      if (sData?.sessionId) {
        this.emitToRoom(`session:${sData.sessionId}`, 'audio:stream:start', {
          groupId: data.groupId
        });
      }
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
      // Default enabled; allow opt-out only with WS_UNIFIED_STT=0
      if (process.env.WS_UNIFIED_STT === '0') {
        return;
      }

      const startTs = Date.now();

      // Validate payload shape at the edge (no Zod in domain)
      try {
        AudioChunkPayloadSchema.parse({ groupId: data?.groupId, audioData: (data as any)?.audioData, mimeType: (data as any)?.mimeType });
      } catch (e) {
        this.emitToRoom(`group:${data?.groupId || 'unknown'}`, 'audio:error', { groupId: data?.groupId, error: 'INVALID_PAYLOAD' });
        return;
      }

      // Gate ingestion on session status (reliability)
      const sData = socket.data as SessionSocketData;
      const sessionId = sData?.sessionId;
      if (!sessionId) {
        this.emitToRoom(`group:${data.groupId}`, 'audio:error', { groupId: data.groupId, error: 'SESSION_NOT_JOINED' });
        return;
      }
      try {
        const snapshot = await this.snapshotCache.get(sessionId);
        const status = (snapshot as any)?.status || 'created';
        if (status !== 'active') {
          const errorCode = status === 'paused' ? 'SESSION_PAUSED' : 'SESSION_NOT_ACTIVE';
          this.emitToRoom(`group:${data.groupId}`, 'audio:error', { groupId: data.groupId, error: errorCode, status });
          return;
        }
        // Additional lifecycle gate: if controller marked session ending in Redis, reject late audio
        try {
          const ending = await redisService.get(`ws:session:ending:${sessionId}`);
          if (ending) {
            this.emitToRoom(`group:${data.groupId}`, 'audio:error', { groupId: data.groupId, error: 'SESSION_ENDING', status: 'ending' });
            // Observability: count AI suppression due to ending gate
            try { SessionsNamespaceService.aiTriggersSuppressedTotal.inc({ school: (socket.data as any)?.schoolId || 'unknown' }); } catch {}
            return;
          }
        } catch {}
      } catch {
        // If snapshot retrieval fails, be conservative and reject to avoid waste
        this.emitToRoom(`group:${data.groupId}`, 'audio:error', { groupId: data.groupId, error: 'SESSION_STATUS_UNKNOWN' });
        return;
      }

      // Enforce group membership before accepting audio
      const auth = await this.verifyGroupAudioAuthorization(socket, data.groupId);
      if (!auth.authorized) {
        if (process.env.API_DEBUG === '1') console.warn(JSON.stringify({ event: 'audio_not_authorized', groupId: data.groupId, userId: (socket.data as any)?.userId }));
        try { (SessionsNamespaceService as any).wsAuthFailCounter?.inc?.({ namespace: this.getNamespaceName(), school: (socket.data as any)?.schoolId || 'unknown' }); } catch {}
        this.emitToRoom(`group:${data.groupId}`, 'audio:error', { groupId: data.groupId, error: 'NOT_AUTHORIZED' });
        return;
      }

      // Backpressure and size guard
      const maxChunkBytes = parseInt(process.env.WS_MAX_AUDIO_CHUNK_BYTES || String(2 * 1024 * 1024), 10); // 2MB default
      const size = Buffer.isBuffer((data as any).audioData) ? (data as any).audioData.length : 0;
      if (size > maxChunkBytes) {
        // Emit error to group (standardized code)
        this.emitToRoom(`group:${data.groupId}`, 'audio:error', { groupId: data.groupId, error: 'PAYLOAD_TOO_LARGE', bytes: size, limit: maxChunkBytes });
        return;
      }

      // Backpressure: token bucket per socket
      if (process.env.WS_AUDIO_BACKPRESSURE !== '0') {
        const sid = socket.id;
        const now = Date.now();
        const ctr = this.audioCounters.get(sid) || { windowStart: now, events: 0, bytes: 0 };
        if (now - ctr.windowStart >= 1000) {
          ctr.windowStart = now; ctr.events = 0; ctr.bytes = 0;
        }
        ctr.events += 1; ctr.bytes += size; this.audioCounters.set(sid, ctr);
        if (ctr.events > this.maxAudioEventsPerSec || ctr.bytes > this.maxAudioBytesPerSec) {
          // Notify group with unified backpressure event; drop excess
          this.emitToRoom(`group:${data.groupId}`, 'audio:error', { groupId: data.groupId, error: 'BACKPRESSURE', eventsPerSec: ctr.events, bytesPerSec: ctr.bytes, limitEvents: this.maxAudioEventsPerSec, limitBytes: this.maxAudioBytesPerSec });
          this.recordDropAndMaybeHint(socket, data.groupId);
          return;
        }
      }

      // Helpers: coerce to Buffer and validate mimeType (mirror legacy logic)
      const coerceToBuffer = (payload: any): Buffer => {
        if (Buffer.isBuffer(payload)) return payload;
        if (payload?.type === 'Buffer' && Array.isArray(payload.data)) return Buffer.from(payload.data);
        if (payload instanceof ArrayBuffer) return Buffer.from(new Uint8Array(payload));
        if (ArrayBuffer.isView(payload)) return Buffer.from(payload as Uint8Array);
        throw new Error('Unsupported audio payload format');
      };
      const validateMimeType = (mimeType: string): string => {
        const supported = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/wav'];
        const normalized = (mimeType || '').toLowerCase();
        if (!supported.some((s) => normalized.startsWith(s))) {
          throw new Error(`Unsupported audio format: ${mimeType}`);
        }
        return supported.find(s => normalized.startsWith(s)) || normalized;
      };

      const audioBuffer = coerceToBuffer((data as any).audioData);
      const resolvedMime = validateMimeType(((data as any).mimeType || (data as any).format) as string);

      // Backpressure checks before ingest
      const approxBytes = audioBuffer.length;
      if (approxBytes > 2 * 1024 * 1024) { // 2MB hard cap per chunk
        console.warn(JSON.stringify({ event: 'audio_drop_chunk_oversize', groupId: data.groupId, approx_chunk_bytes: approxBytes }));
        // Zero sensitive buffer contents immediately
        try { audioBuffer.fill(0); } catch {}
        try { (SessionsNamespaceService as any).wsAudioDropCounter?.inc?.({ namespace: this.getNamespaceName(), reason: 'PAYLOAD_TOO_LARGE', school: (socket.data as any)?.schoolId || 'unknown' }); } catch {}
        this.emitToRoom(`group:${data.groupId}`, 'audio:error', { groupId: data.groupId, error: 'PAYLOAD_TOO_LARGE', bytes: approxBytes, limit: 2 * 1024 * 1024 });
        return;
      }

      // Multi-level quotas: per-school and per-session bytes/sec
      try {
        const second = Math.floor(Date.now() / 1000);
        const schoolId = (socket.data as any)?.schoolId || 'unknown';
        const sessionIdForQuota = (socket.data as any)?.sessionId;
        if (sessionIdForQuota) {
          const schoolKey = `ws:quota:audio:bytes:school:${schoolId}:${second}`;
          const sessionKey = `ws:quota:audio:bytes:session:${sessionIdForQuota}:${second}`;
          const client = redisService.getClient();

          const [totalSchool, totalSession] = await Promise.all([
            client.incrby(schoolKey, approxBytes).then(async (v: number) => { try { await client.expire(schoolKey, 2); } catch {} return v; }),
            client.incrby(sessionKey, approxBytes).then(async (v: number) => { try { await client.expire(sessionKey, 2); } catch {} return v; }),
          ]);

          const SCHOOL_BYTES_PER_SEC = parseInt(process.env.WS_SCHOOL_AUDIO_LIMIT || String(5 * 1024 * 1024), 10);
          const SESSION_BYTES_PER_SEC = parseInt(process.env.WS_SESSION_AUDIO_LIMIT || String(2 * 1024 * 1024), 10);

          if (totalSchool > SCHOOL_BYTES_PER_SEC) {
            console.warn(JSON.stringify({ event: 'audio_block_school_quota', groupId: data.groupId, schoolId, totalSchool, limit: SCHOOL_BYTES_PER_SEC }));
            this.emitToRoom(`group:${data.groupId}`, 'audio:error', { 
              groupId: data.groupId,
              error: 'SCHOOL_QUOTA_EXCEEDED',
              schoolLimit: SCHOOL_BYTES_PER_SEC,
              currentRate: totalSchool
            });
            return;
          }

          if (totalSession > SESSION_BYTES_PER_SEC) {
            console.warn(JSON.stringify({ event: 'audio_block_session_quota', groupId: data.groupId, sessionId: sessionIdForQuota, totalSession, limit: SESSION_BYTES_PER_SEC }));
            this.emitToRoom(`group:${data.groupId}`, 'audio:error', { 
              groupId: data.groupId,
              error: 'SESSION_QUOTA_EXCEEDED',
              sessionLimit: SESSION_BYTES_PER_SEC,
              currentRate: totalSession
            });
            return;
          }
        }
      } catch (e) {
        // Quota check is best-effort; continue on Redis failure
        if (process.env.API_DEBUG === '1') {
          console.warn('quota_check_failed', e instanceof Error ? e.message : String(e));
        }
      }

      // Observability: count accepted bytes post-guards
      try {
        const schoolId = (socket.data as any)?.schoolId || 'unknown';
        SessionsNamespaceService.wsAudioBytesTotal.inc({ school: schoolId }, approxBytes);
      } catch {}

      const { inMemoryAudioProcessor } = await import('../audio/InMemoryAudioProcessor');
      const windowInfo = inMemoryAudioProcessor.getGroupWindowInfo(data.groupId);
      if (windowInfo.bytes > 5 * 1024 * 1024 || windowInfo.chunks > 50) {
        console.warn(JSON.stringify({
          event: 'audio_drop_backpressure',
          groupId: data.groupId,
          window_bytes: windowInfo.bytes,
          window_chunks: windowInfo.chunks,
        }));
        try { audioBuffer.fill(0); } catch {}
        try { (SessionsNamespaceService as any).wsAudioDropCounter?.inc?.({ namespace: this.getNamespaceName(), reason: 'BACKPRESSURE', school: (socket.data as any)?.schoolId || 'unknown' }); } catch {}
        this.emitToRoom(`group:${data.groupId}`, 'audio:error', { groupId: data.groupId, error: 'BACKPRESSURE', windowBytes: windowInfo.bytes, windowChunks: windowInfo.chunks });
        this.recordDropAndMaybeHint(socket, data.groupId);
        return;
      }

      // Ingest to zero-disk processor
      const result = await inMemoryAudioProcessor.ingestGroupAudioChunk(
        data.groupId,
        audioBuffer,
        resolvedMime,
        (socket.data as any).sessionId,
        (socket.data as any).schoolId
      );

      // Structured accept log
      console.log(JSON.stringify({ event: 'audio_chunk_accepted', groupId: data.groupId, approx_chunk_bytes: approxBytes, window_seconds: windowInfo.windowSeconds }));

      if (result && result.text && String(result.text).trim().length > 0) {
        // Merge overlapping content across windows to avoid repeated clauses
        const mergedText = this.mergeOverlappingTranscript(data.groupId, result.text);
        if (!mergedText || mergedText.trim().length === 0) {
          // Entirely overlapped content; skip emission
          return;
        }
        // Skip if identical to the last emitted text for this group (case-insensitive)
        const lastText = this.lastTranscriptText.get(data.groupId);
        if (lastText && lastText.trim().toLowerCase() === mergedText.trim().toLowerCase()) {
          return;
        }
        // Reset soft backpressure streak on success
        this.dropStreak.delete(`${socket.id}:${data.groupId}`);
        const sessionId = (socket.data as any).sessionId;
        const groupName = `Group ${data.groupId}`;

        // Idempotent transcript persistence: compute deterministic id
        const { createHash } = await import('crypto');
        const dedupeBase = `${sessionId}|${data.groupId}|${result.timestamp}|${mergedText}`;
        const id = createHash('sha1').update(dedupeBase).digest('hex');

        // Emit to session room so teacher UI receives it (attach traceId if available)
        this.emitToRoom(`session:${sessionId}`, 'transcription:group:new', {
          id,
          groupId: data.groupId,
          groupName,
          text: mergedText,
          timestamp: result.timestamp,
          confidence: result.confidence,
          language: result.language,
          traceId: (socket.data as any)?.traceId || undefined,
        });
        // Remember last emitted text for duplicate suppression
        this.lastTranscriptText.set(data.groupId, mergedText);

        // Persist transcription row (idempotent)
        try {
          const { databricksService } = await import('../databricks.service');
          const existing = await databricksService.queryOne(
            `SELECT id FROM classwaves.sessions.transcriptions WHERE id = ? LIMIT 1`,
            [id]
          );
          if (!existing) {
            const start = new Date(result.timestamp);
            const durSec = (result.duration ?? 0) as number;
            const end = Number.isFinite(durSec) && durSec > 0 ? new Date(start.getTime() + Math.floor(durSec * 1000)) : start;
            await databricksService.insert('sessions.transcriptions', {
              id,
              session_id: sessionId,
              group_id: data.groupId,
              speaker_id: String(data.groupId),
              speaker_type: 'group',
              speaker_name: groupName,
              content: result.text,
              language_code: result.language || 'en',
              start_time: start,
              end_time: end,
              duration_seconds: durSec || 0,
              confidence_score: result.confidence ?? 0,
              is_final: true,
              created_at: new Date(),
            });
          }
        } catch (e) {
          console.warn('⚠️ Failed to persist transcription (non-blocking):', e instanceof Error ? e.message : String(e));
        }

        // Buffer for AI and trigger heuristics
        try {
          // Suppress AI triggers if session is ending
          let isEnding = false;
          try { isEnding = !!(await redisService.get(`ws:session:ending:${sessionId}`)); } catch {}
          if (!isEnding) {
            const { aiAnalysisBufferService } = await import('../ai-analysis-buffer.service');
            await aiAnalysisBufferService.bufferTranscription(data.groupId, sessionId, result.text);
            const { aiAnalysisTriggerService } = await import('../ai-analysis-trigger.service');
            await aiAnalysisTriggerService.checkAndTriggerAIAnalysis(data.groupId, sessionId, (socket.data as any).userId);
          } else if (process.env.API_DEBUG === '1') {
            console.log(JSON.stringify({ event: 'ai_suppressed_ending', sessionId }));
            try { SessionsNamespaceService.aiTriggersSuppressedTotal.inc({ school: (socket.data as any)?.schoolId || 'unknown' }); } catch {}
          }
        } catch (e) {
          console.warn('⚠️ AI buffer/trigger failed (non-blocking):', e instanceof Error ? e.message : String(e));
        }

        // Observability: record TTF for first transcript since activation
        try {
          const sid = sessionId;
          if (!this.sessionFirstTranscribed.has(sid)) {
            this.sessionFirstTranscribed.add(sid);
            const activatedAt = this.sessionActivatedAt.get(sid);
            if (activatedAt) {
              const schoolId = (socket.data as any)?.schoolId || 'unknown';
              SessionsNamespaceService.sttTTFHistogram.observe({ school: schoolId }, Date.now() - activatedAt);
            }
          }
        } catch {}

        console.log(`✅ STT window submitted for group ${data.groupId}: "${(result.text || '').substring(0, 50)}..."`);
      } else if (result) {
        // Gate downstream when transcript text is empty (breaker open or STT off)
        if (process.env.API_DEBUG === '1') {
          console.log(JSON.stringify({ event: 'stt_suppressed_empty_text', groupId: data.groupId }));
        }
      }
    } catch (error) {
      console.error('Audio chunk processing error:', error);
      socket.emit('error', {
        code: 'AUDIO_PROCESSING_FAILED',
        message: 'Failed to process audio chunk',
      });
    }
  }

  // Increment drop streak and emit hint if threshold reached with cooldown
  private recordDropAndMaybeHint(socket: Socket, groupId: string): void {
    const key = `${socket.id}:${groupId}`;
    const now = Date.now();
    const prev = this.dropStreak.get(key) || { count: 0, lastHintAt: 0 };
    prev.count += 1;
    const canHint = prev.count >= this.hintThreshold && (now - prev.lastHintAt) >= this.hintCooldownMs;
    if (canHint) {
      this.emitToRoom(`group:${groupId}`, 'audio:error', { groupId, error: 'BACKPRESSURE_HINT', threshold: this.hintThreshold });
      try { SessionsNamespaceService.backpressureHintsTotal.inc({ school: (socket.data as any)?.schoolId || 'unknown' }); } catch {}
      prev.lastHintAt = now;
      prev.count = 0; // reset after hint
    }
    this.dropStreak.set(key, prev);
  }

  // Verify that the socket user is authorized to stream audio for the group
  private async verifyGroupAudioAuthorization(socket: Socket, groupId: string): Promise<{ authorized: boolean; reason?: string }> {
    try {
      const sData = socket.data as SessionSocketData;
      const sessionId = sData?.sessionId;
      const userId = (socket.data as any)?.userId as string | undefined;
      const role = (socket.data as any)?.role as string | undefined;

      if (!sessionId || !userId) {
        return { authorized: false, reason: 'MISSING_CREDENTIALS' };
      }

      // Allow non-student roles to bypass member checks (teachers/admin tooling)
      if (role && role !== 'student') {
        return { authorized: true };
      }

      const cacheKey = `session:${sessionId}:group:${groupId}`;
      const cached = this.membershipCache.get(cacheKey);
      const now = Date.now();
      if (cached && cached.expires > now) {
        return { authorized: cached.members.has(userId) };
      }

      // Query group membership and leader for this session/group
      const rows = await databricksService.query<any>(
        `SELECT sg.leader_id, sgm.student_id \n` +
        `FROM classwaves.sessions.student_groups sg \n` +
        `LEFT JOIN classwaves.sessions.student_group_members sgm ON sg.id = sgm.group_id \n` +
        `WHERE sg.id = ? AND sg.session_id = ?`,
        [groupId, sessionId]
      );

      if (!rows || rows.length === 0) {
        return { authorized: false, reason: 'GROUP_NOT_FOUND' };
      }

      const members = new Set<string>();
      let leaderId: string | undefined = undefined;
      for (const r of rows) {
        if (r.student_id) members.add(String(r.student_id));
        if (r.leader_id) leaderId = String(r.leader_id);
      }
      if (leaderId) members.add(leaderId);

      // Warm cache for 5 minutes
      this.membershipCache.set(cacheKey, { members, leaderId, expires: now + 5 * 60 * 1000 });

      return { authorized: members.has(userId) };
    } catch (e) {
      // On DB errors, fail closed to avoid unauthorized streaming
      if (process.env.API_DEBUG === '1') {
        console.warn('verifyGroupAudioAuthorization error:', e instanceof Error ? e.message : String(e));
      }
      return { authorized: false, reason: 'AUTHORIZATION_CHECK_FAILED' };
    }
  }

  private async handleAudioStreamEnd(socket: Socket, data: { groupId: string }) {
    try {
      // Validate payload using shared schema
      const parsed = AudioStreamLifecycleSchema.safeParse(data);
      if (!parsed.success) {
        socket.emit('error', { code: 'INVALID_PAYLOAD', message: 'groupId is required' });
        return;
      }

      const roomName = `group:${data.groupId}`;
      
      // Notify group members that audio stream ended
      this.emitToRoom(roomName, 'audio:stream_ended', {
        groupId: data.groupId,
        userId: socket.data.userId,
        endTime: new Date()
      });

      socket.emit('audio:stream_stopped', { groupId: data.groupId });

      // Emit canonical session-level event for teacher dashboards and clients
      const sData = socket.data as SessionSocketData;
      if (sData?.sessionId) {
        this.emitToRoom(`session:${sData.sessionId}`, 'audio:stream:end', {
          groupId: data.groupId
        });
      }
      // Reset transcript merge state when stream ends
      try {
        this.lastTranscriptTailTokens.delete(data.groupId);
        this.lastTranscriptText.delete(data.groupId);
      } catch {}
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

  // Public utility: reset transcript merge state for a set of groups (e.g., on session end)
  public resetTranscriptMergeStateForGroups(groupIds: string[]): void {
    for (const gid of groupIds) {
      try {
        this.lastTranscriptTailTokens.delete(gid);
        this.lastTranscriptText.delete(gid);
      } catch {}
    }
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

  // Build a lightweight snapshot for immediate UI sync on join
  private async buildSessionSnapshot(sessionId: string) {
    // Fetch minimal session settings and status
    const session = await databricksService.queryOne(
      `SELECT id, status, recording_enabled, transcription_enabled
       FROM classwaves.sessions.classroom_sessions
       WHERE id = ?`,
      [sessionId]
    );

    // Fetch groups readiness
    const groups = await databricksService.query(
      `SELECT id, name, is_ready
       FROM classwaves.sessions.student_groups
       WHERE session_id = ?
       ORDER BY group_number`,
      [sessionId]
    );

    const groupsDetailed = groups.map((g: any) => ({ id: g.id, name: g.name, isReady: Boolean(g.is_ready) }));
    const groupsReady = groupsDetailed.filter((g: any) => g.isReady).length;

    // Compute live participant count from room membership (server-local)
    const room = this.namespace.adapter.rooms.get(`session:${sessionId}`);
    const participants = room ? room.size : 0;

    // Read state version (monotonic)
    let stateVersion = 0;
    try {
      const v = await redisService.get(`ws:stateVersion:${sessionId}`);
      stateVersion = v ? parseInt(v, 10) : 0;
    } catch {}

    return {
      sessionId,
      status: session?.status || 'created',
      settings: {
        enable_audio_recording: Boolean(session?.recording_enabled),
        enable_live_transcription: Boolean(session?.transcription_enabled),
      },
      groupsDetailed,
      counters: {
        groupsTotal: groupsDetailed.length,
        groupsReady,
        participants,
      },
      stateVersion,
      timestamp: new Date().toISOString(),
    };
  }

  
}
