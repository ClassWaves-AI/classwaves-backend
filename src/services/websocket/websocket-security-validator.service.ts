/**
 * WebSocket Security Validator Service
 * 
 * Platform Stabilization P1 3.2: Secure WebSocket namespace isolation and validate 
 * authentication at namespace level with comprehensive security controls.
 */

import { Socket } from 'socket.io';
import { databricksService } from '../databricks.service';
import { redisService } from '../redis.service';
import { logger } from '../../utils/logger';
import { isLocalDbEnabled } from '../../config/feature-flags';
import { getCompositionRoot } from '../../app/composition-root';

export interface SecurityContext {
  userId: string;
  role: 'teacher' | 'student' | 'admin' | 'super_admin';
  schoolId?: string;
  sessionId?: string;
  authenticatedAt: Date;
  ipAddress: string;
  userAgent: string;
}

export interface NamespaceSecurityConfig {
  allowedRoles: Array<'teacher' | 'student' | 'admin' | 'super_admin'>;
  requireSchoolVerification: boolean;
  requireSessionAccess: boolean;
  maxConnectionsPerUser: number;
  rateLimitWindow: number; // seconds
  rateLimitMaxRequests: number;
}

export interface SecurityValidationResult {
  allowed: boolean;
  reason?: string;
  errorCode?: string;
  metadata?: Record<string, any>;
}

export class WebSocketSecurityValidator {
  private readonly NAMESPACE_CONFIGS: Record<string, NamespaceSecurityConfig> = {
    '/sessions': {
      allowedRoles: ['teacher', 'admin', 'super_admin', 'student'],
      requireSchoolVerification: true,
      requireSessionAccess: false,
      maxConnectionsPerUser: process.env.NODE_ENV === 'development' ? 50 : 5, // Higher limit for dev
      rateLimitWindow: 60,
      rateLimitMaxRequests: 100
    },
    '/guidance': {
      allowedRoles: ['teacher', 'admin', 'super_admin'],
      requireSchoolVerification: true,
      requireSessionAccess: false,
      maxConnectionsPerUser: 3, // More restrictive for guidance
      rateLimitWindow: 60,
      rateLimitMaxRequests: 50
    },
    '/admin': {
      allowedRoles: ['admin', 'super_admin'],
      requireSchoolVerification: false, // Admins can access cross-school
      requireSessionAccess: false,
      maxConnectionsPerUser: 2,
      rateLimitWindow: 60,
      rateLimitMaxRequests: 200
    }
  };

  /**
   * Validate namespace access with comprehensive security checks
   */
  async validateNamespaceAccess(
    socket: Socket,
    namespaceName: string,
    securityContext: SecurityContext
  ): Promise<SecurityValidationResult> {
    const config = this.NAMESPACE_CONFIGS[namespaceName];
    
    if (!config) {
      await this.logSecurityEvent(socket, securityContext, 'INVALID_NAMESPACE', {
        namespaceName,
        severity: 'HIGH'
      });
      return {
        allowed: false,
        reason: `Namespace ${namespaceName} is not configured`,
        errorCode: 'INVALID_NAMESPACE'
      };
    }

    // 1. Role-based access control
    const roleCheck = this.validateRoleAccess(securityContext.role, config);
    if (!roleCheck.allowed) {
      await this.logSecurityEvent(socket, securityContext, 'ROLE_ACCESS_DENIED', {
        namespaceName,
        requiredRoles: config.allowedRoles,
        userRole: securityContext.role,
        severity: 'MEDIUM'
      });
      return roleCheck;
    }

    // 2. Connection limit enforcement
    const connectionCheck = await this.validateConnectionLimits(socket, securityContext, config, namespaceName);
    if (!connectionCheck.allowed) {
      await this.logSecurityEvent(socket, securityContext, 'CONNECTION_LIMIT_EXCEEDED', {
        namespaceName,
        maxConnections: config.maxConnectionsPerUser,
        severity: 'MEDIUM'
      });
      return connectionCheck;
    }

    // 3. Rate limiting
    const rateLimitCheck = await this.validateRateLimit(securityContext, config, namespaceName);
    if (!rateLimitCheck.allowed) {
      await this.logSecurityEvent(socket, securityContext, 'RATE_LIMIT_EXCEEDED', {
        namespaceName,
        rateLimitWindow: config.rateLimitWindow,
        rateLimitMax: config.rateLimitMaxRequests,
        severity: 'LOW'
      });
      return rateLimitCheck;
    }

    // 4. School verification (if required)
    if (config.requireSchoolVerification && securityContext.schoolId) {
      const schoolCheck = await this.validateSchoolAccess(securityContext);
      if (!schoolCheck.allowed) {
        await this.logSecurityEvent(socket, securityContext, 'SCHOOL_ACCESS_DENIED', {
          namespaceName,
          schoolId: securityContext.schoolId,
          severity: 'HIGH'
        });
        return schoolCheck;
      }
    }

    // 5. Log successful access
    await this.logSecurityEvent(socket, securityContext, 'NAMESPACE_ACCESS_GRANTED', {
      namespaceName,
      severity: 'INFO'
    });

    return { allowed: true };
  }

