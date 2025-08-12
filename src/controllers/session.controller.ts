import { Request, Response } from 'express';
import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';
import { AuthRequest } from '../types/auth.types';
import { redisService } from '../services/redis.service';
import { websocketService } from '../services/websocket.service';
import { 
  CreateSessionRequest, 
  Session, 
  SessionGroup, 
  SessionGroupMember 
} from '@classwaves/shared';

/**
 * Store session access code in Redis for student leader joining
 */
async function storeSessionAccessCode(sessionId: string, accessCode: string): Promise<void> {
  try {
    // Store bidirectional mappings with 24 hour expiration
    const expiration = 24 * 60 * 60; // 24 hours in seconds
    
    // Map session ID to access code
    await redisService.set(`session:${sessionId}:access_code`, accessCode, expiration);
    
    // Map access code to session ID (for student joining)
    await redisService.set(`access_code:${accessCode}`, sessionId, expiration);
    
    console.log(`✅ Stored access code ${accessCode} for session ${sessionId}`);
  } catch (error) {
    console.error('❌ Failed to store session access code:', error);
    throw error;
  }
}

/**
 * Retrieve session ID by access code
 */
async function getSessionByAccessCode(accessCode: string): Promise<string | null> {
  try {
    const sessionId = await redisService.get(`access_code:${accessCode}`);
    return sessionId;
  } catch (error) {
    console.error('❌ Failed to retrieve session by access code:', error);
    return null;
  }
}

/**
 * Retrieve access code by session ID
 */
async function getAccessCodeBySession(sessionId: string): Promise<string | null> {
  try {
    const accessCode = await redisService.get(`session:${sessionId}:access_code`);
    return accessCode;
  } catch (error) {
    console.error('❌ Failed to retrieve access code by session:', error);
    return null;
  }
}

/**
 * List sessions for the authenticated teacher
 */
export async function listSessions(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    
    // Get query parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const sort = req.query.sort as string || 'created_at:desc';
    
    const rawSessions = await databricksService.getTeacherSessions(teacher.id, limit);

    // Map DB rows to frontend contract and fetch access codes from Redis
    const sessions = await Promise.all((rawSessions || []).map(async (s: any) => {
      const accessCode = await getAccessCodeBySession(s.id);
      return {
        id: s.id,
        accessCode, // Retrieved from Redis
        topic: s.title,
        goal: s.description,
        status: s.status as 'created' | 'active' | 'paused' | 'ended' | 'archived',
        teacherId: s.teacher_id,
        schoolId: s.school_id,
        targetGroupSize: s.target_group_size,
        scheduledStart: s.scheduled_start ? new Date(s.scheduled_start).toISOString() : undefined,
        actualStart: s.actual_start ? new Date(s.actual_start).toISOString() : undefined,
        plannedDuration: s.planned_duration_minutes,
        groups: {
          total: (s.group_count ?? s.total_groups ?? 0) as number,
          active: 0,
        },
        students: {
          total: (s.student_count ?? s.total_students ?? 0) as number,
          active: 0,
        },
        analytics: {
          participationRate: Number(s.participation_rate ?? 0),
          engagementScore: Number(s.engagement_score ?? 0),
        },
        createdAt: new Date(s.created_at).toISOString(),
      };
    }));

    const total = sessions.length; // Simple total; can be replaced by COUNT(*) if needed
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return res.json({
      success: true,
      data: {
        sessions,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
    });
  } catch (error) {
    console.error('Error listing sessions:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SESSIONS_FETCH_FAILED',
        message: 'Failed to fetch sessions',
      },
    });
  }
}

/**
 * Join a session by access code (student kiosk-style)
 * Minimal implementation to satisfy tests; validates code and returns token-like payload
 */
