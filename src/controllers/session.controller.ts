import { Request, Response } from 'express';
import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';
import { AuthRequest } from '../types/auth.types';

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
    
    // Get sessions from database
    const sessions = await databricksService.getTeacherSessions(teacher.id, limit);
    
    // TODO: Implement pagination and filtering
    
    return res.json({
      success: true,
      data: {
        sessions: sessions.map(session => ({
          id: session.id,
          topic: session.title,
          goal: session.description,
          status: session.status,
          teacherId: session.teacher_id,
          schoolId: session.school_id,
          maxStudents: session.max_students,
          targetGroupSize: session.target_group_size,
          scheduledStart: session.scheduled_start,
          actualStart: session.actual_start,
          plannedDuration: session.planned_duration_minutes,
          groups: {
            total: session.group_count || 0,
            active: session.status === 'active' ? session.group_count || 0 : 0,
          },
          students: {
            total: session.student_count || 0,
            active: session.status === 'active' ? session.student_count || 0 : 0,
          },
          analytics: {
            participationRate: session.participation_rate,
            engagementScore: session.engagement_score,
          },
          createdAt: session.created_at,
        })),
        pagination: {
          page,
          limit,
          total: sessions.length, // TODO: Get actual total count
          totalPages: Math.ceil(sessions.length / limit),
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
 * Create a new session
 */
export async function createSession(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const school = authReq.school!;
    
    const {
      topic,
      goal,
      description,
      scheduledStart,
      plannedDuration = 45,
      autoGroupEnabled = true,
      maxStudents = 30,
      targetGroupSize = 4,
      settings = {},
    } = req.body || {};
    
    // Create session in database and get back the session data including access code
    const sessionResult = await databricksService.createSession({
      title: topic,
      description: goal || description,
      teacherId: teacher.id,
      schoolId: school.id,
      maxStudents,
      targetGroupSize,
      autoGroupEnabled,
      scheduledStart: scheduledStart ? new Date(scheduledStart) : undefined,
      plannedDuration,
    });
    
    // Fire-and-forget audit logging (don't block response)
    setImmediate(() => {
      databricksService.recordAuditLog({
        actorId: teacher.id,
        actorType: 'teacher',
        eventType: 'session_created',
        eventCategory: 'session',
        resourceType: 'session',
        resourceId: sessionResult.sessionId,
        schoolId: school.id,
        description: `Teacher ${teacher.email} created session "${topic}"`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        complianceBasis: 'legitimate_interest',
      }).catch(error => {
        console.error('Background audit logging failed:', error);
      });
    });
    
    return res.status(201).json({
      success: true,
      data: {
        session: {
          id: sessionResult.sessionId,
          accessCode: sessionResult.accessCode,
          topic,
          goal: goal || description,
          status: 'created',
          teacherId: teacher.id,
          schoolId: school.id,
          maxStudents,
          targetGroupSize,
          autoGroupEnabled,
          scheduledStart,
          plannedDuration,
          settings: {
            recordingEnabled: settings.recordingEnabled ?? true,
            transcriptionEnabled: settings.transcriptionEnabled ?? true,
            aiAnalysisEnabled: settings.aiAnalysisEnabled ?? true,
          },
          createdAt: sessionResult.createdAt,
        },
      },
    });
  } catch (error) {
    console.error('Error creating session:', error);
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
 * Get a specific session
 */
export async function getSession(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const teacher = authReq.user!;
    const sessionId = req.params.sessionId;
    
    // Get session from database
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
    
    // Get groups for the session
    const groups = await databricksService.query(
      `SELECT id, session_id, name, group_number, status, max_size, current_size, student_ids,
              auto_managed, is_ready, leader_id
       FROM ${databricksConfig.catalog}.sessions.student_groups
       WHERE session_id = ?
       ORDER BY group_number`,
      [sessionId]
    );
    
    return res.json({
      success: true,
      data: {
        session: {
          id: session.id,
          accessCode: session.access_code,
          topic: session.title,
          status: session.status,
          groups: groups.map(group => ({
            id: group.id,
            name: group.name,
            groupNumber: group.group_number,
            status: group.status,
            studentIds: JSON.parse(group.student_ids || '[]'),
            maxMembers: group.max_size,
            currentMembers: group.current_size || 0,
            isReady: group.is_ready,
            leaderId: group.leader_id
          })),
          settings: {
            recordingEnabled: session.recording_enabled,
            transcriptionEnabled: session.transcription_enabled,
            aiAnalysisEnabled: session.ai_analysis_enabled,
          },
          metrics: {
            totalGroups: groups.length,
            totalStudents: session.total_students || 0,
          },
          createdAt: session.created_at,
          updatedAt: session.updated_at,
        },
      },
    });
  } catch (error) {
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
 * Start a session
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
    
    // Update session status
    await databricksService.updateSessionStatus(sessionId, 'active');
    
    // Record audit log
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'session_started',
      eventCategory: 'session',
      resourceType: 'session',
      resourceId: sessionId,
      schoolId: session.school_id,
      description: `Teacher ${teacher.email} started session "${session.title}"`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
    });
    
    // Get active groups and students count
    const counts = await databricksService.queryOne(
      `SELECT COUNT(DISTINCT id) as active_groups,
              SUM(current_size) as active_students
       FROM ${databricksConfig.catalog}.sessions.student_groups
       WHERE session_id = ? AND status = 'active'`,
      [sessionId]
    );
    
    return res.json({
      success: true,
      data: {
        session: {
          id: sessionId,
          status: 'active',
          activeGroups: counts?.active_groups || 0,
          activeStudents: counts?.active_students || 0,
        },
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
    const sessionId = req.params.sessionId;
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
      description: `Teacher ${teacher.email} ended session "${session.title}" - Reason: ${reason}${teacherNotes ? ` - Notes: ${teacherNotes}` : ''}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
    });
    
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
    const allowedFields = ['title', 'description', 'max_students', 'target_group_size', 
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
      description: `Teacher ${teacher.email} updated session "${session.title}"`,
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
      description: `Teacher ${teacher.email} archived session "${session.title}"`,
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
      description: `Teacher ${teacher.email} paused session "${session.title}"`,
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