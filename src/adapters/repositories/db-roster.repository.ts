import type { DbPort } from '../../services/ports/db.port';
import type { RosterRepositoryPort, RosterStudent, RosterOverviewMetrics } from '../../services/ports/roster.repository.port';

const STUDENTS_TABLE = 'users.students';
const SCHOOLS_TABLE = 'users.schools';

function mapRow(row: any): RosterStudent {
  return {
    id: row.id,
    display_name: row.display_name,
    school_id: row.school_id,
    email: row.email,
    grade_level: row.grade_level,
    status: row.status,
    has_parental_consent: row.has_parental_consent,
    consent_date: row.consent_date,
    parent_email: row.parent_email,
    email_consent: row.email_consent,
    coppa_compliant: row.coppa_compliant,
    teacher_verified_age: row.teacher_verified_age,
    data_sharing_consent: row.data_sharing_consent,
    audio_recording_consent: row.audio_recording_consent,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function createDbRosterRepository(db: DbPort): RosterRepositoryPort {
  return {
    async listStudentsBySchool(schoolId, filters, limit, offset) {
      const where: string[] = ['school_id = ?'];
      const params: any[] = [schoolId];
      if (filters.gradeLevel) {
        where.push('grade_level = ?');
        params.push(filters.gradeLevel);
      }
      if (filters.status) {
        where.push('status = ?');
        params.push(filters.status);
      }
      const sql = `
        SELECT s.*, sch.name AS school_name
        FROM ${STUDENTS_TABLE} s
        LEFT JOIN ${SCHOOLS_TABLE} sch ON s.school_id = sch.id
        WHERE ${where.join(' AND ')}
        ORDER BY display_name ASC
        LIMIT ? OFFSET ?
      `;
      const rows = await db.query(sql, [...params, limit, offset]);
      return rows.map((row: any) => ({ ...mapRow(row), school_name: row.school_name }));
    },

    async countStudentsBySchool(schoolId, filters) {
      const where: string[] = ['school_id = ?'];
      const params: any[] = [schoolId];
      if (filters.gradeLevel) {
        where.push('grade_level = ?');
        params.push(filters.gradeLevel);
      }
      if (filters.status) {
        where.push('status = ?');
        params.push(filters.status);
      }
      const sql = `SELECT COUNT(*)::int AS total FROM ${STUDENTS_TABLE} WHERE ${where.join(' AND ')}`;
      const row = await db.queryOne<{ total: number }>(sql, params);
      return row?.total ?? 0;
    },

    async findStudentInSchool(studentId, schoolId) {
      const sql = `SELECT id, school_id, status, parent_email FROM ${STUDENTS_TABLE} WHERE id = ? AND school_id = ?`;
      return db.queryOne(sql, [studentId, schoolId]);
    },

    async findStudentByNameInSchool(schoolId, displayName) {
      const sql = `SELECT id FROM ${STUDENTS_TABLE} WHERE school_id = ? AND display_name = ?`;
      return db.queryOne(sql, [schoolId, displayName]);
    },

    async findStudentByEmailInSchool(schoolId, email) {
      const sql = `SELECT id FROM ${STUDENTS_TABLE} WHERE school_id = ? AND email = ?`;
      return db.queryOne(sql, [schoolId, email]);
    },

    async insertStudent(student) {
      await db.insert(STUDENTS_TABLE, student);
    },

    async updateStudentFields(studentId, fields) {
      if (!Object.keys(fields).length) return;
      await db.update(STUDENTS_TABLE, studentId, fields);
    },

    async updateStudentNames(studentId, names) {
      await db.update(STUDENTS_TABLE, studentId, names);
    },

    async getStudentWithSchool(studentId) {
      const sql = `
        SELECT s.*, sch.name AS school_name
        FROM ${STUDENTS_TABLE} s
        LEFT JOIN ${SCHOOLS_TABLE} sch ON s.school_id = sch.id
        WHERE s.id = ?
      `;
      const row = await db.queryOne(sql, [studentId]);
      return row ? ({ ...mapRow(row), school_name: row.school_name }) : null;
    },

    async getStudentBasicById(studentId) {
      const sql = `SELECT id, display_name, email FROM ${STUDENTS_TABLE} WHERE id = ?`;
      return db.queryOne(sql, [studentId]);
    },

    async setStudentDeactivated(studentId) {
      await db.update(STUDENTS_TABLE, studentId, { status: 'deactivated', updated_at: new Date() });
    },

    async deleteStudent(studentId) {
      const sql = `DELETE FROM ${STUDENTS_TABLE} WHERE id = ?`;
      await db.query(sql, [studentId]);
    },

    async countStudentGroupMembership() {
      // Local dev schema does not yet track join via JSON arrays; return 0 for compatibility
      return 0;
    },

    async updateParentalConsent(studentId, consentGiven, consentDateISO) {
      await db.update(STUDENTS_TABLE, studentId, {
        has_parental_consent: consentGiven,
        consent_date: consentDateISO,
        updated_at: new Date(),
      });
    },

    async getRosterOverviewMetrics(schoolId) {
      const sql = `
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_students,
          COUNT(*) FILTER (WHERE status = 'inactive')::int AS inactive_students,
          COUNT(*) FILTER (WHERE has_parental_consent IS NOT TRUE)::int AS pending_consent,
          COUNT(*)::int AS total_students
        FROM ${STUDENTS_TABLE}
        WHERE school_id = ?
      `;
      const row = await db.queryOne(sql, [schoolId]);
      return {
        totalStudents: row?.total_students ?? 0,
        activeStudents: row?.active_students ?? 0,
        pendingConsent: row?.pending_consent ?? 0,
        inactiveStudents: row?.inactive_students ?? 0,
      } satisfies RosterOverviewMetrics;
    },
  };
}