  /**
   * Validate role-based access to namespace
   */
  private validateRoleAccess(
    userRole: string,
    config: NamespaceSecurityConfig
  ): SecurityValidationResult {
    if (!config.allowedRoles.includes(userRole as any)) {
      return {
        allowed: false,
        reason: `Role '${userRole}' is not allowed in this namespace`,
        errorCode: 'ROLE_ACCESS_DENIED',
        metadata: {
          allowedRoles: config.allowedRoles,
          userRole
        }
      };
    }

    return { allowed: true };
  }

  /**
   * Validate connection limits per user
   */
  private async validateConnectionLimits(
    socket: Socket,
    securityContext: SecurityContext,
    config: NamespaceSecurityConfig,
    namespaceName: string
  ): Promise<SecurityValidationResult> {
    try {
      // Authoritative: count active sockets for this user across the namespace (cluster-aware with Redis adapter)
      const sockets = await socket.nsp.fetchSockets();
      const activeForUser = sockets.filter((s) => (s.data as any)?.userId === securityContext.userId).length;

      if (activeForUser >= config.maxConnectionsPerUser) {
        return {
          allowed: false,
          reason: `Maximum connections exceeded (${activeForUser}/${config.maxConnectionsPerUser})`,
          errorCode: 'CONNECTION_LIMIT_EXCEEDED',
          metadata: {
            currentConnections: activeForUser,
            maxConnections: config.maxConnectionsPerUser
          }
        };
      }

      // Optionally mirror count in Redis for monitoring (non-blocking)
      try {
        const connectionKey = `websocket_connections:${namespaceName}:${securityContext.userId}`;
        await redisService.set(connectionKey, String(activeForUser + 1), 3600);
      } catch (e) {
        // Monitoring only; ignore errors
      }

      return { allowed: true };
    } catch (error) {
      logger.error('Error validating connection limits via adapter enumeration:', error);
      // Fail open to avoid blocking legitimate connections due to adapter errors
      return { allowed: true };
    }
  }

  /**
   * Validate rate limiting
   */
  private async validateRateLimit(
    securityContext: SecurityContext,
    config: NamespaceSecurityConfig,
    namespaceName: string
  ): Promise<SecurityValidationResult> {
    const rateLimitKey = `rate_limit:${namespaceName}:${securityContext.userId}`;
    
    try {
      const currentRequests = await redisService.get(rateLimitKey);
      const requestCount = currentRequests ? parseInt(currentRequests, 10) : 0;

      if (requestCount >= config.rateLimitMaxRequests) {
        return {
          allowed: false,
          reason: `Rate limit exceeded (${requestCount}/${config.rateLimitMaxRequests} requests per ${config.rateLimitWindow}s)`,
          errorCode: 'RATE_LIMIT_EXCEEDED',
          metadata: {
            currentRequests: requestCount,
            maxRequests: config.rateLimitMaxRequests,
            windowSeconds: config.rateLimitWindow
          }
        };
      }

      // Increment request count
      if (requestCount === 0) {
        await redisService.set(rateLimitKey, '1', config.rateLimitWindow);
      } else {
        await redisService.getClient().incr(rateLimitKey);
      }

      return { allowed: true };

    } catch (error) {
      logger.error('Error validating rate limit:', error);
      // Fail open for Redis errors
      return { allowed: true };
    }
  }

