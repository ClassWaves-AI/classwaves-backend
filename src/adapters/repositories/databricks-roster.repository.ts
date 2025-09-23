import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type { RosterOverviewMetrics, RosterRepositoryPort, RosterStudent } from '../../services/ports/roster.repository.port';

export class DatabricksRosterRepository implements RosterRepositoryPort {
  async listStudentsBySchool(schoolId: string, filters: { gradeLevel?: string; status?: string }, limit: number, offset: number) {
    const where: string[] = ['s.school_id = ?'];
    const params: any[] = [schoolId];
    if (filters.gradeLevel) { where.push('s.grade_level = ?'); params.push(filters.gradeLevel); }
    if (filters.status) { where.push('s.status = ?'); params.push(filters.status); }
    const whereClause = `WHERE ${where.join(' AND ')}`;
    const sql = `
      SELECT 
        s.id,
        s.display_name,
        s.school_id,
        s.email,
        s.grade_level,
        s.status,
        s.has_parental_consent,
        s.consent_date,
        s.parent_email,
        s.email_consent,
        s.coppa_compliant,
        s.teacher_verified_age,
        s.data_sharing_consent,
        s.audio_recording_consent,
        s.created_at,
        s.updated_at,
        sch.name as school_name
      FROM ${databricksConfig.catalog}.users.students s
      JOIN ${databricksConfig.catalog}.users.schools sch ON s.school_id = sch.id
      ${whereClause}
      ORDER BY s.display_name ASC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return (await databricksService.query(sql, params)) as Array<RosterStudent & { school_name?: string }>;
  }

  async countStudentsBySchool(schoolId: string, filters: { gradeLevel?: string; status?: string }) {
    const where: string[] = ['s.school_id = ?'];
    const params: any[] = [schoolId];
    if (filters.gradeLevel) { where.push('s.grade_level = ?'); params.push(filters.gradeLevel); }
    if (filters.status) { where.push('s.status = ?'); params.push(filters.status); }
    const sql = `SELECT COUNT(*) as total FROM ${databricksConfig.catalog}.users.students s WHERE ${where.join(' AND ')}`;
    const row = await databricksService.queryOne(sql, params);
    return (row?.total as number) ?? 0;
  }

  async findStudentInSchool(studentId: string, schoolId: string) {
    const sql = `
      SELECT id, school_id, status, parent_email
      FROM ${databricksConfig.catalog}.users.students
      WHERE id = ? AND school_id = ?
    `;
    return (await databricksService.queryOne(sql, [studentId, schoolId])) as any;
  }

  async findStudentByNameInSchool(schoolId: string, displayName: string) {
    const sql = `SELECT id FROM ${databricksConfig.catalog}.users.students WHERE school_id = ? AND display_name = ?`;
    return (await databricksService.queryOne(sql, [schoolId, displayName])) as any;
  }

  async findStudentByEmailInSchool(schoolId: string, email: string) {
    const sql = `SELECT id FROM ${databricksConfig.catalog}.users.students WHERE school_id = ? AND lower(email) = lower(?)`;
    return (await databricksService.queryOne(sql, [schoolId, email])) as any;
  }

  async insertStudent(student: RosterStudent & { status: string; created_at: string; updated_at: string }) {
    const sql = `
      INSERT INTO ${databricksConfig.catalog}.users.students (
        id, display_name, school_id, email, grade_level, status,
        has_parental_consent, consent_date, parent_email,
        email_consent, data_sharing_consent, audio_recording_consent,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await databricksService.query(sql, [
      student.id,
      student.display_name,
      student.school_id,
      student.email,
      student.grade_level,
      student.status,
      student.has_parental_consent,
      student.consent_date,
      student.parent_email,
      student.email_consent,
      student.data_sharing_consent,
      student.audio_recording_consent,
      student.created_at,
      student.updated_at,
    ]);
  }

  async updateStudentFields(studentId: string, fields: Record<string, any>) {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const set = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => fields[k]);
    const sql = `UPDATE ${databricksConfig.catalog}.users.students SET ${set} WHERE id = ?`;
    await databricksService.query(sql, [...values, studentId]);
  }