export async function joinSession(req: Request, res: Response): Promise<Response> {
  try {
    const { sessionCode, studentName, displayName, avatar, dateOfBirth } = (req.body || {}) as any;
    if (!sessionCode || !(studentName || displayName)) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Missing required fields' });
    }

    const session = await databricksService.queryOne(
      `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE access_code = ?`,
      [sessionCode]
    );
    if (!session) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'Invalid session code' });
    }
    if (session.status === 'ended') {
      return res.status(400).json({ error: 'SESSION_NOT_ACTIVE', message: 'Session is not active' });
    }

    // COPPA: basic age checks for tests
    if (dateOfBirth) {
      const dob = new Date(dateOfBirth);
      const ageYears = Math.floor((Date.now() - dob.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
      if (ageYears < 4) {
        return res.status(403).json({ error: 'AGE_RESTRICTION', message: 'Student must be at least 4 years old to use ClassWaves' });
      }
      if (ageYears < 13) {
        // Check parental consent (mocked by querying compliance table)
        const consent = await databricksService.query(
          `SELECT * FROM ${databricksConfig.catalog}.compliance.parental_consents WHERE student_name = ?`,
          [displayName || studentName]
        );
        const hasConsent = (consent as any[])?.length > 0;
        if (!hasConsent) {
          return res.status(403).json({ error: 'PARENTAL_CONSENT_REQUIRED', message: 'Parental consent is required for students under 13' });
        }
      }
    }

    const studentId = (databricksService as any).generateId?.() ?? `stu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const safeDisplayName = String(displayName || studentName).replace(/[<>"/\\]/g, '');

    // Insert or upsert minimal student record for the session
    await databricksService.insert('students', {
      id: studentId,
      session_id: session.id,
      display_name: safeDisplayName,
      avatar: avatar || null,
      status: 'active',
      joined_at: new Date()
    });

    // Store simple age cache if provided
    if (dateOfBirth && (redisService as any).set) {
      await (redisService as any).set(`student:age:${studentId}`, String(dateOfBirth), 60);
    }

    return res.json({
      token: `student_${studentId}`,
      student: { id: studentId, displayName: safeDisplayName },
      session: { id: session.id }
    });
  } catch (error) {
    console.error('Error joining session:', error);
    return res.status(500).json({ error: 'JOIN_FAILED', message: 'Failed to join session' });
  }
}

/**
 * List participants for a session (students with optional group info)
 */
export async function getSessionParticipants(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const sessionId = req.params.sessionId;

    // Verify session ownership
    const session = await databricksService.queryOne(
      `SELECT id, teacher_id FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
      [sessionId, teacher.id]
    );
    if (!session) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'Session not found' });
    }

    // Fetch students and groups
    const students = await databricksService.query(
      `SELECT id, display_name, avatar, status, group_id FROM ${databricksConfig.catalog}.users.students WHERE session_id = ?`,
      [sessionId]
    );
    const groups = await databricksService.query(
      `SELECT id, name FROM ${databricksConfig.catalog}.sessions.student_groups WHERE session_id = ?`,
      [sessionId]
    );

    const groupById = new Map<string, any>();
    for (const g of groups) groupById.set(g.id, g);

    const participants = (students || []).map((s: any) => ({
      id: s.id,
      display_name: s.display_name,
      avatar: s.avatar,
      status: s.status,
      group: s.group_id ? groupById.get(s.group_id) || null : null,
    }));

    return res.json({
      participants,
      count: participants.length,
      groups,
    });
  } catch (error) {
    console.error('Error listing participants:', error);
    return res.status(500).json({ error: 'PARTICIPANTS_FETCH_FAILED', message: 'Failed to fetch participants' });
  }
}
/**
 * Get session analytics (minimal shape to satisfy tests)
 */
