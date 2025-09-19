import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../types/auth.types';
import { databricksService } from '../services/databricks.service';
import { logger } from '../utils/logger';

/**
 * Enhanced school access validation middleware
 * Platform Stabilization P1 3.3: Complete implementation of school access validation
 */
export async function validateSchoolAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const { schoolId } = req.params;
    const authReq = req as AuthRequest;
    
    if (!schoolId) {
      return res.status(400).json({ 
        success: false,
        error: 'INVALID_REQUEST',
        message: 'School ID is required' 
      });
    }

    if (!authReq.user) {
      return res.status(401).json({ 
        success: false,
        error: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required for school access' 
      });
    }

    // 1. Super admins have access to all schools
    if (authReq.user.role === 'super_admin') {
      const schoolExists = await databricksService.queryOne(
        `SELECT id, name, subscription_status FROM classwaves.users.schools WHERE id = ?`,
        [schoolId]
      );

      if (!schoolExists) {
        return res.status(404).json({
          success: false,
          error: 'SCHOOL_NOT_FOUND',
          message: 'Requested school does not exist'
        });
      }

      // Add school info to request for downstream use
      authReq.targetSchool = schoolExists;
      return next();
    }

    // 2. Regular admins and teachers can only access their own school
    if (authReq.user.school_id !== schoolId) {
      return res.status(403).json({
        success: false,
        error: 'SCHOOL_ACCESS_DENIED',
        message: 'Access denied: User does not belong to the requested school',
        userSchool: authReq.user.school_id,
        requestedSchool: schoolId
      });
    }

    // 3. Validate school exists and is active
    const schoolValidation = await databricksService.queryOne(`
      SELECT id, name, subscription_status, ferpa_agreement, coppa_compliant
      FROM classwaves.users.schools 
      WHERE id = ? AND subscription_status = 'active'
    `, [schoolId]);

    if (!schoolValidation) {
      return res.status(403).json({
        success: false,
        error: 'SCHOOL_INACTIVE',
        message: 'School is not active or does not exist'
      });
    }

    // 4. Validate user's role permissions for the requested operation
    const isWriteOperation = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method);
    
    if (isWriteOperation && authReq.user.role === 'teacher') {
      // Teachers have limited write access - validate specific permissions
      const hasWritePermission = await validateTeacherWritePermissions(
        authReq.user.id, 
        schoolId, 
        req.path, 
        req.method
      );

      if (!hasWritePermission) {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Teacher does not have write permissions for this operation'
        });
      }
    }

    // Add school info to request for downstream use
    authReq.targetSchool = schoolValidation;
    
    logger.debug(`✅ School access validated: ${authReq.user.role} ${authReq.user.id} → school ${schoolId}`);
    next();

  } catch (error) {
    logger.error('Error validating school access:', error);
    res.status(500).json({ 
      success: false,
      error: 'SCHOOL_VALIDATION_ERROR',
      message: 'School access validation failed' 
    });
  }
}

/**
 * Validate teacher write permissions for specific operations
 */
async function validateTeacherWritePermissions(
  teacherId: string,
  schoolId: string,
  requestPath: string,
  method: string
): Promise<boolean> {
  try {
    // Teachers can write to:
    // - Their own sessions and related resources
    // - Student data in their sessions
    // - Their own guidance and analytics data
    
    const allowedPaths = [
      /^\/api\/v1\/sessions($|\/)/,         // Session management
      /^\/api\/v1\/guidance($|\/)/,         // Teacher guidance
      /^\/api\/v1\/transcriptions($|\/)/,   // Session transcriptions
      /^\/api\/v1\/participants($|\/)/      // Participant management in their sessions
    ];

    const isAllowedPath = allowedPaths.some(pattern => pattern.test(requestPath));
    
    if (!isAllowedPath) {
      logger.debug(`⚠️ Teacher ${teacherId} attempted write access to restricted path: ${method} ${requestPath}`);
      return false;
    }

    // Additional validation could be added here for specific resource ownership
    return true;

  } catch (error) {
    logger.error('Error validating teacher write permissions:', error);
    return false;
  }
}