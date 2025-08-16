/**
 * Session Authorization Middleware
 * 
 * Ensures that users can only access sessions they own or have authorized access to.
 * Used specifically for analytics endpoints and other session-scoped resources.
 */

import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../types/auth.types';
import { databricksService } from '../services/databricks.service';

/**
 * Middleware to verify that the authenticated user has access to the requested session
 * Expects sessionId to be available in req.params.sessionId
 */
export async function requireSessionAccess(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const authReq = req as AuthRequest;
  const { sessionId } = req.params;

  // Check if user is authenticated (should be handled by auth middleware first)
  if (!authReq.user) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  // Check if sessionId is provided
  if (!sessionId) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'SESSION_ID_REQUIRED',
        message: 'Session ID is required in the URL path',
      },
    });
  }

  try {
    // Verify session exists and user has access
    const session = await databricksService.queryOne(`
      SELECT 
        cs.id,
        cs.teacher_id,
        cs.school_id,
        cs.status,
        s.name as school_name
      FROM classwaves.sessions.classroom_sessions cs
      LEFT JOIN classwaves.auth.schools s ON cs.school_id = s.id
      WHERE cs.id = ?
    `, [sessionId]);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found',
        },
      });
    }

    // Check ownership - teacher must own the session
    if (session.teacher_id !== authReq.user.id) {
      // Additional check: admin users can access sessions from their school
      if (authReq.user.role === 'admin' && session.school_id === authReq.user.school_id) {
        // Admin access granted - continue
        console.log(`🔐 Admin access granted for session ${sessionId} by user ${authReq.user.id}`);
      } else {
        // Record unauthorized access attempt for security monitoring
        console.warn(`⚠️ Unauthorized session access attempt:`, {
          userId: authReq.user.id,
          userEmail: authReq.user.email,
          sessionId,
          sessionOwner: session.teacher_id,
          userSchool: authReq.user.school_id,
          sessionSchool: session.school_id,
          userRole: authReq.user.role,
          ip: req.ip,
          userAgent: req.headers['user-agent']
        });

        return res.status(403).json({
          success: false,
          error: {
            code: 'SESSION_ACCESS_DENIED',
            message: 'You do not have permission to access this session',
          },
        });
      }
    }

    // School-level verification for additional security
    if (session.school_id !== authReq.user.school_id) {
      console.error(`🚨 Security violation: Cross-school session access attempt:`, {
        userId: authReq.user.id,
        userSchool: authReq.user.school_id,
        sessionSchool: session.school_id,
        sessionId
      });

      return res.status(403).json({
        success: false,
        error: {
          code: 'CROSS_SCHOOL_ACCESS_DENIED',
          message: 'Cross-school session access is not permitted',
        },
      });
    }

    // Optional: Check if session is in a valid state for analytics access
    if (req.path.includes('/analytics/') && session.status === 'created') {
      return res.status(400).json({
        success: false,
        error: {
          code: 'SESSION_NOT_READY',
          message: 'Analytics not available for sessions that have not started',
        },
      });
    }

    // Attach session info to request for downstream use
    (authReq as any).sessionInfo = {
      id: session.id,
      teacherId: session.teacher_id,
      schoolId: session.school_id,
      status: session.status,
      schoolName: session.school_name
    };

    console.log(`✅ Session access authorized: ${sessionId} for user ${authReq.user.id}`);
    next();

  } catch (error) {
    console.error('Session authorization error:', error);
    return res.status(500).json({
      success: false,
      error: {
        code: 'SESSION_AUTH_ERROR',
        message: 'An error occurred while verifying session access',
      },
    });
  }
}

/**
 * Middleware specifically for analytics endpoints with enhanced logging
 */
export async function requireAnalyticsAccess(req: Request, res: Response, next: NextFunction): Promise<Response | void> {
  const authReq = req as AuthRequest;
  
  // First check session access
  const sessionCheck = await new Promise<boolean>((resolve) => {
    requireSessionAccess(req, res, (err?: any) => {
      if (err || res.headersSent) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });

  if (!sessionCheck) {
    // Response already sent by requireSessionAccess
    return;
  }

  // Additional analytics-specific checks
  const sessionInfo = (authReq as any).sessionInfo;
  
  // Log analytics access for audit compliance (FERPA/COPPA)
  try {
    await databricksService.recordAuditLog({
      actorId: authReq.user!.id,
      actorType: 'teacher',
      eventType: 'analytics_access',
      eventCategory: 'data_access',
      resourceType: 'session_analytics',
      resourceId: sessionInfo.id,
      schoolId: sessionInfo.schoolId,
      description: `Teacher accessed analytics for session`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest', // Educational improvement
      dataAccessed: req.path.includes('membership-summary') ? 'membership_analytics' : 'session_analytics'
    });
  } catch (auditError) {
    console.error('Failed to log analytics access:', auditError);
    // Continue - don't block access due to audit logging failure
  }

  next();
}

/**
 * Role-based access middleware for super-admin analytics access
 */
export function requireAdminAnalyticsAccess(req: Request, res: Response, next: NextFunction): Response | void {
  const authReq = req as AuthRequest;

  if (!authReq.user) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  if (authReq.user.role !== 'admin' && authReq.user.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      error: {
        code: 'ADMIN_ACCESS_REQUIRED',
        message: 'Administrator privileges required for this operation',
      },
    });
  }

  next();
}
