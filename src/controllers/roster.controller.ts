import { Request, Response } from 'express';
import { AuthRequest } from '../types/auth.types';
import { databricksService } from '../services/databricks.service';
import { v4 as uuidv4 } from 'uuid';

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

    // Build query with optional filters
    let whereClause = 'WHERE s.school_id = ?';
    const queryParams: any[] = [school.id];

    if (gradeLevel) {
      whereClause += ' AND s.grade_level = ?';
      queryParams.push(gradeLevel);
    }

    if (status) {
      whereClause += ' AND s.status = ?';
      queryParams.push(status);
    }

    // Get students for this school
    const students = await databricksService.query(`
      SELECT 
        s.id,
        s.display_name as name,
        s.email,
        s.grade_level,
        s.status,
        s.has_parental_consent,
        s.consent_date,
        s.parent_email,
        s.data_sharing_consent,
        s.audio_recording_consent,
        s.created_at,
        s.updated_at,
        sch.name as school_name
      FROM classwaves.users.students s
      JOIN classwaves.users.schools sch ON s.school_id = sch.id
      ${whereClause}
      ORDER BY s.display_name ASC
      LIMIT ${limit} OFFSET ${offset}
    `, queryParams);

    // Get total count for pagination
    const countResult = await databricksService.queryOne(`
      SELECT COUNT(*) as total 
      FROM classwaves.users.students s
      ${whereClause}
    `, queryParams);

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    // Log audit event
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'student_roster_accessed',
      eventCategory: 'data_access',
      resourceType: 'student',
      resourceId: 'roster',
      schoolId: school.id,
      description: `Teacher ${teacher.email} accessed student roster`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest'
    });

    return res.json({
      success: true,
      data: {
        students,
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
      name,
      email,
      gradeLevel,
      parentEmail,
      birthDate,
      dataConsentGiven = false,
      audioConsentGiven = false
    } = req.body;

    // Calculate age for COPPA compliance
    let age: number | null = null;
    let requiresParentalConsent = false;
    
    if (birthDate) {
      const birth = new Date(birthDate);
      const today = new Date();
      age = today.getFullYear() - birth.getFullYear();
      const monthDiff = today.getMonth() - birth.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
        age--;
      }
      
      if (age < 13) {
        requiresParentalConsent = true;
        if (!parentEmail) {
          return res.status(400).json({
            success: false,
            error: 'COPPA_COMPLIANCE_REQUIRED',
            message: 'Parent email is required for students under 13',
            requiresParentalConsent: true
          });
        }
      }
    }

    // Check if student already exists
    const existingStudent = await databricksService.queryOne(`
      SELECT id FROM classwaves.users.students 
      WHERE school_id = ? AND (email = ? OR display_name = ?)
    `, [school.id, email, name]);

    if (existingStudent) {
      return res.status(409).json({
        success: false,
        error: 'STUDENT_EXISTS',
        message: 'A student with this name or email already exists in the roster'
      });
    }

    // Create new student
    const studentId = uuidv4();
    const now = new Date().toISOString();

    await databricksService.query(`
      INSERT INTO classwaves.users.students (
        id, display_name, school_id, email, grade_level, status,
        has_parental_consent, consent_date, parent_email,
        data_sharing_consent, audio_recording_consent,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      studentId,
      name,
      school.id,
      email || null,
      gradeLevel || null,
      'active',
      requiresParentalConsent ? false : true, // Require consent for under-13
      requiresParentalConsent ? null : now,
      parentEmail || null,
      dataConsentGiven,
      audioConsentGiven,
      now,
      now
    ]);

    // Get the created student
    const createdStudent = await databricksService.queryOne(`
      SELECT 
        s.*,
        sch.name as school_name
      FROM classwaves.users.students s
      JOIN classwaves.users.schools sch ON s.school_id = sch.id
      WHERE s.id = ?
    `, [studentId]);

    // Log audit event
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'student_created',
      eventCategory: 'configuration',
      resourceType: 'student',
      resourceId: studentId,
      schoolId: school.id,
      description: `Teacher ${teacher.email} added student: ${name}${requiresParentalConsent ? ' (requires parental consent)' : ''}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
      affectedStudentIds: [studentId]
    });

    return res.status(201).json({
      success: true,
      data: {
        student: createdStudent,
        coppaInfo: {
          requiresParentalConsent,
          estimatedAge: age,
          parentalConsentStatus: requiresParentalConsent ? 'required' : 'not_required'
        }
      }
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
    const existingStudent = await databricksService.queryOne(`
      SELECT * FROM classwaves.users.students WHERE id = ? AND school_id = ?
    `, [studentId, school.id]);

    if (!existingStudent) {
      return res.status(404).json({
        success: false,
        error: 'STUDENT_NOT_FOUND',
        message: 'Student not found in your school roster'
      });
    }

    const {
      name,
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

    if (name !== undefined) {
      updateFields.push('display_name = ?');
      updateValues.push(name);
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

    await databricksService.query(`
      UPDATE classwaves.users.students 
      SET ${updateFields.join(', ')}
      WHERE id = ?
    `, updateValues);

    // Get the updated student
    const updatedStudent = await databricksService.queryOne(`
      SELECT 
        s.*,
        sch.name as school_name
      FROM classwaves.users.students s
      JOIN classwaves.users.schools sch ON s.school_id = sch.id
      WHERE s.id = ?
    `, [studentId]);

    // Log audit event
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'student_updated',
      eventCategory: 'configuration',
      resourceType: 'student',
      resourceId: studentId,
      schoolId: school.id,
      description: `Teacher ${teacher.email} updated student: ${updatedStudent.display_name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'legitimate_interest',
      affectedStudentIds: [studentId]
    });

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
    const existingStudent = await databricksService.queryOne(`
      SELECT * FROM classwaves.users.students WHERE id = ? AND school_id = ?
    `, [studentId, school.id]);

    if (!existingStudent) {
      return res.status(404).json({
        success: false,
        error: 'STUDENT_NOT_FOUND',
        message: 'Student not found in your school roster'
      });
    }

    // Check if student is in any active groups (FERPA compliance)
    const groupMembership = await databricksService.queryOne(`
      SELECT COUNT(*) as group_count 
      FROM classwaves.sessions.student_groups 
      WHERE JSON_ARRAY_CONTAINS(student_ids, ?)
    `, [studentId]);

    if (groupMembership?.group_count > 0) {
      // For FERPA compliance, deactivate rather than delete if student has group data
      await databricksService.query(`
        UPDATE classwaves.users.students 
        SET status = 'deactivated', updated_at = ?
        WHERE id = ?
      `, [new Date().toISOString(), studentId]);

      // Log audit event
      await databricksService.recordAuditLog({
        actorId: teacher.id,
        actorType: 'teacher',
        eventType: 'student_deactivated',
        eventCategory: 'configuration',
        resourceType: 'student',
        resourceId: studentId,
        schoolId: school.id,
        description: `Teacher ${teacher.email} deactivated student: ${existingStudent.display_name} (has session data - FERPA protected)`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        complianceBasis: 'ferpa',
        affectedStudentIds: [studentId]
      });

      return res.json({
        success: true,
        message: 'Student deactivated (preserved for FERPA compliance)',
        action: 'deactivated'
      });
    } else {
      // Safe to delete if no session participation
      await databricksService.query(`
        DELETE FROM classwaves.users.students WHERE id = ?
      `, [studentId]);

      // Log audit event
      await databricksService.recordAuditLog({
        actorId: teacher.id,
        actorType: 'teacher',
        eventType: 'student_deleted',
        eventCategory: 'configuration',
        resourceType: 'student',
        resourceId: studentId,
        schoolId: school.id,
        description: `Teacher ${teacher.email} removed student: ${existingStudent.display_name} (no session data)`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        complianceBasis: 'legitimate_interest',
        affectedStudentIds: [studentId]
      });

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
    const existingStudent = await databricksService.queryOne(`
      SELECT * FROM classwaves.users.students WHERE id = ? AND school_id = ?
    `, [studentId, school.id]);

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

    await databricksService.query(`
      UPDATE classwaves.users.students 
      SET ${setClause}
      WHERE id = ?
    `, [...updateValues, studentId]);

    // Log audit event
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'student_age_verified',
      eventCategory: 'compliance',
      resourceType: 'student',
      resourceId: studentId,
      schoolId: school.id,
      description: `Teacher ${teacher.email} verified age for student: ${existingStudent.display_name} (age: ${age}, COPPA: ${requiresParentalConsent ? 'required' : 'not required'})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'coppa',
      affectedStudentIds: [studentId]
    });

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
    const existingStudent = await databricksService.queryOne(`
      SELECT * FROM classwaves.users.students WHERE id = ? AND school_id = ?
    `, [studentId, school.id]);

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
    await databricksService.query(`
      UPDATE classwaves.users.students 
      SET has_parental_consent = ?, consent_date = ?, updated_at = ?
      WHERE id = ?
    `, [consentGiven, consentDate || now, now, studentId]);

    // Log audit event
    await databricksService.recordAuditLog({
      actorId: teacher.id,
      actorType: 'teacher',
      eventType: 'parental_consent_updated',
      eventCategory: 'compliance',
      resourceType: 'student',
      resourceId: studentId,
      schoolId: school.id,
      description: `Teacher ${teacher.email} updated parental consent for student: ${existingStudent.display_name} (consent: ${consentGiven ? 'granted' : 'denied'})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      complianceBasis: 'coppa',
      affectedStudentIds: [studentId]
    });

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
