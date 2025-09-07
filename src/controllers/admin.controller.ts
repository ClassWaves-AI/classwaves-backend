import { Request, Response } from 'express';
import { AuthRequest } from '../types/auth.types';
import { getCompositionRoot } from '../app/composition-root';
import { redisService } from '../services/redis.service';
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

    const adminRepo = getCompositionRoot().getAdminRepository();
    const schools = await adminRepo.listSchools(limit, offset);
    const total = await adminRepo.countSchools();

    
    const totalPages = Math.ceil(total / limit);

    // Log audit event (async, fire-and-forget)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: authReq.user!.id,
      actorType: 'admin',
      eventType: 'schools_list_accessed',
      eventCategory: 'data_access',
      resourceType: 'school',
      resourceId: 'all',
      schoolId: authReq.school!.id,
      description: 'super_admin accessed schools list',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    }).catch(() => {});

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

    const adminRepo = getCompositionRoot().getAdminRepository();
    const existingSchool = await adminRepo.findSchoolByDomain(domain);

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

    await adminRepo.insertSchool({
      id: schoolId,
      name,
      domain,
      admin_email: adminEmail,
      subscription_tier: subscriptionTier,
      subscription_status: subscriptionStatus,
      max_teachers: maxTeachers,
      current_teachers: 0,
      subscription_start_date: now,
      subscription_end_date: subscriptionEndDate,
      trial_ends_at: subscriptionStatus === 'trial' ? trialEndDate : null,
      ferpa_agreement: ferpaAgreement,
      coppa_compliant: coppaCompliant,
      data_retention_days: dataRetentionDays,
      created_at: now,
      updated_at: now,
    });

    // Get the created school
    const createdSchool = await adminRepo.getSchoolSummaryById(schoolId);

    // Log audit event (async, fire-and-forget)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: authReq.user!.id,
      actorType: 'admin',
      eventType: 'school_created',
      eventCategory: 'configuration',
      resourceType: 'school',
      resourceId: schoolId,
      schoolId: authReq.school!.id,
      description: `created school id=${schoolId}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    }).catch(() => {});

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

    const adminRepo = getCompositionRoot().getAdminRepository();
    const existingSchool = await adminRepo.getSchoolSummaryById(schoolId);

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

    const fieldsMap = Object.fromEntries(updateFields.map((f, i) => [f.replace(' = ?', ''), updateValues[i]]));
    await adminRepo.updateSchoolById(schoolId, fieldsMap);

    // Get the updated school
    const updatedSchool = await adminRepo.getSchoolSummaryById(schoolId);

    // Log audit event (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: authReq.user!.id,
      actorType: 'admin',
      eventType: 'school_updated',
      eventCategory: 'configuration',
      resourceType: 'school',
      resourceId: schoolId,
      schoolId: authReq.school!.id,
      description: `updated school id=${schoolId}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    }).catch(() => {});

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
 * GET /api/v1/admin/slis/prompt-delivery
 * Surface per-session prompt delivery SLIs from Redis (low-cardinality counters)
 * Query params:
 *  - sessionId: string (required)
 *  - tier: 'tier1' | 'tier2' (optional; default both)
 */
export async function getPromptDeliverySLI(req: Request, res: Response): Promise<Response> {
  try {
    const sessionId = String(req.query.sessionId || '').trim();
    const tierParam = (req.query.tier as string | undefined)?.trim();
    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'INVALID_REQUEST', message: 'sessionId is required' });
    }
    const tiers = tierParam === 'tier1' || tierParam === 'tier2' ? [tierParam] : ['tier1', 'tier2'];
    const client = redisService.getClient();
    const metrics: any = {};
    for (const tier of tiers) {
      const deliveredKey = `sli:prompt_delivery:session:${sessionId}:${tier}:delivered`;
      const noSubKey = `sli:prompt_delivery:session:${sessionId}:${tier}:no_subscriber`;
      const delivered = parseInt((await client.get(deliveredKey)) || '0', 10);
      const noSubscriber = parseInt((await client.get(noSubKey)) || '0', 10);
      metrics[tier] = { delivered, no_subscriber: noSubscriber };
    }
    return res.json({ success: true, data: { sessionId, metrics } });
  } catch (error) {
    console.error('❌ Error getting prompt delivery SLI:', error);
    return res.status(500).json({ success: false, error: 'INTERNAL_ERROR', message: 'Failed to retrieve SLIs' });
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

    const adminRepo = getCompositionRoot().getAdminRepository();
    const teachers = await adminRepo.listTeachers({ schoolId: queryParams[0] }, limit, offset);
    const total = await adminRepo.countTeachers({ schoolId: queryParams[0] });

    
    const totalPages = Math.ceil(total / limit);

    // Log audit event (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: authReq.user!.id,
      actorType: 'admin',
      eventType: 'teachers_list_accessed',
      eventCategory: 'data_access',
      resourceType: 'teacher',
      resourceId: 'all',
      schoolId: authReq.school!.id,
      description: `admin accessed teachers list${schoolId ? ` for school ${schoolId}` : ''}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    }).catch(() => {});

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
    const adminRepo = getCompositionRoot().getAdminRepository();
    const existingTeacher = await adminRepo.getTeacherSummaryById(teacherId);

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

    const fieldsMap = Object.fromEntries(updateFields.map((f, i) => [f.replace(' = ?', ''), updateValues[i]]));
    await adminRepo.updateTeacherById(teacherId, fieldsMap);

    // Get the updated teacher
    const updatedTeacher = await adminRepo.getTeacherSummaryById(teacherId);
    if (!updatedTeacher) {
      return res.status(500).json({
        success: false,
        error: 'TEACHER_UPDATE_FAILED',
        message: 'Teacher was updated but could not be retrieved'
      });
    }

    // Log audit event (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: authReq.user!.id,
      actorType: 'admin',
      eventType: 'teacher_updated',
      eventCategory: 'configuration',
      resourceType: 'teacher',
      resourceId: teacherId,
      schoolId: authReq.school!.id,
      description: `updated teacher id=${updatedTeacher.id}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    }).catch(() => {});

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
