import { Request, Response } from 'express';
import { AuthRequest } from '../types/auth.types';
import { databricksService } from '../services/databricks.service';
import { v4 as uuidv4 } from 'uuid';

/**
 * GET /api/v1/admin/schools
 * List all schools (super admin only)
 */
export async function listSchools(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  console.log('📋 Admin: List Schools endpoint called');
  
  try {
    // Verify super admin access
    if (authReq.user!.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Super admin access required'
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;

    // Get schools with pagination
    const schools = await databricksService.query(`
      SELECT 
        id,
        name,
        domain,
        admin_email,
        subscription_tier,
        subscription_status,
        max_teachers,
        current_teachers,
        subscription_start_date,
        subscription_end_date,
        trial_ends_at,
        ferpa_agreement,
        coppa_compliant,
        data_retention_days,
        created_at,
        updated_at
      FROM classwaves.users.schools
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    // Get total count for pagination
    const countResult = await databricksService.queryOne(`
      SELECT COUNT(*) as total FROM classwaves.users.schools
    `);

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Log audit event
    await databricksService.recordAuditLog({
      actorId: authReq.user!.id,
      actorType: 'admin',
      eventType: 'schools_list_accessed',
      eventCategory: 'data_access',
      resourceType: 'school',
      resourceId: 'all',
      schoolId: authReq.school!.id,
      description: 'Super admin accessed schools list',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    });

    return res.json({
      success: true,
      data: {
        schools,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('❌ Error listing schools:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to retrieve schools'
    });
  }
}

/**
 * POST /api/v1/admin/schools
 * Create a new school (super admin only)
 */
export async function createSchool(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  console.log('🏫 Admin: Create School endpoint called');
  
  try {
    // Verify super admin access
    if (authReq.user!.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Super admin access required'
      });
    }

    const {
      name,
      domain,
      adminEmail,
      subscriptionTier = 'basic',
      subscriptionStatus = 'trial',
      maxTeachers = 10,
      ferpaAgreement = false,
      coppaCompliant = false,
      dataRetentionDays = 2555 // 7 years default
    } = req.body;

    // Check if domain already exists
    const existingSchool = await databricksService.queryOne(`
      SELECT id FROM classwaves.users.schools WHERE domain = ?
    `, [domain]);

    if (existingSchool) {
      return res.status(409).json({
        success: false,
        error: 'DOMAIN_EXISTS',
        message: 'A school with this domain already exists'
      });
    }

    // Create new school
    const schoolId = uuidv4();
    const now = new Date().toISOString();
    const trialEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days trial
    const subscriptionEndDate = subscriptionStatus === 'trial' ? trialEndDate : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    await databricksService.query(`
      INSERT INTO classwaves.users.schools (
        id, name, domain, admin_email,
        subscription_tier, subscription_status, max_teachers,
        current_teachers, subscription_start_date, subscription_end_date,
        trial_ends_at, ferpa_agreement, coppa_compliant,
        data_retention_days, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      schoolId,
      name,
      domain,
      adminEmail,
      subscriptionTier,
      subscriptionStatus,
      maxTeachers,
      0, // current_teachers starts at 0
      now, // subscription_start_date
      subscriptionEndDate,
      subscriptionStatus === 'trial' ? trialEndDate : null,
      ferpaAgreement,
      coppaCompliant,
      dataRetentionDays,
      now,
      now
    ]);

    // Get the created school
    const createdSchool = await databricksService.queryOne(`
      SELECT * FROM classwaves.users.schools WHERE id = ?
    `, [schoolId]);

    // Log audit event
    await databricksService.recordAuditLog({
      actorId: authReq.user!.id,
      actorType: 'admin',
      eventType: 'school_created',
      eventCategory: 'configuration',
      resourceType: 'school',
      resourceId: schoolId,
      schoolId: authReq.school!.id,
      description: `Created new school: ${name} (${domain})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    });

    return res.status(201).json({
      success: true,
      data: {
        school: createdSchool
      }
    });

  } catch (error) {
    console.error('❌ Error creating school:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to create school'
    });
  }
}

/**
 * PUT /api/v1/admin/schools/:id
 * Update a school (super admin only)
 */
export async function updateSchool(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  const schoolId = req.params.id;
  console.log(`🔄 Admin: Update School ${schoolId} endpoint called`);
  
  try {
    // Verify super admin access
    if (authReq.user!.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Super admin access required'
      });
    }

    // Check if school exists
    const existingSchool = await databricksService.queryOne(`
      SELECT * FROM classwaves.users.schools WHERE id = ?
    `, [schoolId]);

    if (!existingSchool) {
      return res.status(404).json({
        success: false,
        error: 'SCHOOL_NOT_FOUND',
        message: 'School not found'
      });
    }

    const {
      name,
      adminEmail,
      subscriptionTier,
      subscriptionStatus,
      maxTeachers,
      ferpaAgreement,
      coppaCompliant,
      dataRetentionDays
    } = req.body;

    // Build update query dynamically based on provided fields
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (adminEmail !== undefined) {
      updateFields.push('admin_email = ?');
      updateValues.push(adminEmail);
    }
    if (subscriptionTier !== undefined) {
      updateFields.push('subscription_tier = ?');
      updateValues.push(subscriptionTier);
    }
    if (subscriptionStatus !== undefined) {
      updateFields.push('subscription_status = ?');
      updateValues.push(subscriptionStatus);
    }
    if (maxTeachers !== undefined) {
      updateFields.push('max_teachers = ?');
      updateValues.push(maxTeachers);
    }
    if (ferpaAgreement !== undefined) {
      updateFields.push('ferpa_agreement = ?');
      updateValues.push(ferpaAgreement);
    }
    if (coppaCompliant !== undefined) {
      updateFields.push('coppa_compliant = ?');
      updateValues.push(coppaCompliant);
    }
    if (dataRetentionDays !== undefined) {
      updateFields.push('data_retention_days = ?');
      updateValues.push(dataRetentionDays);
    }

    // Always update the updated_at field
    updateFields.push('updated_at = ?');
    updateValues.push(new Date().toISOString());

    if (updateFields.length === 1) { // Only updated_at
      return res.status(400).json({
        success: false,
        error: 'NO_UPDATES',
        message: 'No valid fields provided for update'
      });
    }

    // Add school ID for WHERE clause
    updateValues.push(schoolId);

    await databricksService.query(`
      UPDATE classwaves.users.schools 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `, updateValues);

    // Get the updated school
    const updatedSchool = await databricksService.queryOne(`
      SELECT * FROM classwaves.users.schools WHERE id = ?
    `, [schoolId]);

    // Log audit event
    await databricksService.recordAuditLog({
      actorId: authReq.user!.id,
      actorType: 'admin',
      eventType: 'school_updated',
      eventCategory: 'configuration',
      resourceType: 'school',
      resourceId: schoolId,
      schoolId: authReq.school!.id,
      description: `Updated school: ${updatedSchool.name} (${updatedSchool.domain})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    });

    return res.json({
      success: true,
      data: {
        school: updatedSchool
      }
    });

  } catch (error) {
    console.error('❌ Error updating school:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to update school'
    });
  }
}