  /**
   * Validate school access and membership
   */
  private async validateSchoolAccess(
    securityContext: SecurityContext
  ): Promise<SecurityValidationResult> {
    if (!securityContext.schoolId) {
      return { allowed: true }; // Skip if no school context
    }

    try {
      const composition = getCompositionRoot();
      const provider = composition.getDbProvider();

      if (provider === 'postgres') {
        const db = composition.getDbPort();

        if (securityContext.role === 'teacher' || securityContext.role === 'admin' || securityContext.role === 'super_admin') {
          const teacherRow = await db.queryOne(
            `SELECT id FROM users.teachers WHERE id = ? AND school_id = ? LIMIT 1`,
            [securityContext.userId, securityContext.schoolId]
          );

          if (!teacherRow) {
            return {
              allowed: false,
              reason: `Teacher ${securityContext.userId} is not associated with school ${securityContext.schoolId}`,
              errorCode: 'SCHOOL_ACCESS_DENIED',
              metadata: {
                userId: securityContext.userId,
                schoolId: securityContext.schoolId,
                role: securityContext.role,
                provider,
              },
            };
          }
        } else {
          const studentRow = await db.queryOne(
            `SELECT sgm.student_id
             FROM sessions.student_group_members sgm
             JOIN sessions.classroom_sessions cs ON cs.id = sgm.session_id
             WHERE sgm.student_id = ? AND cs.school_id = ?
             LIMIT 1`,
            [securityContext.userId, securityContext.schoolId]
          );

          if (!studentRow) {
            return {
              allowed: false,
              reason: `Student ${securityContext.userId} is not associated with school ${securityContext.schoolId}`,
              errorCode: 'SCHOOL_ACCESS_DENIED',
              metadata: {
                userId: securityContext.userId,
                schoolId: securityContext.schoolId,
                role: securityContext.role,
                provider,
              },
            };
          }
        }

        return { allowed: true };
      }

      let userQuery: string;
      if (securityContext.role === 'teacher' || securityContext.role === 'admin' || securityContext.role === 'super_admin') {
        userQuery = `
          SELECT t.id, t.school_id, s.subscription_status 
          FROM classwaves.users.teachers t
          JOIN classwaves.users.schools s ON t.school_id = s.id
          WHERE t.id = ? AND t.school_id = ? AND t.status = 'active' AND s.subscription_status = 'active'
        `;
      } else {
        // For students, check via active session participation
        userQuery = `
          SELECT p.student_id, cs.school_id
          FROM classwaves.sessions.participants p
          JOIN classwaves.sessions.classroom_sessions cs ON p.session_id = cs.id
          WHERE p.student_id = ? AND cs.school_id = ? AND p.is_active = true
          LIMIT 1
        `;
      }

      const userSchoolAccess = await databricksService.queryOne(userQuery, [
        securityContext.userId,
        securityContext.schoolId
      ]);

      if (!userSchoolAccess) {
        return {
          allowed: false,
          reason: `User does not have access to school ${securityContext.schoolId}`,
          errorCode: 'SCHOOL_ACCESS_DENIED',
          metadata: {
            userId: securityContext.userId,
            schoolId: securityContext.schoolId,
            role: securityContext.role
          }
        };
      }

      return { allowed: true };

    } catch (error) {
      logger.error('Error validating school access:', error);
      return {
        allowed: false,
        reason: 'School access validation failed',
        errorCode: 'SCHOOL_VALIDATION_ERROR'
      };
    }
  }

