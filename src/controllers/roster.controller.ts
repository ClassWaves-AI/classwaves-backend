import { Request, Response } from 'express';
import { AuthRequest } from '../types/auth.types';
import { getCompositionRoot } from '../app/composition-root';
import { v4 as uuidv4 } from 'uuid';
import { composeDisplayName } from '../utils/name.utils';
import { logger } from '../utils/logger';
import { databricksService } from '../services/databricks.service';

function coerceIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function mirrorStudentToDatabricks(student: any | null): Promise<void> {
  if (!student) return;
  const composition = getCompositionRoot();
  if (composition.getDbProvider() !== 'postgres') return;

  try {
    const record = {
      id: student.id,
      display_name: student.display_name,
      school_id: student.school_id,
      email: student.email ?? null,
      grade_level: student.grade_level ?? null,
      status: student.status ?? 'active',
      has_parental_consent: student.has_parental_consent ?? false,
      consent_date: student.consent_date ?? null,
      parent_email: student.parent_email ?? null,
      email_consent: student.email_consent ?? false,
      data_sharing_consent: student.data_sharing_consent ?? false,
      audio_recording_consent: student.audio_recording_consent ?? false,
      teacher_verified_age: student.teacher_verified_age ?? null,
      coppa_compliant: student.coppa_compliant ?? null,
      updated_at: coerceIso(student.updated_at) ?? new Date().toISOString(),
      created_at: coerceIso(student.created_at) ?? new Date().toISOString(),
    };

    await databricksService.upsert('classwaves.users.students', { id: record.id }, record);
  } catch (mirrorError) {
    logger.debug('Roster: databricks mirror skipped', mirrorError instanceof Error ? mirrorError.message : mirrorError);
  }
}

/**
 * GET /api/v1/roster
 * List students in teacher's roster (school-filtered)
 */
export async function listStudents(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  logger.debug('📋 Roster: List Students endpoint called');
  
  try {
    const teacher = authReq.user!;
    const school = authReq.school!;
    
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const gradeLevel = req.query.gradeLevel as string;
    const status = req.query.status as string;

    const rosterRepo = getCompositionRoot().getRosterRepository();
    const studentsRaw = await rosterRepo.listStudentsBySchool(school.id, { gradeLevel, status }, limit, offset);
    const total = await rosterRepo.countStudentsBySchool(school.id, { gradeLevel, status });
    const totalPages = Math.ceil(total / limit);

    // Log audit event (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'student_roster_accessed',
      eventCategory: 'data_access',
      resourceType: 'student',
      resourceId: 'roster',
      schoolId: school.id,
      description: `teacher:${teacher.id} accessed student roster`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    }).catch(() => {});

    // Transform students to match frontend interface
    const transformedStudents = studentsRaw.map(student => {
      // Split display name into first/last name
      const nameParts = (student.display_name || '').split(' ');
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';
      
      // Determine consent status with teacher verification precedence
      // If teacher verified age (13+), parental consent is not required
      let consentStatus: 'none' | 'required' | 'granted' | 'expired' = 'none';
      if (student.teacher_verified_age === true) {
        consentStatus = 'none';
      } else if (student.has_parental_consent) {
        consentStatus = 'granted';
      } else if (student.parent_email) {
        consentStatus = 'required';
      }
      
      return {
        id: student.id,
        firstName,
        lastName,
        gradeLevel: student.grade_level || '',
        studentId: student.id, // Use ID as studentId for now
        studentEmail: student.email || '',
        parentEmail: student.parent_email,
        status: student.status,
        consentStatus,
        consentDate: student.consent_date,
        // Prefer explicit teacher verification; otherwise infer from parent email presence
        isUnderConsentAge: student.teacher_verified_age === true ? false : Boolean(student.parent_email),
        // New flags for UI transparency
        emailConsentGiven: Boolean(student.email_consent === true),
        teacherVerifiedAge: Boolean(student.teacher_verified_age === true),
        coppaCompliant: Boolean(student.coppa_compliant === true),
        // Surface additional consent toggles for accurate UI defaults
        dataConsentGiven: Boolean(student.data_sharing_consent === true),
        audioConsentGiven: Boolean(student.audio_recording_consent === true),
        createdAt: student.created_at,
        updatedAt: student.updated_at,
      };
    });

    return res.json({
      success: true,
      data: transformedStudents,
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1
    });

  } catch (error) {
    logger.error('❌ Error listing students:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to retrieve students'
    });
  }
}

