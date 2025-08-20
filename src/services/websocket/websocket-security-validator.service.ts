/**
 * WebSocket Security Validator Service
 * 
 * Platform Stabilization P1 3.2: Secure WebSocket namespace isolation and validate 
 * authentication at namespace level with comprehensive security controls.
 */

import { Socket } from 'socket.io';
import { databricksService } from '../databricks.service';
import { redisService } from '../redis.service';

export interface SecurityContext {
  userId: string;
  role: 'teacher' | 'student' | 'admin';
  schoolId?: string;
  sessionId?: string;
  authenticatedAt: Date;
  ipAddress: string;
  userAgent: string;
}

export interface NamespaceSecurityConfig {
  allowedRoles: Array<'teacher' | 'student' | 'admin'>;
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
      allowedRoles: ['teacher', 'student'],
      requireSchoolVerification: true,
      requireSessionAccess: false,
      maxConnectionsPerUser: 5, // Allow multiple tabs/devices
      rateLimitWindow: 60,
      rateLimitMaxRequests: 100
    },
    '/guidance': {
      allowedRoles: ['teacher', 'admin'],
      requireSchoolVerification: true,
      requireSessionAccess: false,
      maxConnectionsPerUser: 3, // More restrictive for guidance
      rateLimitWindow: 60,
      rateLimitMaxRequests: 50
    },
    '/admin': {
      allowedRoles: ['admin'],
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
    const connectionCheck = await this.validateConnectionLimits(securityContext, config, namespaceName);
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
    securityContext: SecurityContext,
    config: NamespaceSecurityConfig,
    namespaceName: string
  ): Promise<SecurityValidationResult> {
    const connectionKey = `websocket_connections:${namespaceName}:${securityContext.userId}`;
    
    try {
      const currentConnections = await redisService.get(connectionKey);
      const connectionCount = currentConnections ? parseInt(currentConnections, 10) : 0;

      if (connectionCount >= config.maxConnectionsPerUser) {
        return {
          allowed: false,
          reason: `Maximum connections exceeded (${connectionCount}/${config.maxConnectionsPerUser})`,
          errorCode: 'CONNECTION_LIMIT_EXCEEDED',
          metadata: {
            currentConnections: connectionCount,
            maxConnections: config.maxConnectionsPerUser
          }
        };
      }

      // Increment connection count with expiration
      await redisService.setex(connectionKey, 3600, (connectionCount + 1).toString()); // 1 hour TTL
      return { allowed: true };

    } catch (error) {
      console.error('Error validating connection limits:', error);
      // Fail open for Redis errors to avoid blocking legitimate connections
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
        await redisService.setex(rateLimitKey, config.rateLimitWindow, '1');
      } else {
        await redisService.incr(rateLimitKey);
      }

      return { allowed: true };

    } catch (error) {
      console.error('Error validating rate limit:', error);
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
      let userQuery: string;
      if (securityContext.role === 'teacher' || securityContext.role === 'admin') {
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
      console.error('Error validating school access:', error);
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
      if (securityContext.role === 'teacher' || securityContext.role === 'admin') {
        // Teachers can access sessions they own or in their school
        const sessionAccess = await databricksService.queryOne(`
          SELECT id, teacher_id, school_id, status
          FROM classwaves.sessions.classroom_sessions
          WHERE id = ? AND (teacher_id = ? OR school_id = ?)
          AND status IN ('scheduled', 'active', 'paused')
        `, [sessionId, securityContext.userId, securityContext.schoolId || '']);

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
      console.error('Error validating session access:', error);
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
          await databricksService.insert('classwaves.security.websocket_security_events', securityEvent);
        } catch (error) {
          console.error('Failed to log WebSocket security event:', error);
        }
      });

      // Also store in Redis for real-time monitoring
      const redisKey = `websocket_security_events:${eventType}:${securityContext.userId}`;
      await redisService.setex(redisKey, 86400, JSON.stringify(securityEvent)); // 24 hour TTL

    } catch (error) {
      console.error('Error logging WebSocket security event:', error);
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
        await redisService.setex(connectionKey, 3600, (connectionCount - 1).toString());
      } else {
        await redisService.del(connectionKey);
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
      console.error('Error handling WebSocket disconnection:', error);
    }
  }
}

// Singleton instance for global use
export const webSocketSecurityValidator = new WebSocketSecurityValidator();