  async updateStudentNames(studentId: string, names: { given_name?: string | null; family_name?: string | null; preferred_name?: string | null; updated_at?: string }) {
    const sql = `UPDATE ${databricksConfig.catalog}.users.students SET given_name = COALESCE(?, given_name), family_name = COALESCE(?, family_name), preferred_name = COALESCE(?, preferred_name), updated_at = ? WHERE id = ?`;
    await databricksService.query(sql, [names.given_name ?? null, names.family_name ?? null, names.preferred_name ?? null, names.updated_at ?? new Date().toISOString(), studentId]);
  }

  async getStudentWithSchool(studentId: string) {
    const sql = `
      SELECT 
        s.id,
        s.display_name,
        s.school_id,
        s.email,
        s.grade_level,
        s.status,
        s.has_parental_consent,
        s.consent_date,
        s.parent_email,
        s.email_consent,
        s.coppa_compliant,
        s.teacher_verified_age,
        s.data_sharing_consent,
        s.audio_recording_consent,
        s.created_at,
        s.updated_at,
        sch.name as school_name
      FROM ${databricksConfig.catalog}.users.students s
      JOIN ${databricksConfig.catalog}.users.schools sch ON s.school_id = sch.id
      WHERE s.id = ?
    `;
    return (await databricksService.queryOne(sql, [studentId])) as any;
  }

  async getStudentBasicById(studentId: string) {
    const sql = `SELECT id, display_name, email FROM ${databricksConfig.catalog}.users.students WHERE id = ?`;
    return (await databricksService.queryOne(sql, [studentId])) as any;
  }

  async setStudentDeactivated(studentId: string) {
    const sql = `UPDATE ${databricksConfig.catalog}.users.students SET status = 'deactivated', updated_at = ? WHERE id = ?`;
    await databricksService.query(sql, [new Date().toISOString(), studentId]);
  }

  async deleteStudent(studentId: string) {
    const sql = `DELETE FROM ${databricksConfig.catalog}.users.students WHERE id = ?`;
    await databricksService.query(sql, [studentId]);
  }

  async countStudentGroupMembership(studentId: string) {
    const sql = `
      SELECT COUNT(*) as group_count 
      FROM ${databricksConfig.catalog}.sessions.student_groups 
      WHERE JSON_ARRAY_CONTAINS(student_ids, ?)
    `;
    const row = await databricksService.queryOne(sql, [studentId]);
    return (row?.group_count as number) ?? 0;
  }

  async updateParentalConsent(studentId: string, consentGiven: boolean, consentDateISO: string) {
    const sql = `
      UPDATE ${databricksConfig.catalog}.users.students 
      SET has_parental_consent = ?, consent_date = ?, updated_at = ?
      WHERE id = ?
    `;
    await databricksService.query(sql, [consentGiven, consentDateISO, consentDateISO, studentId]);
  }

  async getRosterOverviewMetrics(schoolId: string): Promise<RosterOverviewMetrics> {
    const sql = `
      SELECT 
        COUNT(*) as totalStudents,
        COUNT(CASE WHEN s.status = 'active' THEN 1 END) as activeStudents,
        COUNT(CASE WHEN s.parent_email IS NOT NULL AND s.has_parental_consent = false THEN 1 END) as pendingConsent,
        COUNT(CASE WHEN s.status != 'active' THEN 1 END) as inactiveStudents
      FROM ${databricksConfig.catalog}.users.students s
      WHERE s.school_id = ?
    `;
    const row = await databricksService.queryOne(sql, [schoolId]);
    return {
      totalStudents: (row?.totalStudents as number) ?? 0,
      activeStudents: (row?.activeStudents as number) ?? 0,
      pendingConsent: (row?.pendingConsent as number) ?? 0,
      inactiveStudents: (row?.inactiveStudents as number) ?? 0,
    };
  }
}

export const rosterRepository: RosterRepositoryPort = new DatabricksRosterRepository();