/**
 * POST /api/v1/roster
 * Add a new student to the roster with COPPA compliance
 */
export async function createStudent(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  logger.debug('👶 Roster: Create Student endpoint called');
  
  try {
    const teacher = authReq.user!;
    const school = authReq.school!;
    
    const {
      firstName,
      lastName,
      preferredName,
      gradeLevel,
      studentEmail,
      parentEmail,
      isUnderConsentAge = false,
      hasParentalConsent = false,
      dataConsentGiven = true,
      audioConsentGiven = true,
      emailConsentGiven = true,
    } = req.body;
    
    const name = composeDisplayName({ given: firstName, family: lastName, preferred: preferredName });
    const normalizedStudentEmail = typeof studentEmail === 'string' && studentEmail.trim().length > 0 ? studentEmail.trim() : null;
    const normalizedParentEmail = typeof parentEmail === 'string' && parentEmail.trim().length > 0 ? parentEmail.trim() : null;

    // Simplified COPPA compliance logic
    if (isUnderConsentAge && !hasParentalConsent) {
      return res.status(400).json({
        success: false,
        error: 'PARENTAL_CONSENT_REQUIRED',
        message: 'Parental consent is required for students under 13',
        requiresParentalConsent: true
      });
    }

    // Check if student already exists
    const rosterRepoExist = getCompositionRoot().getRosterRepository();
    const existingStudent = await rosterRepoExist.findStudentByNameInSchool(school.id, name);

    if (existingStudent) {
      return res.status(409).json({
        success: false,
        error: 'STUDENT_EXISTS',
        message: 'A student with this name already exists in the roster'
      });
    }

    // Create new student
    const studentId = uuidv4();
    const now = new Date().toISOString();

    const rosterRepo = getCompositionRoot().getRosterRepository();
    await rosterRepo.insertStudent({
      id: studentId,
      display_name: name,
      school_id: school.id,
      email: normalizedStudentEmail,
      grade_level: gradeLevel || null,
      status: 'active',
      has_parental_consent: hasParentalConsent,
      consent_date: hasParentalConsent ? now : null,
      parent_email: normalizedParentEmail,
      data_sharing_consent: dataConsentGiven,
      audio_recording_consent: audioConsentGiven,
      email_consent: emailConsentGiven,
      created_at: now,
      updated_at: now,
    });

    // Align new consent fields with initial creation state
    try {
      const newFields: Record<string, any> = {};
      // 13 or older: teacher verifies age; COPPA not required
      if (isUnderConsentAge === false) {
        newFields.teacher_verified_age = true;
        newFields.coppa_compliant = true;
      }
      // Under 13 with parental consent: mark COPPA compliant
      if (hasParentalConsent === true) {
        newFields.coppa_compliant = true;
      }
      // Email consent is independent; do not infer from presence of a student email
      if (emailConsentGiven === true) {
        newFields.email_consent = true;
      }
      if (Object.keys(newFields).length) {
        newFields.updated_at = now;
        await rosterRepo.updateStudentFields(studentId, newFields);
      }
    } catch (consentUpdateError) {
      logger.debug('Roster: optional consent metadata update skipped', consentUpdateError instanceof Error ? consentUpdateError.message : consentUpdateError);
    }

    // Best effort: store structured names if columns exist
    try {
      await rosterRepo.updateStudentNames(studentId, { given_name: firstName ?? null, family_name: lastName ?? null, preferred_name: preferredName ?? null, updated_at: now });
    } catch (nameUpdateError) {
      logger.debug('Roster: structured name update failed', nameUpdateError instanceof Error ? nameUpdateError.message : nameUpdateError);
    }

    // Get the created student
    const createdStudent = await rosterRepo.getStudentWithSchool(studentId);
    await mirrorStudentToDatabricks(createdStudent);

    // Log audit event (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'student_created',
      eventCategory: 'configuration',
      resourceType: 'student',
      resourceId: studentId,
      schoolId: school.id,
      description: `teacher:${teacher.id} added student`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
      affectedStudentIds: [studentId]
    }).catch(() => {});

    // Check if student was created successfully
    if (!createdStudent) {
      return res.status(500).json({
        success: false,
        error: 'STUDENT_CREATION_FAILED',
        message: 'Student was created but could not be retrieved'
      });
    }

    // Transform created student to match frontend interface  
    let consentStatus = 'none';
    if (createdStudent.has_parental_consent) {
      consentStatus = 'granted';
    } else if (createdStudent.parent_email) {
      consentStatus = 'required';
    }
    const derivedIsUnderAge = createdStudent.teacher_verified_age === true ? false : Boolean(createdStudent.parent_email);

    const transformedStudent = {
      id: createdStudent.id,
      firstName, // Use the firstName from request body
      lastName,  // Use the lastName from request body
      gradeLevel: createdStudent.grade_level || '',
      studentId: createdStudent.id,
      studentEmail: createdStudent.email || '',
      parentEmail: createdStudent.parent_email,
      status: createdStudent.status,
      consentStatus,
      consentDate: createdStudent.consent_date,
      isUnderConsentAge: derivedIsUnderAge,
      emailConsentGiven: createdStudent.email_consent === true,
      dataConsentGiven: createdStudent.data_sharing_consent === true,
      audioConsentGiven: createdStudent.audio_recording_consent === true,
      teacherVerifiedAge: createdStudent.teacher_verified_age === true,
      coppaCompliant: createdStudent.coppa_compliant === true,
      createdAt: createdStudent.created_at,
      updatedAt: createdStudent.updated_at,
    };

    return res.status(201).json({
      success: true,
      data: transformedStudent
    });

  } catch (error) {
    logger.error('❌ Error creating student:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to create student'
    });
  }
}