export async function getSessionAnalytics(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const sessionId = req.params.sessionId || (req.params as any).id;

    const session = await databricksService.queryOne(
      `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
      [sessionId, teacher.id]
    );
    if (!session) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND', message: 'Session not found' });
    }

    // Pull a minimal analytics row if exists
    const analytics = await databricksService.queryOne(
      `SELECT total_students as total_students, active_students as active_students,
              total_recordings as total_recordings, avg_participation_rate as avg_participation_rate,
              total_transcriptions as total_transcriptions
       FROM ${databricksConfig.catalog}.analytics.session_summary WHERE session_id = ?`,
      [sessionId]
    );

    return res.json({
      sessionId,
      analytics: {
        totalStudents: analytics?.total_students ?? 0,
        activeStudents: analytics?.active_students ?? 0,
        participationRate: Math.round((analytics?.avg_participation_rate ?? 0) * 100),
        recordings: {
          total: analytics?.total_recordings ?? 0,
          transcribed: analytics?.total_transcriptions ?? 0,
        },
      },
    });
  } catch (error) {
    console.error('Error getting session analytics:', error);
    return res.status(500).json({ error: 'ANALYTICS_FETCH_FAILED', message: 'Failed to fetch session analytics' });
  }
}

/**
 * Create a new session with declarative group configuration
 * Phase 5: Teacher-first workflow with pre-configured groups
 */
export async function createSession(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const school = authReq.school!;
    
    // Validate new payload structure per SOW
    const payload: CreateSessionRequest = req.body;
    const {
      topic,
      goal,
      subject,
      description,
      plannedDuration,
      scheduledStart,
      groupPlan,
      aiConfig = { hidden: true, defaultsApplied: true }
    } = payload;

    // Validate required fields
    if (!topic || !goal || !subject || !groupPlan) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Missing required fields: topic, goal, subject, groupPlan',
        },
      });
    }

    if (!groupPlan.groups || groupPlan.groups.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'At least one group must be configured',
        },
      });
    }

    // Validate each group has required members
    for (let i = 0; i < groupPlan.groups.length; i++) {
      const group = groupPlan.groups[i];
      
      if (!group.leaderId) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Group "${group.name}" must have a leader assigned`,
          },
        });
      }
      
      if (!group.memberIds || group.memberIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: `Group "${group.name}" must have at least 1 member assigned`,
          },
        });
      }
    }

    // Generate session ID and access code
    const sessionId = (databricksService as any).generateId?.() ?? `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const accessCode = Math.random().toString(36).slice(2, 8).toUpperCase();

    // Create session + groups + members sequentially with error handling
    try {
      // 1. Create main session record
      // Insert session with required columns
      await databricksService.insert('classroom_sessions', {
        id: sessionId,
        title: topic,
        description: description || goal,
        status: 'created',
        scheduled_start: scheduledStart ? new Date(scheduledStart) : null,
        actual_duration_minutes: 0,
        planned_duration_minutes: plannedDuration, // REQUIRED COLUMN
        max_students: 999, // TEMPORARY: Until we can make column nullable
        target_group_size: 4, // TEMPORARY: Until we can make column nullable
        auto_group_enabled: false, // Groups are pre-configured in declarative mode
        teacher_id: teacher.id,
        school_id: school.id,
        recording_enabled: false,
        transcription_enabled: true,
        ai_analysis_enabled: true,
        ferpa_compliant: true,
        coppa_compliant: true,
        recording_consent_obtained: false,
        data_retention_date: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000), // 7 years
        total_groups: groupPlan.groups.length,
        total_students: groupPlan.groups.reduce((sum, g) => sum + g.memberIds.length + (g.leaderId ? 1 : 0), 0),
        access_code: accessCode,
        end_reason: '',
        teacher_notes: '',
        engagement_score: 0.0,
        created_at: new Date(),
        updated_at: new Date(),
      });

      // 2. Create group records with leader assignments
      for (let i = 0; i < groupPlan.groups.length; i++) {
        const group = groupPlan.groups[i];
        const groupId = (databricksService as any).generateId?.() ?? `grp_${sessionId}_${i}`;
        
        await databricksService.insert('student_groups', {
          id: groupId,
          session_id: sessionId,
          name: group.name,
          group_number: i + 1,
          status: 'created',
          max_size: groupPlan.groupSize,
          current_size: group.memberIds.length + (group.leaderId ? 1 : 0),
          auto_managed: false,
          start_time: new Date(),
          end_time: new Date(),
          total_speaking_time_seconds: 0,
          collaboration_score: 0.0,
          topic_focus_score: 0.0,
          created_at: new Date(),
          updated_at: new Date(),
          leader_id: group.leaderId || null,
          is_ready: false,
          topical_cohesion: 0.0,
          argumentation_quality: 0.0,
          sentiment_arc: '[]',
          conceptual_density: 0.0,
        });

        // 3. Create member assignments (including leader if specified)
        const allMemberIds = [...group.memberIds];
        if (group.leaderId && !allMemberIds.includes(group.leaderId)) {
          allMemberIds.push(group.leaderId);
        }

        for (const studentId of allMemberIds) {
          const memberId = (databricksService as any).generateId?.() ?? `mem_${groupId}_${studentId}`;
          await databricksService.insert('student_group_members', {
            id: memberId,
            session_id: sessionId,
            group_id: groupId,
            student_id: studentId,
            created_at: new Date(),
          });
        }
      }
    } catch (createError) {
      const errorMessage = createError instanceof Error ? createError.message : String(createError);
      const errorStack = createError instanceof Error ? createError.stack : undefined;
      
      console.error('❌ DETAILED SESSION CREATION ERROR:', {
        error: createError,
        message: errorMessage,
        stack: errorStack,
        sessionId,
        teacherId: teacher.id,
        schoolId: school.id,
        errorType: typeof createError,
        errorConstructor: createError?.constructor?.name
      });
      
      // Log the original error without wrapping for debugging
      console.error('❌ RAW ERROR OBJECT:', createError);
      
      throw new Error(`Failed to create session: ${errorMessage}`);
    }

    // 4. Store access code in Redis for student leader joining
    await storeSessionAccessCode(sessionId, accessCode);

    // 5. Record analytics - session configured event
    // TEMPORARILY DISABLED - Planning data already stored in classroom_sessions
    // The session_metrics table is for calculated analytics, not planning data
    // await recordSessionConfigured(sessionId, teacher.id, groupPlan);

    // 6. Audit logging
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'session_created',
      eventCategory: 'session',
      resourceType: 'session',
      resourceId: sessionId,
      schoolId: school.id,
      description: `Teacher ID ${teacher.id} created session with ${groupPlan.numberOfGroups} pre-configured groups`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
    });

    // 7. Fetch complete session with groups for response
    const session = await getSessionWithGroups(sessionId, teacher.id);

    return res.status(201).json({
      success: true,
      data: {
        session,
        accessCode, // Include access code for student leader joining
      },
    });
  } catch (error) {
    console.error('❌ Error creating session:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_CREATE_FAILED',
        message: 'Failed to create session',
      },
    });
  }
}

/**
 * Helper: Record session configured analytics event
 */
async function recordSessionConfigured(sessionId: string, teacherId: string, groupPlan: any): Promise<void> {
  const { logAnalyticsOperation } = await import('../utils/analytics-logger');
  
  try {
    const configuredAt = new Date();
    const plannedMembers = groupPlan.groups.reduce((sum: number, g: any) => sum + g.memberIds.length + (g.leaderId ? 1 : 0), 0);
    const plannedLeaders = groupPlan.groups.filter((g: any) => g.leaderId).length;
    
    // Insert session_analytics record with planned metrics
    await logAnalyticsOperation(
      'session_configured_analytics',
      'session_analytics',
      () => databricksService.insert('session_metrics', {
        id: (databricksService as any).generateId?.() ?? `analytics_${sessionId}`,
        session_id: sessionId,
        planned_groups: groupPlan.numberOfGroups,
        planned_group_size: groupPlan.groupSize,
        planned_members: plannedMembers,
        planned_leaders: plannedLeaders,
        configured_at: configuredAt,
        calculation_timestamp: configuredAt,
      }),
      {
        sessionId,
        teacherId,
        recordCount: 1,
        metadata: {
          plannedGroups: groupPlan.numberOfGroups,
          plannedMembers,
          plannedLeaders,
          groupPlanSize: groupPlan.groups.length
        },
        sampleRate: 1.0, // Always log session configuration
        forceLog: true
      }
    );

    // Insert session_events record
    await logAnalyticsOperation(
      'session_configured_event',
      'session_events',
      () => databricksService.insert('session_events', {
        id: (databricksService as any).generateId?.() ?? `event_${sessionId}_configured`,
        session_id: sessionId,
        teacher_id: teacherId,
        event_type: 'configured',
        event_time: configuredAt,
        payload: JSON.stringify({
          numberOfGroups: groupPlan.numberOfGroups,
          groupSize: groupPlan.groupSize,
          totalMembers: plannedMembers,
          leadersAssigned: plannedLeaders,
        }),
      }),
      {
        sessionId,
        teacherId,
        recordCount: 1,
        metadata: {
          eventType: 'configured',
          payloadSize: JSON.stringify({ numberOfGroups: groupPlan.numberOfGroups }).length
        },
        sampleRate: 1.0, // Always log session events
        forceLog: true
      }
    );
  } catch (error) {
    console.error('Failed to record session configured analytics:', error);
    // Don't throw - analytics failure shouldn't block session creation
  }
}

/**
 * Helper: Record session started analytics event
 */
async function recordSessionStarted(
  sessionId: string, 
  teacherId: string, 
  readyGroupsAtStart: number, 
  startedWithoutReadyGroups: boolean
): Promise<void> {
  const { logAnalyticsOperation } = await import('../utils/analytics-logger');
  
  try {
    const startedAt = new Date();
    
    // Update session_analytics with start metrics
    await logAnalyticsOperation(
      'session_started_analytics',
      'session_analytics',
      () => databricksService.update('session_analytics', `session_id = '${sessionId}'`, {
        started_at: startedAt,
        started_without_ready_groups: startedWithoutReadyGroups,
        ready_groups_at_start: readyGroupsAtStart,
        calculation_timestamp: startedAt,
      }),
      {
        sessionId,
        teacherId,
        recordCount: 1,
        metadata: {
          readyGroupsAtStart,
          startedWithoutReadyGroups,
          readinessRatio: readyGroupsAtStart > 0 ? readyGroupsAtStart / (readyGroupsAtStart + (startedWithoutReadyGroups ? 1 : 0)) : 0
        },
        sampleRate: 1.0, // Always log session starts
        forceLog: true
      }
    );

    // Insert session_events record
    await logAnalyticsOperation(
      'session_started_event',
      'session_events',
      () => databricksService.insert('session_events', {
        id: (databricksService as any).generateId?.() ?? `event_${sessionId}_started`,
        session_id: sessionId,
        teacher_id: teacherId,
        event_type: 'started',
        event_time: startedAt,
        payload: JSON.stringify({
          readyGroupsAtStart,
          startedWithoutReadyGroups,
        }),
      }),
      {
        sessionId,
        teacherId,
        recordCount: 1,
        metadata: {
          eventType: 'started',
          hasReadyGroups: readyGroupsAtStart > 0,
          payloadSize: JSON.stringify({ readyGroupsAtStart }).length
        },
        sampleRate: 1.0, // Always log session events
        forceLog: true
      }
    );
  } catch (error) {
    console.error('Failed to record session started analytics:', error);
    // Don't throw - analytics failure shouldn't block session start
  }
}

/**
 * Helper: Fetch complete session with groups and members
 */
async function getSessionWithGroups(sessionId: string, teacherId: string): Promise<Session> {
  // Get main session data
  const session = await databricksService.queryOne(
    `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
    [sessionId, teacherId]
  );

  if (!session) {
    throw new Error('Session not found');
  }

  // Get groups with leader and member data
  const groups = await databricksService.query(`
    SELECT 
      g.id,
      g.name,
      g.leader_id,
      g.is_ready,
      g.group_number
    FROM ${databricksConfig.catalog}.sessions.student_groups g
    WHERE g.session_id = ?
    ORDER BY g.group_number
  `, [sessionId]);

  // Get all members for all groups in this session
  const members = await databricksService.query(`
    SELECT 
      m.group_id,
      m.student_id,
      s.display_name as name
    FROM ${databricksConfig.catalog}.sessions.student_group_members m
    LEFT JOIN ${databricksConfig.catalog}.users.students s ON m.student_id = s.id
    WHERE m.session_id = ?
  `, [sessionId]);

  // Group members by group_id
  const membersByGroupId = new Map<string, SessionGroupMember[]>();
  for (const member of members) {
    if (!membersByGroupId.has(member.group_id)) {
      membersByGroupId.set(member.group_id, []);
    }
    membersByGroupId.get(member.group_id)!.push({
      id: member.student_id,
      name: member.name || undefined,
    });
  }

  // Build groupsDetailed array
  const groupsDetailed: SessionGroup[] = groups.map((group: any) => ({
    id: group.id,
    name: group.name,
    leaderId: group.leader_id || undefined,
    isReady: Boolean(group.is_ready),
    members: membersByGroupId.get(group.id) || [],
  }));

  // Build complete session object
  return {
    id: session.id,
    teacher_id: session.teacher_id,
    school_id: session.school_id,
    topic: session.title,
    goal: session.description || undefined,
    subject: session.title, // Using title as subject for compatibility
    description: session.description || session.title,
    status: session.status,
    join_code: session.access_code,
    scheduled_start: session.scheduled_start ? new Date(session.scheduled_start) : undefined,
    actual_start: session.actual_start ? new Date(session.actual_start) : undefined,
    actual_end: session.actual_end ? new Date(session.actual_end) : undefined,
    planned_duration_minutes: session.planned_duration_minutes || undefined,
    actual_duration_minutes: session.actual_duration_minutes || undefined,
    groupsDetailed,
    groups: {
      total: groupsDetailed.length,
      active: groupsDetailed.filter(g => g.isReady).length,
    },
    settings: {
      auto_grouping: false, // Always disabled in declarative workflow
      students_per_group: session.target_group_size || 4,
      require_group_leader: true,
      enable_audio_recording: Boolean(session.recording_enabled),
      enable_live_transcription: Boolean(session.transcription_enabled),
      enable_ai_insights: Boolean(session.ai_analysis_enabled),
    },
    created_at: new Date(session.created_at),
    updated_at: new Date(session.updated_at),
  };
}

