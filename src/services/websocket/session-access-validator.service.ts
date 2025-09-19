/**
 * Session Access Validator Service
 * 
 * Platform Stabilization P1 3.2: Additional session-level security validation
 * for WebSocket operations to ensure users can only access authorized sessions.
 */

import { Socket } from 'socket.io';
import { databricksService } from '../databricks.service';
import { SecurityContext } from './websocket-security-validator.service';
import { logger } from '../../utils/logger';

export interface SessionAccessResult {
  allowed: boolean;
  sessionId?: string;
  reason?: string;
  metadata?: {
    ownedSessions?: string[];
    enrolledSessions?: string[];
    schoolSessions?: string[];
  };
}

export class SessionAccessValidator {
  
  /**
   * Validate that a user can access a specific session
   */
  async validateSessionAccess(
    socket: Socket,
    sessionId: string,
    operationType: 'join' | 'view' | 'control' | 'analytics' = 'view'
  ): Promise<SessionAccessResult> {
    const socketData = socket.data as any;
    const securityContext: SecurityContext = socketData.securityContext;
    
    if (!securityContext) {
      return {
        allowed: false,
        reason: 'Missing security context'
      };
    }

    try {
      if (securityContext.role === 'admin' || securityContext.role === 'super_admin') {
        // Admins and super_admins have broad access but should still validate session exists
        const sessionExists = await this.validateSessionExists(sessionId);
        return {
          allowed: sessionExists,
          sessionId,
          reason: sessionExists ? undefined : 'Session does not exist'
        };
      }

      if (securityContext.role === 'teacher') {
        return await this.validateTeacherSessionAccess(
          securityContext,
          sessionId,
          operationType
        );
      }

      if (securityContext.role === 'student') {
        return await this.validateStudentSessionAccess(
          securityContext,
          sessionId,
          operationType
        );
      }

      return {
        allowed: false,
        reason: `Invalid role: ${securityContext.role}`
      };

    } catch (error) {
      logger.error('Session access validation error:', error);
      return {
        allowed: false,
        reason: 'Session access validation failed'
      };
    }
  }

  /**
   * Validate teacher access to session
   */
  private async validateTeacherSessionAccess(
    securityContext: SecurityContext,
    sessionId: string,
    operationType: string
  ): Promise<SessionAccessResult> {
    
    // Teachers can access sessions they own
    const ownedSession = await databricksService.queryOne(`
      SELECT id, teacher_id, school_id, status, topic
      FROM classwaves.sessions.classroom_sessions
      WHERE id = ? AND teacher_id = ?
    `, [sessionId, securityContext.userId]);

    if (ownedSession) {
      return {
        allowed: true,
        sessionId,
        metadata: {
          ownedSessions: [sessionId]
        }
      };
    }

    // For 'view' operations, teachers can access sessions in their school
    if (operationType === 'view' || operationType === 'analytics') {
      const schoolSession = await databricksService.queryOne(`
        SELECT cs.id, cs.teacher_id, cs.school_id, cs.status, cs.topic
        FROM classwaves.sessions.classroom_sessions cs
        WHERE cs.id = ? AND cs.school_id = ?
      `, [sessionId, securityContext.schoolId]);

      if (schoolSession) {
        return {
          allowed: true,
          sessionId,
          metadata: {
            schoolSessions: [sessionId]
          }
        };
      }
    }

    return {
      allowed: false,
      reason: `Teacher ${securityContext.userId} cannot ${operationType} session ${sessionId}`
    };
  }

  /**
   * Validate student access to session
   */
  private async validateStudentSessionAccess(
    securityContext: SecurityContext,
    sessionId: string,
    operationType: string
  ): Promise<SessionAccessResult> {
    
    // Students can only access sessions they're enrolled in
    const enrollment = await databricksService.queryOne(`
      SELECT p.id, p.session_id, p.group_id, p.is_active,
             cs.status as session_status, cs.teacher_id, cs.school_id
      FROM classwaves.sessions.participants p
      JOIN classwaves.sessions.classroom_sessions cs ON p.session_id = cs.id
      WHERE p.session_id = ? AND p.student_id = ? AND p.is_active = true
    `, [sessionId, securityContext.userId]);

    if (!enrollment) {
      return {
        allowed: false,
        reason: `Student ${securityContext.userId} is not enrolled in session ${sessionId}`
      };
    }

    // Check if session is in valid state for student access
    const validStates = ['scheduled', 'active', 'paused'];
    if (!validStates.includes(enrollment.session_status)) {
      return {
        allowed: false,
        reason: `Session ${sessionId} is not in a valid state for student access (status: ${enrollment.session_status})`
      };
    }

    // Students cannot perform control operations
    if (operationType === 'control') {
      return {
        allowed: false,
        reason: `Students cannot perform control operations on sessions`
      };
    }

    return {
      allowed: true,
      sessionId,
      metadata: {
        enrolledSessions: [sessionId]
      }
    };
  }

