/**
 * Admin Route Security Middleware
 * 
 * Platform Stabilization P1 3.3: Comprehensive admin route protection with
 * consistent role-based access control and security audit logging.
 */

import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../types/auth.types';
import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';

export interface AdminSecurityOptions {
  allowedRoles: Array<'admin' | 'super_admin'>;
  requireSchoolMatch?: boolean; // Admin must be from same school
  auditLog?: boolean;
  customErrorMessage?: string;
}

interface AdminSecurityAuditEvent {
  id: string;
  event_type: 'ADMIN_ACCESS_GRANTED' | 'ADMIN_ACCESS_DENIED' | 'ROUTE_SECURITY_VIOLATION';
  user_id: string;
  user_role: string;
  route_path: string;
  http_method: string;
  ip_address: string;
  user_agent: string;
  school_id?: string;
  required_roles: string[];
  timestamp: string;
  metadata: Record<string, any>;
}

/**
 * Enhanced admin route protection with comprehensive security validation
 */
export function requireAdminAccess(options: AdminSecurityOptions = { allowedRoles: ['admin', 'super_admin'] }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();
    const authReq = req as AuthRequest;
    
    try {
      // 1. Verify authentication
      if (!authReq.user) {
        await logAdminSecurityEvent(req, null, 'ADMIN_ACCESS_DENIED', {
          reason: 'No authenticated user',
          requiredRoles: options.allowedRoles,
          severity: 'HIGH'
        });
        
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required for admin routes',
          statusCode: 401
        });
      }

      // 2. Verify role access
      if (!options.allowedRoles.includes(authReq.user.role as any)) {
        await logAdminSecurityEvent(req, authReq.user, 'ADMIN_ACCESS_DENIED', {
          reason: 'Insufficient role privileges',
          userRole: authReq.user.role,
          requiredRoles: options.allowedRoles,
          severity: 'HIGH'
        });

        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_PRIVILEGES',
          message: options.customErrorMessage || 'Administrator privileges required for this operation',
          required: options.allowedRoles,
          current: authReq.user.role,
          statusCode: 403
        });
      }

      // 3. Verify user account status
      const userValidation = await validateAdminUserStatus(authReq.user.id, authReq.user.role);
      if (!userValidation.valid) {
        await logAdminSecurityEvent(req, authReq.user, 'ADMIN_ACCESS_DENIED', {
          reason: userValidation.reason,
          userStatus: userValidation.userStatus,
          severity: 'HIGH'
        });

        return res.status(403).json({
          success: false,
          error: 'ADMIN_ACCOUNT_INVALID',
          message: userValidation.reason || 'Administrator account is not valid for access',
          statusCode: 403
        });
      }

      // 4. School matching validation (if required)
      if (options.requireSchoolMatch && req.params.schoolId) {
        const schoolValidation = await validateSchoolAccess(
          authReq.user,
          req.params.schoolId,
          options.allowedRoles
        );

        if (!schoolValidation.allowed) {
          await logAdminSecurityEvent(req, authReq.user, 'ADMIN_ACCESS_DENIED', {
            reason: schoolValidation.reason,
            targetSchoolId: req.params.schoolId,
            userSchoolId: authReq.user.school_id,
            severity: 'HIGH'
          });

          return res.status(403).json({
            success: false,
            error: 'SCHOOL_ACCESS_DENIED',
            message: schoolValidation.reason || 'Access denied to requested school',
            statusCode: 403
          });
        }
      }

      // 5. Success - log access if enabled
      if (options.auditLog !== false) {
        await logAdminSecurityEvent(req, authReq.user, 'ADMIN_ACCESS_GRANTED', {
          requiredRoles: options.allowedRoles,
          userRole: authReq.user.role,
          schoolValidation: options.requireSchoolMatch || false,
          severity: 'INFO'
        });
      }

      const validationDuration = Date.now() - startTime;
      console.log(`✅ Admin route access granted: ${req.method} ${req.path} for ${authReq.user.role} ${authReq.user.id} in ${validationDuration}ms`);

      next();

    } catch (error) {
      const validationDuration = Date.now() - startTime;
      console.error(`❌ Admin route security validation error after ${validationDuration}ms:`, error);

      await logAdminSecurityEvent(req, authReq.user, 'ROUTE_SECURITY_VIOLATION', {
        reason: 'Security validation error',
        error: error instanceof Error ? error.message : 'Unknown error',
        severity: 'CRITICAL'
      });

      return res.status(500).json({
        success: false,
        error: 'SECURITY_VALIDATION_ERROR',
        message: 'Admin route security validation failed',
        statusCode: 500
      });
    }
  };
}