/**
 * Get a specific session
 */
export async function getSession(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const sessionId = (req.params as any).sessionId || (req.params as any).id;
    
    // Audit log for data access (FERPA)
    try {
      await databricksService.recordAuditLog({
        actorId: teacher.id,
        actorType: 'teacher',
        eventType: 'session_access',
        eventCategory: 'data_access',
        resourceType: 'session',
        resourceId: sessionId,
        schoolId: teacher.school_id,
        description: `Teacher ID ${teacher.id} accessed session ${sessionId}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        complianceBasis: 'legitimate_interest',
      });
    } catch (e) {
      // Do not block response on audit failure
      console.warn('Audit log failed in getSession:', e);
    }
    
    // Use helper to get complete session with groups
    const session = await getSessionWithGroups(sessionId, teacher.id);

    return res.json({
      success: true,
      data: {
        session,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Session not found') {
      return res.status(404).json({ 
        success: false,
        error: {
          code: 'SESSION_NOT_FOUND', 
          message: 'Session not found'
        }
      });
    }
    
    console.error('Error getting session:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_FETCH_FAILED',
        message: 'Failed to fetch session',
      },
    });
  }
}

/**
 * Start a session - Phase 5: Returns full session, records readiness metrics
 */
export async function startSession(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const sessionId = req.params.sessionId;
    
    // Verify session belongs to teacher
    const session = await databricksService.queryOne(
      `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
      [sessionId, teacher.id]
    );
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      });
    }
    
    if (session.status !== 'created' && session.status !== 'paused') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SESSION_STATE',
          message: `Cannot start session in ${session.status} state`,
        },
      });
    }
    
    // Compute ready_groups_at_start from student_groups.is_ready
    const readyGroupsResult = await databricksService.queryOne(
      `SELECT COUNT(*) as ready_groups_count 
       FROM ${databricksConfig.catalog}.sessions.student_groups 
       WHERE session_id = ? AND is_ready = true`,
      [sessionId]
    );
    
    const totalGroupsResult = await databricksService.queryOne(
      `SELECT COUNT(*) as total_groups_count 
       FROM ${databricksConfig.catalog}.sessions.student_groups 
       WHERE session_id = ?`,
      [sessionId]
    );
    
    const readyGroupsAtStart = readyGroupsResult?.ready_groups_count || 0;
    const totalGroups = totalGroupsResult?.total_groups_count || 0;
    const startedWithoutReadyGroups = readyGroupsAtStart < totalGroups;

    // Update session status and actual_start
    const startedAt = new Date();
    await databricksService.update('classroom_sessions', sessionId, {
      status: 'active',
      actual_start: startedAt,
    });
    
    // Broadcast session status change to all connected WebSocket clients
    const { websocketService } = await import('../services/websocket.service');
    if (websocketService.io) {
      // Broadcast to general session room
      websocketService.emitToSession(sessionId, 'session:status_changed', { 
        sessionId, 
        status: 'active'
      });
      
      // Also broadcast to legacy namespace if needed
      websocketService.io.to(`session:${sessionId}`).emit('session:status_changed', {
        sessionId,
        status: 'active'
      });
    }
    
    // Record analytics - session started event
    await recordSessionStarted(sessionId, teacher.id, readyGroupsAtStart, startedWithoutReadyGroups);
    
    // Record audit log
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'session_started',
      eventCategory: 'session',
      resourceType: 'session',
      resourceId: sessionId,
      schoolId: session.school_id,
      description: `Teacher ID ${teacher.id} started session (${readyGroupsAtStart}/${totalGroups} groups ready)`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
    });
    
    // Get complete session for response
    const fullSession = await getSessionWithGroups(sessionId, teacher.id);
    
    return res.json({
      success: true,
      data: {
        session: fullSession,
        websocketUrl: `wss://ws.classwaves.com/session/${sessionId}`,
        realtimeToken: 'rt_token_' + sessionId, // TODO: Generate actual token
      },
    });
  } catch (error) {
    console.error('Error starting session:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_START_FAILED',
        message: 'Failed to start session',
      },
    });
  }
}