  /**
   * Validate session-specific access
   */
  async validateSessionAccess(
    securityContext: SecurityContext,
    sessionId: string
  ): Promise<SecurityValidationResult> {
    try {
      if (securityContext.role === 'teacher' || securityContext.role === 'admin' || securityContext.role === 'super_admin') {
        // Teachers/admins can access sessions they own or in their school, super_admin can access any session
        let sessionQuery = `
          SELECT id, teacher_id, school_id, status
          FROM classwaves.sessions.classroom_sessions
          WHERE id = ? AND status IN ('scheduled', 'active', 'paused')
        `;
        let queryParams = [sessionId];
        
        if (securityContext.role !== 'super_admin') {
          sessionQuery += ` AND (teacher_id = ? OR school_id = ?)`;
          queryParams.push(securityContext.userId, securityContext.schoolId || '');
        }
        
        const sessionAccess = await databricksService.queryOne(sessionQuery, queryParams);

        if (!sessionAccess) {
          return {
            allowed: false,
            reason: `No access to session ${sessionId}`,
            errorCode: 'SESSION_ACCESS_DENIED'
          };
        }

      } else if (securityContext.role === 'student') {
        // Students can only access sessions they're enrolled in
        const participantAccess = await databricksService.queryOne(`
          SELECT p.id, p.session_id
          FROM classwaves.sessions.participants p
          JOIN classwaves.sessions.classroom_sessions cs ON p.session_id = cs.id
          WHERE p.session_id = ? AND p.student_id = ? AND p.is_active = true
          AND cs.status IN ('active', 'paused')
        `, [sessionId, securityContext.userId]);

        if (!participantAccess) {
          return {
            allowed: false,
            reason: `Student not enrolled in session ${sessionId}`,
            errorCode: 'SESSION_ENROLLMENT_REQUIRED'
          };
        }
      }

      return { allowed: true };

    } catch (error) {
      logger.error('Error validating session access:', error);
      return {
        allowed: false,
        reason: 'Session access validation failed',
        errorCode: 'SESSION_VALIDATION_ERROR'
      };
    }
  }

  /**
   * Log security events for monitoring and audit
   */
  private async logSecurityEvent(
    socket: Socket,
    securityContext: SecurityContext,
    eventType: string,
    metadata: Record<string, any>
  ): Promise<void> {
    const securityEvent = {
      id: `ws_security_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      event_type: eventType,
      user_id: securityContext.userId,
      user_role: securityContext.role,
      ip_address: securityContext.ipAddress,
      user_agent: securityContext.userAgent,
      namespace_name: metadata.namespaceName,
      timestamp: new Date().toISOString(),
      severity: metadata.severity || 'INFO',
      metadata: JSON.stringify(metadata)
    };

    try {
      // Store in audit log (async, don't block)
      setImmediate(async () => {
        try {
          const { auditLogPort } = await import('../../utils/audit.port.instance');
          auditLogPort.enqueue({
            actorId: securityEvent.user_id,
            actorType: 'system',
            eventType: 'websocket_security',
            eventCategory: 'compliance',
            resourceType: 'websocket_connection',
            resourceId: securityEvent.namespace_name || 'unknown',
            schoolId: securityContext.schoolId || 'unknown',
            description: `ws security ${securityEvent.event_type} ${securityEvent.namespace_name}`,
            ipAddress: securityEvent.ip_address,
            userAgent: securityEvent.user_agent,
            complianceBasis: 'legitimate_interest',
          }).catch(() => {});
        } catch (error) {
          // swallow
        }
      });

      // Also store in Redis for real-time monitoring
      const redisKey = `websocket_security_events:${eventType}:${securityContext.userId}`;
      await redisService.set(redisKey, JSON.stringify(securityEvent), 86400); // 24 hour TTL

    } catch (error) {
      logger.error('Error logging WebSocket security event:', error);
    }
  }

  /**
   * Get security configuration for namespace
   */
  getNamespaceConfig(namespaceName: string): NamespaceSecurityConfig | null {
    return this.NAMESPACE_CONFIGS[namespaceName] || null;
  }

  /**
   * Update connection count on disconnect
   */
  async handleDisconnection(
    securityContext: SecurityContext,
    namespaceName: string
  ): Promise<void> {
    const connectionKey = `websocket_connections:${namespaceName}:${securityContext.userId}`;
    
    try {
      const currentConnections = await redisService.get(connectionKey);
      const connectionCount = currentConnections ? parseInt(currentConnections, 10) : 0;
      
      if (connectionCount > 1) {
        await redisService.set(connectionKey, (connectionCount - 1).toString(), 3600);
      } else {
        await redisService.getClient().del(connectionKey);
      }

      await this.logSecurityEvent(
        {} as Socket, // No socket on disconnect
        securityContext,
        'NAMESPACE_DISCONNECTION',
        {
          namespaceName,
          remainingConnections: Math.max(0, connectionCount - 1),
          severity: 'INFO'
        }
      );

    } catch (error) {
      logger.error('Error handling WebSocket disconnection:', error);
    }
  }
}

// Singleton instance for global use
export const webSocketSecurityValidator = new WebSocketSecurityValidator();