/**
 * PUT /api/v1/roster/:id
 * Update student information in roster
 */
export async function updateStudent(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  const studentId = req.params.id;
  logger.debug(`🔄 Roster: Update Student ${studentId} endpoint called`);
  
  try {
    const teacher = authReq.user!;
    const school = authReq.school!;

    // Check if student exists and belongs to teacher's school
    const rosterRepoUpdate = getCompositionRoot().getRosterRepository();
    const existingStudent = await rosterRepoUpdate.findStudentInSchool(studentId, school.id);

    if (!existingStudent) {
      return res.status(404).json({
        success: false,
        error: 'STUDENT_NOT_FOUND',
        message: 'Student not found in your school roster'
      });
    }

    const {
      name,
      firstName,
      lastName,
      preferredName,
      email,
      studentEmail,
      gradeLevel,
      parentEmail,
      status,
      dataConsentGiven,
      audioConsentGiven,
      emailConsentGiven,
      teacherVerifiedAge,
      coppaCompliant,
      // Back-compat aliases from older UI
      isUnderConsentAge,
      hasParentalConsent
    } = req.body;

    // Build update query dynamically
    const updateFields: string[] = [];
    const updateValues: any[] = [];

    // Name precedence: if explicit name provided, use it; otherwise combine split/preferred
    if (name !== undefined) {
      updateFields.push('display_name = ?');
      updateValues.push((name as string).trim());
    } else if (firstName !== undefined || lastName !== undefined || preferredName !== undefined) {
      const combined = composeDisplayName({ given: firstName, family: lastName, preferred: preferredName });
      if (combined) {
        updateFields.push('display_name = ?');
        updateValues.push(combined);
      }
    }
    const normalizedEmailInput = studentEmail !== undefined ? studentEmail : email;
    if (normalizedEmailInput !== undefined) {
      const trimmedEmail = typeof normalizedEmailInput === 'string' ? normalizedEmailInput.trim() : normalizedEmailInput;
      updateFields.push('email = ?');
      updateValues.push(trimmedEmail && typeof trimmedEmail === 'string' && trimmedEmail.length > 0 ? trimmedEmail : null);
    }
    if (gradeLevel !== undefined) {
      updateFields.push('grade_level = ?');
      updateValues.push(gradeLevel);
    }
    if (parentEmail !== undefined) {
      const trimmedParent = typeof parentEmail === 'string' ? parentEmail.trim() : parentEmail;
      updateFields.push('parent_email = ?');
      updateValues.push(trimmedParent && typeof trimmedParent === 'string' && trimmedParent.length > 0 ? trimmedParent : null);
    }
    if (status !== undefined) {
      updateFields.push('status = ?');
      updateValues.push(status);
    }
    if (dataConsentGiven !== undefined) {
      updateFields.push('data_sharing_consent = ?');
      updateValues.push(dataConsentGiven);
    }
    if (audioConsentGiven !== undefined) {
      updateFields.push('audio_recording_consent = ?');
      updateValues.push(audioConsentGiven);
    }
    if (emailConsentGiven !== undefined) {
      updateFields.push('email_consent = ?');
      updateValues.push(emailConsentGiven);
    }
    if (teacherVerifiedAge !== undefined) {
      updateFields.push('teacher_verified_age = ?');
      updateValues.push(teacherVerifiedAge);
      // If teacher verifies age (>=13), mark COPPA compliant
      if (teacherVerifiedAge === true) {
        updateFields.push('coppa_compliant = ?');
        updateValues.push(true);
      }
    }
    if (coppaCompliant !== undefined) {
      updateFields.push('coppa_compliant = ?');
      updateValues.push(coppaCompliant);
    }
    // Back-compat support: if UI sends these fields, map to new schema
    if (isUnderConsentAge !== undefined) {
      // If not under consent age => teacher verified age
      if (isUnderConsentAge === false) {
        updateFields.push('teacher_verified_age = ?');
        updateValues.push(true);
        updateFields.push('coppa_compliant = ?');
        updateValues.push(true);
      } else {
        // Under 13 -> ensure teacher_verified_age is false
        updateFields.push('teacher_verified_age = ?');
        updateValues.push(false);
      }
    }
    if (hasParentalConsent !== undefined) {
      // Mirror legacy parental consent to new consent fields where appropriate
      updateFields.push('has_parental_consent = ?');
      updateValues.push(hasParentalConsent);
      updateFields.push('consent_date = ?');
      updateValues.push(hasParentalConsent ? new Date().toISOString() : null);
      updateFields.push('coppa_compliant = ?');
      updateValues.push(!!hasParentalConsent);
      updateFields.push('email_consent = ?');
      updateValues.push(!!hasParentalConsent);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'NO_UPDATES',
        message: 'No valid fields provided for update'
      });
    }

    // Always update the updated_at field
    updateFields.push('updated_at = ?');
    updateValues.push(new Date().toISOString());

    // Add student ID for WHERE clause
    updateValues.push(studentId);

    // Debug: log which columns are being updated (no values)
    logger.debug('🛠️ Roster Update Columns:', updateFields.map(f => f.split('=')[0].trim()));

    // Build field map for repository update
    const fieldsMap = Object.fromEntries(updateFields.map((f, i) => [f.replace(' = ?', ''), updateValues[i]]));
    await rosterRepoUpdate.updateStudentFields(studentId, fieldsMap);

    // Best effort: also persist structured names if provided and columns exist
    if (firstName !== undefined || lastName !== undefined || preferredName !== undefined) {
      try {
        await rosterRepoUpdate.updateStudentNames(studentId, { given_name: firstName ?? null, family_name: lastName ?? null, preferred_name: preferredName ?? null, updated_at: new Date().toISOString() });
      } catch (structuredNameError) {
        logger.debug('Roster: structured name update skipped during edit', structuredNameError instanceof Error ? structuredNameError.message : structuredNameError);
      }
    }

    // Get the updated student
    const updatedStudent = await rosterRepoUpdate.getStudentWithSchool(studentId);
    await mirrorStudentToDatabricks(updatedStudent);

    // Log audit event (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'student_updated',
      eventCategory: 'configuration',
      resourceType: 'student',
      resourceId: studentId,
      schoolId: school.id,
      description: `teacher:${teacher.id} updated student`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
      affectedStudentIds: [studentId]
    }).catch(() => {});

    return res.json({
      success: true,
      data: {
        student: updatedStudent
      }
    });

  } catch (error) {
    logger.error('❌ Error updating student:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to update student'
    });
  }
}