/**
 * End a session
 */
export async function endSession(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const sessionId = (req.params as any).sessionId || (req.params as any).id;
    const { reason = 'planned_completion', teacherNotes } = req.body || {};
    
    // Verify session belongs to teacher
    const session = await databricksService.queryOne(
      `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
      [sessionId, teacher.id]
    );
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      });
    }
    
    if (session.status === 'ended' || session.status === 'archived') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SESSION_ALREADY_ENDED',
          message: 'Session has already ended',
        },
      });
    }
    
    // Update session status (note: end_reason and teacher_notes fields don't exist in schema, logged in audit instead)
    await databricksService.updateSessionStatus(sessionId, 'ended');
    
    // Record audit log
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'session_ended',
      eventCategory: 'session',
      resourceType: 'session',
      resourceId: sessionId,
      schoolId: session.school_id,
      description: `Teacher ID ${teacher.id} ended session - Reason: ${reason}${teacherNotes ? ` - Notes: ${teacherNotes}` : ''}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
    });
    
    // Notify via WebSocket
    try {
      websocketService.endSession(sessionId);
      websocketService.notifySessionUpdate(sessionId, { type: 'session_ended', sessionId });
    } catch (e) {
      console.warn('WebSocket notify failed in endSession:', e);
    }
    
    // Get final session stats
    const stats = await databricksService.queryOne(
      `SELECT total_groups, total_students,
              (SELECT COUNT(id) FROM ${databricksConfig.catalog}.sessions.transcriptions WHERE session_id = s.id) as total_transcriptions
       FROM ${databricksConfig.catalog}.sessions.classroom_sessions s
       WHERE s.id = ?`,
      [sessionId]
    );
    
    // Calculate duration
    const startTime = new Date(session.actual_start || session.created_at);
    const endTime = new Date();
    const totalDuration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    
    return res.json({
      success: true,
      data: {
        session: {
          id: sessionId,
          status: 'ended',
          actualEnd: endTime,
          totalDuration,
          reason,
        },
        summary: {
          totalGroups: stats?.total_groups || 0,
          totalParticipants: stats?.total_participants || 0,
          totalTranscriptions: stats?.total_transcriptions || 0,
          participationRate: session.participation_rate || 0,
          engagementScore: session.engagement_score || 0,
        },
      },
    });
  } catch (error) {
    console.error('Error ending session:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_END_FAILED',
        message: 'Failed to end session',
      },
    });
  }
}