  /**
   * Check if session exists and is valid
   */
  private async validateSessionExists(sessionId: string): Promise<boolean> {
    try {
      const session = await databricksService.queryOne(`
        SELECT id FROM classwaves.sessions.classroom_sessions WHERE id = ?
      `, [sessionId]);
      
      return !!session;
    } catch (error) {
      logger.error('Error validating session existence:', error);
      return false;
    }
  }

  /**
   * Get all sessions accessible to a user
   */
  async getUserAccessibleSessions(
    securityContext: SecurityContext
  ): Promise<{
    ownedSessions: string[];
    enrolledSessions: string[];
    schoolSessions: string[];
  }> {
    const result = {
      ownedSessions: [] as string[],
      enrolledSessions: [] as string[],
      schoolSessions: [] as string[]
    };

    try {
      if (securityContext.role === 'teacher' || securityContext.role === 'admin' || securityContext.role === 'super_admin') {
        if (securityContext.role === 'super_admin') {
          // Super admin can access all sessions
          const allSessions = await databricksService.query(`
            SELECT id FROM classwaves.sessions.classroom_sessions
            WHERE status IN ('scheduled', 'active', 'paused', 'ended')
            ORDER BY created_at DESC
            LIMIT 100
          `);
          result.ownedSessions = (allSessions as any[]).map(s => s.id);
        } else {
          // Get owned sessions for teachers/admins
          const ownedSessions = await databricksService.query(`
            SELECT id FROM classwaves.sessions.classroom_sessions
            WHERE teacher_id = ? AND status IN ('scheduled', 'active', 'paused', 'ended')
            ORDER BY created_at DESC
            LIMIT 50
          `, [securityContext.userId]);

          result.ownedSessions = (ownedSessions as any[]).map(s => s.id);

          // Get school sessions (if teacher)
          if (securityContext.role === 'teacher' && securityContext.schoolId) {
            const schoolSessions = await databricksService.query(`
              SELECT id FROM classwaves.sessions.classroom_sessions
              WHERE school_id = ? AND teacher_id != ? AND status IN ('scheduled', 'active', 'paused')
              ORDER BY created_at DESC
              LIMIT 25
            `, [securityContext.schoolId, securityContext.userId]);

            result.schoolSessions = (schoolSessions as any[]).map(s => s.id);
          }
        }
      }

      if (securityContext.role === 'student') {
        // Get enrolled sessions
        const enrolledSessions = await databricksService.query(`
          SELECT DISTINCT p.session_id
          FROM classwaves.sessions.participants p
          JOIN classwaves.sessions.classroom_sessions cs ON p.session_id = cs.id
          WHERE p.student_id = ? AND p.is_active = true
          AND cs.status IN ('scheduled', 'active', 'paused')
          ORDER BY cs.created_at DESC
          LIMIT 10
        `, [securityContext.userId]);

        result.enrolledSessions = (enrolledSessions as any[]).map(s => s.session_id);
      }

    } catch (error) {
      logger.error('Error fetching accessible sessions:', error);
    }

    return result;
  }

  /**
   * Validate group access within a session
   */
  async validateGroupAccess(
    securityContext: SecurityContext,
    sessionId: string,
    groupId: string
  ): Promise<SessionAccessResult> {
    try {
      // First validate session access
      const sessionAccess = await this.validateSessionAccess(
        { data: { securityContext } } as Socket,
        sessionId,
        'view'
      );

      if (!sessionAccess.allowed) {
        return sessionAccess;
      }

      if (securityContext.role === 'teacher' || securityContext.role === 'admin' || securityContext.role === 'super_admin') {
        // Teachers/admins/super_admins with session access can access any group in that session
        const groupExists = await databricksService.queryOne(`
          SELECT id FROM classwaves.sessions.student_groups
          WHERE id = ? AND session_id = ?
        `, [groupId, sessionId]);

        return {
          allowed: !!groupExists,
          sessionId,
          reason: groupExists ? undefined : 'Group does not exist in session'
        };
      }

      if (securityContext.role === 'student') {
        // Students can only access their assigned group
        const studentGroupAccess = await databricksService.queryOne(`
          SELECT p.id, p.group_id
          FROM classwaves.sessions.participants p
          WHERE p.session_id = ? AND p.student_id = ? AND p.group_id = ? AND p.is_active = true
        `, [sessionId, securityContext.userId, groupId]);

        return {
          allowed: !!studentGroupAccess,
          sessionId,
          reason: studentGroupAccess ? undefined : 'Student not assigned to this group'
        };
      }

      return {
        allowed: false,
        reason: 'Invalid role for group access'
      };

    } catch (error) {
      logger.error('Group access validation error:', error);
      return {
        allowed: false,
        reason: 'Group access validation failed'
      };
    }
  }
}

// Singleton instance
export const sessionAccessValidator = new SessionAccessValidator();