/**
 * DELETE /api/v1/roster/:id
 * Remove student from roster
 */
export async function deleteStudent(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  const studentId = req.params.id;
  logger.debug(`🗑️ Roster: Delete Student ${studentId} endpoint called`);
  
  try {
    const teacher = authReq.user!;
    const school = authReq.school!;

    // Check if student exists and belongs to teacher's school
    const rosterRepoDel = getCompositionRoot().getRosterRepository();
    const existingStudent = await rosterRepoDel.findStudentInSchool(studentId, school.id);

    if (!existingStudent) {
      return res.status(404).json({
        success: false,
        error: 'STUDENT_NOT_FOUND',
        message: 'Student not found in your school roster'
      });
    }

    // Check if student is in any active groups (FERPA compliance)
    const groupCount = await rosterRepoDel.countStudentGroupMembership(studentId);

    if (groupCount > 0) {
      // For FERPA compliance, deactivate rather than delete if student has group data
      await rosterRepoDel.setStudentDeactivated(studentId);

      // Log audit event (async)
      const { auditLogPort } = await import('../utils/audit.port.instance');
      auditLogPort.enqueue({
        actorId: teacher.id,
        actorType: 'teacher',
        eventType: 'student_deactivated',
        eventCategory: 'configuration',
        resourceType: 'student',
        resourceId: studentId,
        schoolId: school.id,
        description: `teacher:${teacher.id} deactivated student (FERPA protected)`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        complianceBasis: 'ferpa',
        affectedStudentIds: [studentId]
      }).catch(() => {});

      return res.json({
        success: true,
        message: 'Student deactivated (preserved for FERPA compliance)',
        action: 'deactivated'
      });
    } else {
      // Safe to delete if no session participation
      await rosterRepoDel.deleteStudent(studentId);

      // Log audit event (async)
      const { auditLogPort } = await import('../utils/audit.port.instance');
      auditLogPort.enqueue({
        actorId: teacher.id,
        actorType: 'teacher',
        eventType: 'student_deleted',
        eventCategory: 'configuration',
        resourceType: 'student',
        resourceId: studentId,
        schoolId: school.id,
        description: `teacher:${teacher.id} removed student (no session data)`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        complianceBasis: 'legitimate_interest',
        affectedStudentIds: [studentId]
      }).catch(() => {});

      return res.json({
        success: true,
        message: 'Student removed from roster',
        action: 'deleted'
      });
    }

  } catch (error) {
    logger.error('❌ Error deleting student:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to remove student'
    });
  }
}

