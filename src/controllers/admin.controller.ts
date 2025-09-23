import { Request, Response } from 'express';
import { AuthRequest } from '../types/auth.types';
import { getCompositionRoot } from '../app/composition-root';
import { redisService } from '../services/redis.service';
import { v4 as uuidv4 } from 'uuid';
import { ok, fail, ErrorCodes } from '../utils/api-response';
import { validateSchoolDomain } from '../utils/validation.schemas';
import { logger } from '../utils/logger';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';

/**
 * GET /api/v1/admin/schools
 * List all schools (super admin only)
 */
export async function listSchools(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  logger.debug('📋 Admin: List Schools endpoint called');
  
  try {
    // Verify super admin access
    if (authReq.user!.role !== 'super_admin') {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Super admin access required', 403);
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

    return ok(res, {
      schools,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });

  } catch (error) {
    logger.error('❌ Error listing schools:', error);
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to retrieve schools', 500);
  }
}

/**
 * POST /api/v1/admin/schools
 * Create a new school (super admin only)
 */
export async function createSchool(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  logger.debug('🏫 Admin: Create School endpoint called');
  
  try {
    // Verify super admin access
    if (authReq.user!.role !== 'super_admin') {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Super admin access required', 403);
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
      return fail(res, ErrorCodes.ALREADY_EXISTS, 'A school with this domain already exists', 409);
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

    return ok(res, { school: createdSchool }, 201);

  } catch (error) {
    logger.error('❌ Error creating school:', error);
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to create school', 500);
  }
}

/**
 * PUT /api/v1/admin/schools/:id
 * Update a school (super admin only)
 */
export async function updateSchool(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  const schoolId = req.params.id;
  logger.debug(`🔄 Admin: Update School ${schoolId} endpoint called`);
  
  try {
    // Verify super admin access
    if (authReq.user!.role !== 'super_admin') {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Super admin access required', 403);
    }

    const adminRepo = getCompositionRoot().getAdminRepository();
    const existingSchool = await adminRepo.getSchoolSummaryById(schoolId);

    if (!existingSchool) {
      return fail(res, ErrorCodes.NOT_FOUND, 'School not found', 404);
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
      return fail(res, ErrorCodes.INVALID_INPUT, 'No valid fields provided for update', 400);
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

    return ok(res, { school: updatedSchool });

  } catch (error) {
    logger.error('❌ Error updating school:', error);
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to update school', 500);
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
      return fail(res, ErrorCodes.MISSING_REQUIRED_FIELD, 'sessionId is required', 400);
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
    return ok(res, { sessionId, metrics });
  } catch (error) {
    logger.error('❌ Error getting prompt delivery SLI:', error);
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to retrieve SLIs', 500);
  }
}

/**
 * GET /api/v1/admin/teachers
 * List teachers (super admin sees all, regular admin sees their school only)
 */
export async function listTeachers(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  logger.debug('👥 Admin: List Teachers endpoint called');
  
  try {
    // Check admin access
    if (!['super_admin', 'admin'].includes(authReq.user!.role)) {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Admin access required', 403);
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const schoolId = req.query.schoolId as string;

    // Resolve target school scope for queries
    const targetSchoolId = authReq.user!.role === 'super_admin' ? schoolId : authReq.school!.id;
    const filters = targetSchoolId ? { schoolId: targetSchoolId } : {};

    const adminRepo = getCompositionRoot().getAdminRepository();
    const teachers = await adminRepo.listTeachers(filters, limit, offset);
    const total = await adminRepo.countTeachers(filters);

    
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

    return ok(res, {
      teachers,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });

  } catch (error) {
    logger.error('❌ Error listing teachers:', error);
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to retrieve teachers', 500);
  }
}

/**
 * PUT /api/v1/admin/teachers/:id
 * Update a teacher profile (super admin or school admin only)
 */
export async function updateTeacher(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  const teacherId = req.params.id;
  logger.debug(`🔄 Admin: Update Teacher ${teacherId} endpoint called`);
  
  try {
    // Check admin access
    if (!['super_admin', 'admin'].includes(authReq.user!.role)) {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Admin access required', 403);
    }

    // Check if teacher exists and get their school
    const adminRepo = getCompositionRoot().getAdminRepository();
    const existingTeacher = await adminRepo.getTeacherSummaryById(teacherId);

    if (!existingTeacher) {
      return fail(res, ErrorCodes.NOT_FOUND, 'Teacher not found', 404);
    }

    // Regular admin can only update teachers in their school
    if (authReq.user!.role === 'admin' && existingTeacher.school_id !== authReq.school!.id) {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Can only update teachers in your school', 403);
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
        return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Only super admin can change teacher roles', 403);
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
      return fail(res, ErrorCodes.INVALID_INPUT, 'No valid fields provided for update', 400);
    }

    // Add teacher ID for WHERE clause
    updateValues.push(teacherId);

    const fieldsMap = Object.fromEntries(updateFields.map((f, i) => [f.replace(' = ?', ''), updateValues[i]]));
    await adminRepo.updateTeacherById(teacherId, fieldsMap);

    // Get the updated teacher
    const updatedTeacher = await adminRepo.getTeacherSummaryById(teacherId);
    if (!updatedTeacher) {
      return fail(res, ErrorCodes.INTERNAL_ERROR, 'Teacher was updated but could not be retrieved', 500);
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

    return ok(res, { teacher: updatedTeacher });

  } catch (error) {
    logger.error('❌ Error updating teacher:', error);
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to update teacher', 500);
  }
}

/**
 * POST /api/v1/admin/teachers/invite
 * Issue an invite token for a teacher (admin can invite within their school, super_admin can specify any school)
 */
export async function inviteTeacher(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  try {
    const { email, role = 'teacher', schoolId } = req.body as { email: string; role?: string; schoolId?: string };

    // role guard: only super_admin may invite admin role
    if (role !== 'teacher' && authReq.user!.role !== 'super_admin') {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Only super admin can invite admin users', 403);
    }

    const adminRepo = getCompositionRoot().getAdminRepository();

    // Select target school id
    let targetSchoolId = authReq.school!.id;
    if (authReq.user!.role === 'super_admin') {
      if (!schoolId) return fail(res, ErrorCodes.MISSING_REQUIRED_FIELD, 'schoolId is required for super admin invites', 400);
      targetSchoolId = schoolId;
    }

    // Validate email domain (no personal domains; if admin, must match their school's domain)
    const domain = validateSchoolDomain(email);
    if (!domain) {
      return fail(res, ErrorCodes.INVALID_INPUT, 'Invalid or personal email domain is not allowed', 400);
    }
    if (authReq.user!.role === 'admin') {
      const school = await adminRepo.getSchoolSummaryById(targetSchoolId);
      if (school?.domain && school.domain.toLowerCase() !== domain.toLowerCase()) {
        return fail(res, ErrorCodes.INVALID_INPUT, 'Email domain must match your school domain', 400, { expected: school.domain });
      }
    }

    // Ensure teacher does not already exist
    const existing = await adminRepo.findTeacherByEmail?.(email);
    if (existing) {
      return fail(res, ErrorCodes.ALREADY_EXISTS, 'A teacher with this email already exists', 409);
    }

    // Create invite token and store in Redis with TTL (7 days)
    const token = uuidv4();
    const key = `invite:teacher:${token}`;
    const payload = {
      email,
      role,
      schoolId: targetSchoolId,
      issuedBy: authReq.user!.id,
      issuedByRole: authReq.user!.role,
      issuedAt: new Date().toISOString(),
      version: 1,
    };
    const client = redisService.getClient();
    const ttlDays = parseInt(process.env.INVITE_TTL_DAYS || '7', 10);
    await (client as any).setex(key, ttlDays * 24 * 60 * 60, JSON.stringify(payload));

    // Audit (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort
      .enqueue({
        actorId: authReq.user!.id,
        actorType: 'admin',
        eventType: 'teacher_invite_issued',
        eventCategory: 'configuration',
        resourceType: 'teacher_invite',
        resourceId: token,
        schoolId: targetSchoolId,
        description: 'Teacher invite issued',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        complianceBasis: 'legitimate_interest',
      })
      .catch(() => {});

    // Do not leak PII in logs
    logger.info('Teacher invite created', { token, schoolId: targetSchoolId, role });

    // In non-production, return the token to ease local/dev onboarding
    if (process.env.NODE_ENV !== 'production') {
      return ok(res, { inviteToken: token, message: 'Invite token created (dev only response)' }, 201);
    }
    return ok(res, { issued: true }, 201);
  } catch (error) {
    logger.error('❌ Error issuing teacher invite:', error);
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to issue teacher invite', 500);
  }
}

/**
 * GET /api/v1/admin/invites/:token/verify
 * Validates invite token, returns non-PII metadata (role, school summary)
 */
export async function verifyInvite(req: Request, res: Response): Promise<Response> {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) return fail(res, ErrorCodes.MISSING_REQUIRED_FIELD, 'token is required', 400);
    const client = redisService.getClient();
    const data = await client.get(`invite:teacher:${token}`);
    if (!data) return res.status(410).json({ ...{ success: false, error: { code: ErrorCodes.NOT_FOUND, message: 'Invite expired or used' }, timestamp: new Date().toISOString() } });
    const payload = JSON.parse(data);
    const adminRepo = getCompositionRoot().getAdminRepository();
    const school = await adminRepo.getSchoolSummaryById(payload.schoolId);
    return ok(res, { role: payload.role, school: school ? { id: school.id, name: school.name, domain: school.domain } : { id: payload.schoolId } });
  } catch (error) {
    logger.error('Invite verify error', { error: (error as any)?.message || String(error) });
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to verify invite', 500);
  }
}

/**
 * POST /api/v1/admin/invites/accept
 * Accept invite and create/activate teacher record; single-use token
 */
export async function acceptInvite(req: Request, res: Response): Promise<Response> {
  try {
    const { token, name } = req.body as { token: string; name: string; password?: string };
    if (!token || !name) return fail(res, ErrorCodes.MISSING_REQUIRED_FIELD, 'token and name are required', 400);
    const client = redisService.getClient();
    const key = `invite:teacher:${token}`;
    const data = await client.get(key);
    if (!data) return res.status(410).json({ ...{ success: false, error: { code: ErrorCodes.NOT_FOUND, message: 'Invite expired or used' }, timestamp: new Date().toISOString() } });
    const payload = JSON.parse(data) as { email: string; role: string; schoolId: string; issuedBy: string; issuedByRole?: string };

    // Role guard on admin
    if (payload.role === 'admin' && payload.issuedByRole !== 'super_admin') {
      return fail(res, ErrorCodes.INSUFFICIENT_PERMISSIONS, 'Admin invites must be issued by super_admin', 403);
    }

    // Idempotent behavior: if teacher exists by email, treat as success
    const adminRepo = getCompositionRoot().getAdminRepository();
    const existing = await adminRepo.findTeacherByEmail?.(payload.email);
    let teacherId: string;
    if (!existing) {
      teacherId = uuidv4();
      const now = new Date().toISOString();
      await (adminRepo as any).insertTeacher?.({
        id: teacherId,
        email: payload.email,
        name,
        school_id: payload.schoolId,
        role: payload.role,
        status: 'active',
        access_level: payload.role === 'admin' ? 'admin' : 'teacher',
        created_at: now,
        updated_at: now,
      });
    } else {
      teacherId = existing.id;
    }

    // Consume token (single-use)
    await client.del(key);

    // Audit
    const { auditLogPort } = await import('../utils/audit.port.instance');
    await auditLogPort.enqueue({
      actorId: payload.issuedBy,
      actorType: 'admin',
      eventType: 'teacher_invite_accepted',
      eventCategory: 'configuration',
      resourceType: 'teacher',
      resourceId: teacherId,
      schoolId: payload.schoolId,
      description: 'Teacher invite accepted',
      complianceBasis: 'legitimate_interest',
    }).catch(() => {});

    return ok(res, { accepted: true });
  } catch (error) {
    logger.error('Invite accept error', { error: (error as any)?.message || String(error) });
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to accept invite', 500);
  }
}

/**
 * Districts CRUD (super_admin only)
 */
export async function listDistricts(req: Request, res: Response): Promise<Response> {
  try {
    const page = Math.max(parseInt(String(req.query.page || '1')), 1)
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20')), 1), 100)
    const offset = (page - 1) * limit
    const state = (req.query.state as string | undefined) || undefined
    const q = (req.query.q as string | undefined) || undefined
    const isActive = req.query.isActive != null ? String(req.query.isActive) === 'true' : undefined
    const adminRepo = getCompositionRoot().getAdminRepository();
    const items = await adminRepo.listDistricts({ state, q, isActive }, limit, offset)
    const total = await adminRepo.countDistricts({ state, q, isActive })
    const totalPages = Math.ceil(total / limit)
    return ok(res, { districts: items, pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 } })
  } catch (error) {
    logger.error('Error listing districts', { error: (error as any)?.message || String(error) })
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to retrieve districts', 500)
  }
}

export async function getDistrictByIdHandler(req: Request, res: Response): Promise<Response> {
  try {
    const id = req.params.id
    const adminRepo = getCompositionRoot().getAdminRepository();
    const row = await adminRepo.getDistrictById(id)
    if (!row) return fail(res, ErrorCodes.NOT_FOUND, 'District not found', 404)
    return ok(res, { district: row })
  } catch (error) {
    logger.error('Error getting district', { error: (error as any)?.message || String(error) })
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to retrieve district', 500)
  }
}

export async function createDistrict(req: Request, res: Response): Promise<Response> {
  try {
    const adminRepo = getCompositionRoot().getAdminRepository();
    const now = new Date().toISOString()
    const id = uuid()
    const body = req.body as any
    await adminRepo.insertDistrict({
      id,
      name: body.name,
      state: body.state,
      region: body.region ?? null,
      superintendent_name: body.superintendentName ?? null,
      contact_email: body.contactEmail ?? null,
      contact_phone: body.contactPhone ?? null,
      website: body.website ?? null,
      subscription_tier: body.subscriptionTier ?? null,
      is_active: body.isActive ?? true,
      created_at: now,
      updated_at: now,
    })
    const created = await adminRepo.getDistrictById(id)
    return ok(res, { district: created }, 201)
  } catch (error) {
    logger.error('Error creating district', { error: (error as any)?.message || String(error) })
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to create district', 500)
  }
}

export async function updateDistrict(req: Request, res: Response): Promise<Response> {
  try {
    const id = req.params.id
    const adminRepo = getCompositionRoot().getAdminRepository();
    const existing = await adminRepo.getDistrictById(id)
    if (!existing) return fail(res, ErrorCodes.NOT_FOUND, 'District not found', 404)
    const fields: Record<string, any> = {}
    const b = req.body as any
    if (b.name !== undefined) fields.name = b.name
    if (b.state !== undefined) fields.state = b.state
    if (b.region !== undefined) fields.region = b.region
    if (b.superintendentName !== undefined) fields.superintendent_name = b.superintendentName
    if (b.contactEmail !== undefined) fields.contact_email = b.contactEmail
    if (b.contactPhone !== undefined) fields.contact_phone = b.contactPhone
    if (b.website !== undefined) fields.website = b.website
    if (b.subscriptionTier !== undefined) fields.subscription_tier = b.subscriptionTier
    if (b.isActive !== undefined) fields.is_active = b.isActive
    fields.updated_at = new Date().toISOString()
    await adminRepo.updateDistrictById(id, fields)
    const updated = await adminRepo.getDistrictById(id)
    return ok(res, { district: updated })
  } catch (error) {
    logger.error('Error updating district', { error: (error as any)?.message || String(error) })
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to update district', 500)
  }
}

/**
 * POST /api/v1/admin/students/mark-13plus
 * Mark a student as 13+ (teacher_verified_age) by email.
 * - Admin: operates within own school
 * - Super Admin: may target a specific school via body.schoolId
 */
export async function markStudentThirteenPlus(req: Request, res: Response): Promise<Response> {
  try {
    const authReq = req as AuthRequest;
    const actor = authReq.user!;
    const isSuper = actor.role === 'super_admin';

    const Body = z.object({
      email: z.string().email('Invalid email'),
      verified: z.boolean().default(true).optional(),
      schoolId: z.string().optional(),
    });
    const parsed = Body.safeParse(req.body);
    if (!parsed.success) {
      return fail(res, ErrorCodes.INVALID_INPUT, 'Invalid input', 400);
    }
    const { email, verified = true, schoolId } = parsed.data;

    const targetSchoolId = isSuper && schoolId ? schoolId : (authReq.school?.id || '');
    if (!targetSchoolId) {
      return fail(res, ErrorCodes.INVALID_INPUT, 'School context is required', 400);
    }

    const rosterRepo = getCompositionRoot().getRosterRepository();
    const student = await rosterRepo.findStudentByEmailInSchool(targetSchoolId, email);
    if (!student) {
      return fail(res, ErrorCodes.NOT_FOUND, 'Student not found in school', 404);
    }

    const update: Record<string, any> = { teacher_verified_age: !!verified, updated_at: new Date().toISOString() };
    if (verified) update.coppa_compliant = true;
    await rosterRepo.updateStudentFields(student.id, update);

    // Audit (best-effort)
    try {
      const { auditLogPort } = await import('../utils/audit.port.instance');
      auditLogPort.enqueue({
        actorId: actor.id,
        actorType: 'admin',
        eventType: 'student_age_marked_13plus',
        eventCategory: 'compliance',
        resourceType: 'student',
        resourceId: student.id,
        schoolId: targetSchoolId,
        description: `admin:${actor.id} set teacher_verified_age=${verified ? 'true' : 'false'} for ${email}`,
        complianceBasis: 'coppa',
        affectedStudentIds: [student.id],
      }).catch(() => {});
    } catch {}

    return ok(res, { studentId: student.id, teacher_verified_age: !!verified, coppa_compliant: verified ? true : undefined });
  } catch (error) {
    logger.error('❌ Failed to mark student 13+:', error);
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to update student age verification', 500);
  }
}