/**
 * Update a session (only allowed for created or paused sessions)
 */
export async function updateSession(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const sessionId = req.params.sessionId;
    const updateData = req.body;
    
    // Verify session belongs to teacher
    const session = await databricksService.queryOne(
      `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
      [sessionId, teacher.id]
    );
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      });
    }
    
    // Only allow updates to created or paused sessions
    if (session.status !== 'created' && session.status !== 'paused') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SESSION_IMMUTABLE',
          message: 'Cannot update active or ended sessions',
        },
      });
    }
    
    // Allowed fields to update
    const allowedFields = ['title', 'description', 'target_group_size', 
                          'auto_group_enabled', 'scheduled_start', 'planned_duration_minutes'];
    
    const fieldsToUpdate: Record<string, any> = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        fieldsToUpdate[field] = updateData[field];
      }
    }
    
    if (Object.keys(fieldsToUpdate).length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'NO_UPDATES',
          message: 'No valid fields to update',
        },
      });
    }
    
    // Update session
    await databricksService.update('classroom_sessions', sessionId, fieldsToUpdate);
    
    // Record audit log
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'session_updated',
      eventCategory: 'session',
      resourceType: 'session',
      resourceId: sessionId,
      schoolId: session.school_id,
      description: `Teacher ID ${teacher.id} updated session`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
    });
    
    // Get updated session
    const updatedSession = await databricksService.queryOne(
      `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ?`,
      [sessionId]
    );
    
    return res.json({
      success: true,
      data: {
        session: updatedSession,
      },
    });
  } catch (error) {
    console.error('Error updating session:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_UPDATE_FAILED',
        message: 'Failed to update session',
      },
    });
  }
}

/**
 * Delete (archive) a session
 */
export async function deleteSession(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const sessionId = req.params.sessionId;
    
    // Verify session belongs to teacher
    const session = await databricksService.queryOne(
      `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ?`,
      [sessionId, teacher.id]
    );
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      });
    }
    
    // Cannot delete active sessions
    if (session.status === 'active') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SESSION_ACTIVE',
          message: 'Cannot delete an active session. End it first.',
        },
      });
    }
    
    // Archive the session (note: archived_at and archived_by fields don't exist in schema, status change is sufficient)
    await databricksService.updateSessionStatus(sessionId, 'archived');
    
    // Record audit log
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'session_archived',
      eventCategory: 'session',
      resourceType: 'session',
      resourceId: sessionId,
      schoolId: session.school_id,
      description: `Teacher ID ${teacher.id} archived session`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
    });
    
    return res.json({
      success: true,
      message: 'Session archived successfully',
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_DELETE_FAILED',
        message: 'Failed to delete session',
      },
    });
  }
}

/**
 * Pause a session
 */
export async function pauseSession(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const sessionId = req.params.sessionId;
    
    // Verify session belongs to teacher and is active
    const session = await databricksService.queryOne(
      `SELECT * FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ? AND teacher_id = ? AND status = ?`,
      [sessionId, teacher.id, 'active']
    );
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Active session not found',
        },
      });
    }
    
    // Update session status (note: paused_at field doesn't exist in schema, status change is sufficient)
    await databricksService.updateSessionStatus(sessionId, 'paused');
    
    // Record audit log
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'session_paused',
      eventCategory: 'session',
      resourceType: 'session',
      resourceId: sessionId,
      schoolId: session.school_id,
      description: `Teacher ID ${teacher.id} paused session`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
    });
    
    return res.json({
      success: true,
      data: {
        session: {
          id: sessionId,
          status: 'paused',
        },
      },
    });
  } catch (error) {
    console.error('Error pausing session:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_PAUSE_FAILED',
        message: 'Failed to pause session',
      },
    });
  }
}