/**
 * POST /api/v1/roster/:id/age-verify
 * COPPA age verification for student
 */
export async function ageVerifyStudent(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  const studentId = req.params.id;
  logger.debug(`🎂 Roster: Age Verify Student ${studentId} endpoint called`);
  
  try {
    const teacher = authReq.user!;
    const school = authReq.school!;
  const { birthDate, parentEmail } = req.body;

    // Check if student exists and belongs to teacher's school
    const rosterRepoAge = getCompositionRoot().getRosterRepository();
    const existingStudent = await rosterRepoAge.findStudentInSchool(studentId, school.id);

    if (!existingStudent) {
      return res.status(404).json({
        success: false,
        error: 'STUDENT_NOT_FOUND',
        message: 'Student not found in your school roster'
      });
    }

    // Calculate age
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }

    const requiresParentalConsent = age < 13;

    if (requiresParentalConsent && !parentEmail) {
      return res.status(400).json({
        success: false,
        error: 'PARENT_EMAIL_REQUIRED',
        message: 'Parent email is required for students under 13',
        coppaInfo: {
          age,
          requiresParentalConsent: true
        }
      });
    }

    // Update student with age verification info
    const updateData: Record<string, unknown> = {
      parent_email: parentEmail || null,
      updated_at: new Date().toISOString()
    };

    // If 13 or older: teacher-verifies age and mark COPPA compliant
    if (!requiresParentalConsent) {
      updateData.teacher_verified_age = true;
      updateData.coppa_compliant = true;
      // Do not auto-grant email_consent here; allow explicit toggle on edit modal
    }

    await rosterRepoAge.updateStudentFields(studentId, updateData);

    // Log audit event (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'student_age_verified',
      eventCategory: 'compliance',
      resourceType: 'student',
      resourceId: studentId,
      schoolId: school.id,
      description: `teacher:${teacher.id} verified student age (age:${age})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'coppa',
      affectedStudentIds: [studentId]
    }).catch(() => {});

    return res.json({
      success: true,
      data: {
        coppaInfo: {
          age,
          requiresParentalConsent,
          parentalConsentStatus: requiresParentalConsent ? 'required' : 'granted',
          parentEmail: parentEmail || null
        }
      }
    });

  } catch (error) {
    logger.error('❌ Error verifying student age:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to verify student age'
    });
  }
}

/**
 * POST /api/v1/roster/:id/parental-consent
 * Request or update parental consent for student
 */
export async function requestParentalConsent(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  const studentId = req.params.id;
  logger.debug(`👨‍👩‍👧‍👦 Roster: Parental Consent for Student ${studentId} endpoint called`);
  
  try {
    const teacher = authReq.user!;
    const school = authReq.school!;
    const { consentGiven = false, consentDate } = req.body;

    // Check if student exists and belongs to teacher's school
    const rosterRepoConsent = getCompositionRoot().getRosterRepository();
    const existingStudent = await rosterRepoConsent.findStudentInSchool(studentId, school.id);

    if (!existingStudent) {
      return res.status(404).json({
        success: false,
        error: 'STUDENT_NOT_FOUND',
        message: 'Student not found in your school roster'
      });
    }

    if (!existingStudent.parent_email) {
      return res.status(400).json({
        success: false,
        error: 'NO_PARENT_EMAIL',
        message: 'No parent email on file for consent request'
      });
    }

    // Update consent status
    const now = new Date().toISOString();
    await rosterRepoConsent.updateParentalConsent(studentId, consentGiven, consentDate || now);
    // Align new schema with parental consent decision
    try {
      await rosterRepoConsent.updateStudentFields(studentId, {
        coppa_compliant: !!consentGiven,
        email_consent: !!consentGiven,
        updated_at: now,
      });
    } catch (consentSyncError) {
      logger.debug('Roster: parental consent sync skipped', consentSyncError instanceof Error ? consentSyncError.message : consentSyncError);
    }

    // Log audit event (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'parental_consent_updated',
      eventCategory: 'compliance',
      resourceType: 'student',
      resourceId: studentId,
      schoolId: school.id,
      description: `teacher:${teacher.id} updated parental consent (consent:${consentGiven ? 'granted' : 'denied'})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'coppa',
      affectedStudentIds: [studentId]
    }).catch(() => {});

    return res.json({
      success: true,
      data: {
        consentStatus: consentGiven ? 'granted' : 'denied',
        consentDate: consentDate || now,
        parentEmail: existingStudent.parent_email
      },
      message: consentGiven ? 'Parental consent granted' : 'Parental consent denied'
    });

  } catch (error) {
    logger.error('❌ Error updating parental consent:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to update parental consent'
    });
  }
}

/**
 * GET /api/v1/roster/overview
 * Get roster metrics overview for teacher's school
 */
export async function getRosterOverview(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  logger.debug('📊 Roster: Get Overview endpoint called');
  
  try {
    const teacher = authReq.user!;
    const school = authReq.school!;

    // Get comprehensive metrics in a single query for efficiency
    const rosterRepoOverview = getCompositionRoot().getRosterRepository();
    const metrics = await rosterRepoOverview.getRosterOverviewMetrics(school.id);

    const overview = metrics;

    // Log audit event for data access (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'roster_overview_accessed',
      eventCategory: 'data_access',
      resourceType: 'student',
      resourceId: 'overview',
      schoolId: school.id,
      description: `teacher:${teacher.id} accessed roster overview metrics`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    }).catch(() => {});

    return res.json({
      success: true,
      data: overview
    });

  } catch (error) {
    logger.error('❌ Error fetching roster overview:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch roster overview'
    });
  }
}