/**
 * GET /api/v1/admin/teachers
 * List teachers (super admin sees all, regular admin sees their school only)
 */
export async function listTeachers(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  console.log('👥 Admin: List Teachers endpoint called');
  
  try {
    // Check admin access
    if (!['super_admin', 'admin'].includes(authReq.user!.role)) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Admin access required'
      });
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const schoolId = req.query.schoolId as string;

    // Build WHERE clause based on user role
    let whereClause = '';
    let queryParams: any[] = [];

    if (authReq.user!.role === 'super_admin') {
      // Super admin can see all teachers, optionally filtered by school
      if (schoolId) {
        whereClause = 'WHERE t.school_id = ?';
        queryParams = [schoolId];
      }
    } else {
      // Regular admin can only see their school's teachers
      whereClause = 'WHERE t.school_id = ?';
      queryParams = [authReq.school!.id];
    }

    // Get teachers with school info
    const teachers = await databricksService.query(`
      SELECT 
        t.id,
        t.email,
        t.name,
        t.picture,
        t.school_id,
        t.role,
        t.status,
        t.access_level,
        t.max_concurrent_sessions,
        t.current_sessions,
        t.grade,
        t.subject,
        t.timezone,
        t.last_login,
        t.login_count,
        t.total_sessions_created,
        t.created_at,
        t.updated_at,
        s.name as school_name,
        s.domain as school_domain
      FROM classwaves.users.teachers t
      JOIN classwaves.users.schools s ON t.school_id = s.id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `, queryParams);

    // Get total count for pagination
    const countResult = await databricksService.queryOne(`
      SELECT COUNT(*) as total 
      FROM classwaves.users.teachers t
      ${whereClause}
    `, queryParams);

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Log audit event
    await databricksService.recordAuditLog({
      actorId: authReq.user!.id,
      actorType: 'admin',
      eventType: 'teachers_list_accessed',
      eventCategory: 'data_access',
      resourceType: 'teacher',
      resourceId: 'all',
      schoolId: authReq.school!.id,
      description: `Admin accessed teachers list${schoolId ? ` for school ${schoolId}` : ''}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    });

    return res.json({
      success: true,
      data: {
        teachers,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      }
    });

  } catch (error) {
    console.error('❌ Error listing teachers:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to retrieve teachers'
    });
  }
}

/**
 * PUT /api/v1/admin/teachers/:id
 * Update a teacher profile (super admin or school admin only)
 */
export async function updateTeacher(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  const teacherId = req.params.id;
  console.log(`🔄 Admin: Update Teacher ${teacherId} endpoint called`);
  
  try {
    // Check admin access
    if (!['super_admin', 'admin'].includes(authReq.user!.role)) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Admin access required'
      });
    }

    // Check if teacher exists and get their school
    const existingTeacher = await databricksService.queryOne(`
      SELECT * FROM classwaves.users.teachers WHERE id = ?
    `, [teacherId]);

    if (!existingTeacher) {
      return res.status(404).json({
        success: false,
        error: 'TEACHER_NOT_FOUND',
        message: 'Teacher not found'
      });
    }

    // Regular admin can only update teachers in their school
    if (authReq.user!.role === 'admin' && existingTeacher.school_id !== authReq.school!.id) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        message: 'Can only update teachers in your school'
      });
    }

    const {
      name,
      role,
      status,
      accessLevel,
      maxConcurrentSessions,
      grade,
      subject,
      timezone
    } = req.body;

    // Build update query dynamically based on provided fields
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    if (name !== undefined) {
      updateFields.push('name = ?');
      updateValues.push(name);
    }
    if (role !== undefined) {
      // Only super admin can change roles
      if (authReq.user!.role !== 'super_admin') {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_PERMISSIONS',
          message: 'Only super admin can change teacher roles'
        });
      }
      updateFields.push('role = ?');
      updateValues.push(role);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    if (accessLevel !== undefined) {
      updateFields.push('access_level = ?');
      updateValues.push(accessLevel);
    }
    if (maxConcurrentSessions !== undefined) {
      updateFields.push('max_concurrent_sessions = ?');
      updateValues.push(maxConcurrentSessions);
    }
    if (grade !== undefined) {
      updateFields.push('grade = ?');
      updateValues.push(grade);
    }
    if (subject !== undefined) {
      updateFields.push('subject = ?');
      updateValues.push(subject);
    }
    if (timezone !== undefined) {
      updateFields.push('timezone = ?');
      updateValues.push(timezone);
    }

    // Always update the updated_at field
    updateFields.push('updated_at = ?');
    updateValues.push(new Date().toISOString());

    if (updateFields.length === 1) { // Only updated_at
      return res.status(400).json({
        success: false,
        error: 'NO_UPDATES',
        message: 'No valid fields provided for update'
      });
    }

    // Add teacher ID for WHERE clause
    updateValues.push(teacherId);

    await databricksService.query(`
      UPDATE classwaves.users.teachers 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `, updateValues);

    // Get the updated teacher
    const updatedTeacher = await databricksService.queryOne(`
      SELECT 
        t.*,
        s.name as school_name,
        s.domain as school_domain
      FROM classwaves.users.teachers t
      JOIN classwaves.users.schools s ON t.school_id = s.id
      WHERE t.id = ?
    `, [teacherId]);

    // Log audit event
    await databricksService.recordAuditLog({
      actorId: authReq.user!.id,
      actorType: 'admin',
      eventType: 'teacher_updated',
      eventCategory: 'configuration',
      resourceType: 'teacher',
      resourceId: teacherId,
      schoolId: authReq.school!.id,
      description: `Updated teacher ID: ${updatedTeacher.id}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    });

    return res.json({
      success: true,
      data: {
        teacher: updatedTeacher
      }
    });

  } catch (error) {
    console.error('❌ Error updating teacher:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to update teacher'
    });
  }
}