/**
 * Validate admin user account status
 */
async function validateAdminUserStatus(
  userId: string,
  userRole: string
): Promise<{ valid: boolean; reason?: string; userStatus?: string }> {
  try {
    const userRecord = await databricksService.queryOne(`
      SELECT t.id, t.status, t.role, t.school_id, s.subscription_status, s.name as school_name
      FROM classwaves.users.teachers t
      LEFT JOIN classwaves.users.schools s ON t.school_id = s.id
      WHERE t.id = ?
    `, [userId]);

    if (!userRecord) {
      return {
        valid: false,
        reason: 'Admin user record not found',
        userStatus: 'not_found'
      };
    }

    if (userRecord.status !== 'active') {
      return {
        valid: false,
        reason: `Admin account status is ${userRecord.status}`,
        userStatus: userRecord.status
      };
    }

    // Verify role consistency
    if (userRecord.role !== userRole) {
      return {
        valid: false,
        reason: `Role mismatch: token role ${userRole} vs database role ${userRecord.role}`,
        userStatus: 'role_mismatch'
      };
    }

    // Check school status for non-super-admin
    if (userRole === 'admin' && userRecord.subscription_status !== 'active') {
      return {
        valid: false,
        reason: `School subscription is ${userRecord.subscription_status}`,
        userStatus: 'school_inactive'
      };
    }

    return { valid: true };

  } catch (error) {
    console.error('Error validating admin user status:', error);
    return {
      valid: false,
      reason: 'Admin user validation failed',
      userStatus: 'validation_error'
    };
  }
}

/**
 * Validate school access for admin operations
 */
async function validateSchoolAccess(
  user: any,
  targetSchoolId: string,
  allowedRoles: Array<'admin' | 'super_admin'>
): Promise<{ allowed: boolean; reason?: string }> {
  try {
    // Super admins have access to all schools
    if (user.role === 'super_admin' && allowedRoles.includes('super_admin')) {
      const schoolExists = await databricksService.queryOne(`
        SELECT id FROM classwaves.users.schools WHERE id = ?
      `, [targetSchoolId]);

      return {
        allowed: !!schoolExists,
        reason: schoolExists ? undefined : 'Target school does not exist'
      };
    }

    // Regular admins can only access their own school
    if (user.role === 'admin' && user.school_id === targetSchoolId) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `${user.role} ${user.id} cannot access school ${targetSchoolId} (belongs to ${user.school_id})`
    };

  } catch (error) {
    console.error('Error validating school access:', error);
    return {
      allowed: false,
      reason: 'School access validation failed'
    };
  }
}

/**
 * Log admin security events for audit and monitoring
 */
