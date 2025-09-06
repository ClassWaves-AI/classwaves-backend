import { Request, Response } from 'express';
import { AuthRequest } from '../types/auth.types';
import { getCompositionRoot } from '../app/composition-root';
import { v4 as uuidv4 } from 'uuid';
import { composeDisplayName } from '../utils/name.utils';

/**
 * GET /api/v1/roster
 * List students in teacher's roster (school-filtered)
 */
export async function listStudents(req: Request, res: Response): Promise<Response> {
  const authReq = req as AuthRequest;
  console.log('📋 Roster: List Students endpoint called');
  
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
      
      // Determine consent status
      let consentStatus = 'none';
      if (student.has_parental_consent) {
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
        parentEmail: student.parent_email,
        status: student.status,
        consentStatus,
        consentDate: student.consent_date,
        isUnderConsentAge: student.parent_email ? true : false, // Infer from parent email presence
        createdAt: student.created_at,
        updatedAt: student.updated_at,
      };
    });

    return res.json({
      success: true,
      data: transformedStudents,
      total,
      page,
      limit
    });

  } catch (error) {
    console.error('❌ Error listing students:', error);
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
  console.log('👶 Roster: Create Student endpoint called');
  
  try {
    const teacher = authReq.user!;
    const school = authReq.school!;
    
    const {
      firstName,
      lastName,
      preferredName,
      gradeLevel,
      parentEmail,
      isUnderConsentAge = false,
      hasParentalConsent = false,
      dataConsentGiven = false,
      audioConsentGiven = false
    } = req.body;
    
    const name = composeDisplayName({ given: firstName, family: lastName, preferred: preferredName });

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
      email: null,
      grade_level: gradeLevel || null,
      status: 'active',
      has_parental_consent: hasParentalConsent,
      consent_date: hasParentalConsent ? now : null,
      parent_email: parentEmail || null,
      data_sharing_consent: dataConsentGiven,
      audio_recording_consent: audioConsentGiven,
      created_at: now,
      updated_at: now,
    });

    // Best effort: store structured names if columns exist
    try {
      await rosterRepo.updateStudentNames(studentId, { given_name: firstName ?? null, family_name: lastName ?? null, preferred_name: preferredName ?? null, updated_at: now });
    } catch {}

    // Get the created student
    const createdStudent = await rosterRepo.getStudentWithSchool(studentId);

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
    
    const transformedStudent = {
      id: createdStudent.id,
      firstName, // Use the firstName from request body
      lastName,  // Use the lastName from request body
      gradeLevel: createdStudent.grade_level || '',
      studentId: createdStudent.id,
      parentEmail: createdStudent.parent_email,
      status: createdStudent.status,
      consentStatus,
      consentDate: createdStudent.consent_date,
      isUnderConsentAge, // Use the value from request body
      createdAt: createdStudent.created_at,
      updatedAt: createdStudent.updated_at,
    };

    return res.status(201).json({
      success: true,
      data: transformedStudent
    });

  } catch (error) {
    console.error('❌ Error creating student:', error);
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
  console.log(`🔄 Roster: Update Student ${studentId} endpoint called`);
  
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
      gradeLevel,
      parentEmail,
      status,
      dataConsentGiven,
      audioConsentGiven
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
    if (email !== undefined) {
      updateFields.push('email = ?');
      updateValues.push(email);
    }
    if (gradeLevel !== undefined) {
      updateFields.push('grade_level = ?');
      updateValues.push(gradeLevel);
    }
    if (parentEmail !== undefined) {
      updateFields.push('parent_email = ?');
      updateValues.push(parentEmail);
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
    console.log('🛠️ Roster Update Columns:', updateFields.map(f => f.split('=')[0].trim()));

    // Build field map for repository update
    const fieldsMap = Object.fromEntries(updateFields.map((f, i) => [f.replace(' = ?', ''), updateValues[i]]));
    await rosterRepoUpdate.updateStudentFields(studentId, fieldsMap);

    // Best effort: also persist structured names if provided and columns exist
    if (firstName !== undefined || lastName !== undefined || preferredName !== undefined) {
      try {
        await rosterRepoUpdate.updateStudentNames(studentId, { given_name: firstName ?? null, family_name: lastName ?? null, preferred_name: preferredName ?? null, updated_at: new Date().toISOString() });
      } catch {}
    }

    // Get the updated student
    const updatedStudent = await rosterRepoUpdate.getStudentWithSchool(studentId);

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
    console.error('❌ Error updating student:', error);
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
  console.log(`🗑️ Roster: Delete Student ${studentId} endpoint called`);
  
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
    console.error('❌ Error deleting student:', error);
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
  console.log(`🎂 Roster: Age Verify Student ${studentId} endpoint called`);
  
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
    const updateData: any = {
      parent_email: parentEmail || null,
      updated_at: new Date().toISOString()
    };

    // If over 13, can automatically grant consent
    if (!requiresParentalConsent) {
      updateData.has_parental_consent = true;
      updateData.consent_date = new Date().toISOString();
    }

    const updateFields = Object.keys(updateData);
    const updateValues = Object.values(updateData);
    const setClause = updateFields.map(field => `${field} = ?`).join(', ');

    await rosterRepoAge.updateStudentFields(studentId, Object.fromEntries(updateFields.map((f, i) => [f.split('=')[0].trim(), updateValues[i]])));

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
    console.error('❌ Error verifying student age:', error);
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
  console.log(`👨‍👩‍👧‍👦 Roster: Parental Consent for Student ${studentId} endpoint called`);
  
  try {
    const teacher = authReq.user!;
    const school = authReq.school!;
    const { consentGiven = false, parentSignature, consentDate } = req.body;

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
    console.error('❌ Error updating parental consent:', error);
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
  console.log('📊 Roster: Get Overview endpoint called');
  
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
    console.error('❌ Error fetching roster overview:', error);
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch roster overview'
    });
  }
}