async function logAdminSecurityEvent(
  req: Request,
  user: any,
  eventType: AdminSecurityAuditEvent['event_type'],
  metadata: Record<string, any>
): Promise<void> {
  const auditEvent: AdminSecurityAuditEvent = {
    id: `admin_security_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    event_type: eventType,
    user_id: user?.id || 'unknown',
    user_role: user?.role || 'unknown',
    route_path: req.path,
    http_method: req.method,
    ip_address: req.ip || 'unknown',
    user_agent: req.headers['user-agent'] || 'unknown',
    school_id: user?.school_id,
    required_roles: metadata.requiredRoles || [],
    timestamp: new Date().toISOString(),
    metadata: {
      ...metadata,
      params: req.params,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      referer: req.headers.referer
    }
  };

  try {
    // Store in security audit log (async, don't block)
    setImmediate(async () => {
      try {
        await databricksService.recordAuditLog({
          actorId: auditEvent.user_id,
          actorType: 'admin',
          eventType: 'admin_route_access',
          eventCategory: 'compliance',
          resourceType: 'admin_route',
          resourceId: auditEvent.route_path,
          schoolId: auditEvent.school_id || 'unknown',
          description: `Admin route: ${auditEvent.event_type} ${auditEvent.http_method} ${auditEvent.route_path}`,
          ipAddress: auditEvent.ip_address,
          userAgent: auditEvent.user_agent,
          complianceBasis: 'legitimate_interest',
        });
      } catch (error) {
        // Gracefully handle audit log errors - don't block core functionality
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes('TABLE_OR_VIEW_NOT_FOUND')) {
          console.warn('Audit log table not found - skipping admin security audit (non-critical)');
        } else {
          console.error('Failed to log admin security event to audit log:', error);
        }
      }
    });

  } catch (error) {
    console.error('Error logging admin security event:', error);
  }
}

/**
 * Convenience middleware for super admin only routes
 */
export const requireSuperAdmin = requireAdminAccess({
  allowedRoles: ['super_admin'],
  auditLog: true,
  customErrorMessage: 'Super administrator privileges required'
});

/**
 * Convenience middleware for admin or super admin routes
 */
export const requireAnyAdmin = requireAdminAccess({
  allowedRoles: ['admin', 'super_admin'],
  auditLog: true
});

/**
 * Convenience middleware for school-specific admin routes
 */
export const requireSchoolAdmin = requireAdminAccess({
  allowedRoles: ['admin', 'super_admin'],
  requireSchoolMatch: true,
  auditLog: true,
  customErrorMessage: 'Administrator privileges required for this school'
});

/**
 * Get admin security statistics for monitoring
 */
export async function getAdminSecurityStats(timeframeHours: number = 24): Promise<{
  totalAccesses: number;
  deniedAccesses: number;
  topRoutes: Array<{ route: string; count: number }>;
  securityViolations: number;
  roleBreakdown: Record<string, number>;
}> {
  try {
    const timeframeStart = new Date(Date.now() - (timeframeHours * 60 * 60 * 1000));

    const stats = await databricksService.query(`
      SELECT 
        COUNT(*) as total_accesses,
        SUM(CASE WHEN description LIKE '%ADMIN_ACCESS_DENIED%' THEN 1 ELSE 0 END) as denied_accesses,
        SUM(CASE WHEN description LIKE '%ROUTE_SECURITY_VIOLATION%' THEN 1 ELSE 0 END) as security_violations,
        resource_id as route_path,
        COUNT(*) as access_count
      FROM ${databricksConfig.catalog}.compliance.audit_log
      WHERE event_type = 'admin_route_access' 
        AND event_category = 'compliance'
        AND event_timestamp >= ?
      GROUP BY resource_id
      ORDER BY access_count DESC
      LIMIT 50
    `, [timeframeStart.toISOString()]);

    // Process results (simplified aggregation)
    const result = {
      totalAccesses: 0,
      deniedAccesses: 0,
      topRoutes: [] as Array<{ route: string; count: number }>,
      securityViolations: 0,
      roleBreakdown: {} as Record<string, number>
    };

    // Aggregate basic stats from rows
    for (const row of stats as any[]) {
      result.totalAccesses += Number(row.total_accesses || 0);
      result.deniedAccesses += Number(row.denied_accesses || 0);
      result.securityViolations += Number(row.security_violations || 0);
      result.topRoutes.push({ route: row.route_path, count: Number(row.access_count || 0) });
    }

    // Note: role breakdown unavailable in canonical schema; return empty breakdown
    return result;

  } catch (error) {
    // Gracefully handle missing audit log table
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('TABLE_OR_VIEW_NOT_FOUND')) {
      console.warn('Audit log table not found - returning empty admin security stats (non-critical)');
    } else {
      console.error('Error fetching admin security stats from audit log:', error);
    }
    
    return {
      totalAccesses: 0,
      deniedAccesses: 0,
      topRoutes: [],
      securityViolations: 0,
      roleBreakdown: {}
    };
  }
}
