import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type { AdminRepositoryPort, SchoolSummary, TeacherSummary } from '../../services/ports/admin.repository.port';

export class DatabricksAdminRepository implements AdminRepositoryPort {
  async listSchools(limit: number, offset: number): Promise<SchoolSummary[]> {
    const sql = `
      SELECT 
        id, name, domain, admin_email, subscription_tier, subscription_status,
        max_teachers, current_teachers, subscription_start_date, subscription_end_date,
        trial_ends_at, ferpa_agreement, coppa_compliant, data_retention_days, created_at, updated_at
      FROM ${databricksConfig.catalog}.users.schools
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return (await databricksService.query(sql)) as any[];
  }

  async countSchools(): Promise<number> {
    const row = await databricksService.queryOne(`SELECT COUNT(*) as total FROM ${databricksConfig.catalog}.users.schools`);
    return (row?.total as number) ?? 0;
  }

  async findSchoolByDomain(domain: string): Promise<{ id: string } | null> {
    const row = await databricksService.queryOne(`SELECT id FROM ${databricksConfig.catalog}.users.schools WHERE domain = ?`, [domain]);
    return (row as any) || null;
  }

  async findTeacherByEmail(email: string): Promise<{ id: string; school_id: string } | null> {
    const row = await databricksService.queryOne(
      `SELECT id, school_id FROM ${databricksConfig.catalog}.users.teachers WHERE lower(email) = lower(?)`,
      [email]
    );
    return (row as any) || null;
  }

  async insertSchool(school: any): Promise<void> {
    const sql = `
      INSERT INTO ${databricksConfig.catalog}.users.schools (
        id, name, domain, admin_email,
        subscription_tier, subscription_status, max_teachers,
        current_teachers, subscription_start_date, subscription_end_date,
        trial_ends_at, ferpa_agreement, coppa_compliant,
        data_retention_days, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await databricksService.query(sql, [
      school.id,
      school.name,
      school.domain,
      school.admin_email,
      school.subscription_tier,
      school.subscription_status,
      school.max_teachers,
      school.current_teachers,
      school.subscription_start_date,
      school.subscription_end_date,
      school.trial_ends_at,
      school.ferpa_agreement,
      school.coppa_compliant,
      school.data_retention_days,
      school.created_at,
      school.updated_at,
    ]);
  }

  async getSchoolSummaryById(schoolId: string): Promise<SchoolSummary | null> {
    const sql = `SELECT id, name, domain, subscription_status, subscription_tier, ferpa_agreement, coppa_compliant, admin_email FROM ${databricksConfig.catalog}.users.schools WHERE id = ?`;
    return (await databricksService.queryOne(sql, [schoolId])) as any;
  }

  async updateSchoolById(schoolId: string, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const set = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => fields[k]);
    const sql = `UPDATE ${databricksConfig.catalog}.users.schools SET ${set} WHERE id = ?`;
    await databricksService.query(sql, [...values, schoolId]);
  }

  async listTeachers(filter: { schoolId?: string }, limit: number, offset: number): Promise<TeacherSummary[]> {
    let whereClause = '';
    const params: any[] = [];
    if (filter.schoolId) { whereClause = 'WHERE t.school_id = ?'; params.push(filter.schoolId); }
    const sql = `
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
      FROM ${databricksConfig.catalog}.users.teachers t
      JOIN ${databricksConfig.catalog}.users.schools s ON t.school_id = s.id
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return (await databricksService.query(sql, params)) as any[];
  }

  async countTeachers(filter: { schoolId?: string }): Promise<number> {
    let whereClause = '';
    const params: any[] = [];
    if (filter.schoolId) { whereClause = 'WHERE t.school_id = ?'; params.push(filter.schoolId); }
    const sql = `SELECT COUNT(*) as total FROM ${databricksConfig.catalog}.users.teachers t ${whereClause}`;
    const row = await databricksService.queryOne(sql, params);
    return (row?.total as number) ?? 0;
  }

  async getTeacherSummaryById(teacherId: string): Promise<TeacherSummary | null> {
    const sql = `
      SELECT 
        t.id,
        t.google_id,
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
        t.login_count,
        t.total_sessions_created,
        t.created_at,
        t.updated_at,
        s.name as school_name,
        s.domain as school_domain
      FROM ${databricksConfig.catalog}.users.teachers t
      JOIN ${databricksConfig.catalog}.users.schools s ON t.school_id = s.id
      WHERE t.id = ?
    `;
    return (await databricksService.queryOne(sql, [teacherId])) as any;
  }

  async updateTeacherById(teacherId: string, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const set = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => fields[k]);
    const sql = `UPDATE ${databricksConfig.catalog}.users.teachers SET ${set} WHERE id = ?`;
    await databricksService.query(sql, [...values, teacherId]);
  }

  async insertTeacher(teacher: {
    id: string;
    email: string;
    name: string;
    school_id: string;
    role: string;
    status: string;
    access_level?: string | null;
    created_at: string;
    updated_at: string;
  }): Promise<void> {
    const sql = `
      INSERT INTO ${databricksConfig.catalog}.users.teachers (
        id, email, name, school_id, role, status, access_level, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await databricksService.query(sql, [
      teacher.id,
      teacher.email,
      teacher.name,
      teacher.school_id,
      teacher.role,
      teacher.status,
      teacher.access_level ?? null,
      teacher.created_at,
      teacher.updated_at,
    ]);
  }

  // Districts (admin schema)
  async listDistricts(filter: { state?: string; q?: string; isActive?: boolean }, limit: number, offset: number): Promise<any[]> {
    const where: string[] = []
    const params: any[] = []
    if (filter.state) { where.push('state = ?'); params.push(filter.state) }
    if (filter.isActive != null) { where.push('is_active = ?'); params.push(filter.isActive ? true : false) }
    if (filter.q) { where.push('(lower(name) LIKE lower(?) OR lower(region) LIKE lower(?))'); params.push(`%${filter.q}%`, `%${filter.q}%`) }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const sql = `
      SELECT id, name, state, region, superintendent_name, contact_email, contact_phone, website, subscription_tier, is_active, created_at, updated_at
      FROM ${databricksConfig.catalog}.admin.districts
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `
    return (await databricksService.query(sql, params)) as any[]
  }

  async countDistricts(filter: { state?: string; q?: string; isActive?: boolean }): Promise<number> {
    const where: string[] = []
    const params: any[] = []
    if (filter.state) { where.push('state = ?'); params.push(filter.state) }
    if (filter.isActive != null) { where.push('is_active = ?'); params.push(filter.isActive ? true : false) }
    if (filter.q) { where.push('(lower(name) LIKE lower(?) OR lower(region) LIKE lower(?))'); params.push(`%${filter.q}%`, `%${filter.q}%`) }
    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    const row = await databricksService.queryOne(`SELECT COUNT(*) as total FROM ${databricksConfig.catalog}.admin.districts ${whereClause}`, params)
    return (row?.total as number) ?? 0
  }

  async getDistrictById(id: string): Promise<any | null> {
    const sql = `
      SELECT id, name, state, region, superintendent_name, contact_email, contact_phone, website, subscription_tier, is_active, created_at, updated_at
      FROM ${databricksConfig.catalog}.admin.districts WHERE id = ?
    `
    return (await databricksService.queryOne(sql, [id])) as any
  }

  async insertDistrict(district: any): Promise<void> {
    const sql = `
      INSERT INTO ${databricksConfig.catalog}.admin.districts (
        id, name, state, region, superintendent_name, contact_email, contact_phone, website, subscription_tier, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    await databricksService.query(sql, [
      district.id,
      district.name,
      district.state,
      district.region ?? null,
      district.superintendent_name ?? null,
      district.contact_email ?? null,
      district.contact_phone ?? null,
      district.website ?? null,
      district.subscription_tier ?? null,
      district.is_active ?? true,
      district.created_at,
      district.updated_at,
    ])
  }

  async updateDistrictById(id: string, fields: Record<string, any>): Promise<void> {
    const keys = Object.keys(fields)
    if (keys.length === 0) return
    const set = keys.map((k) => `${k} = ?`).join(', ')
    const values = keys.map((k) => fields[k])
    const sql = `UPDATE ${databricksConfig.catalog}.admin.districts SET ${set} WHERE id = ?`
    await databricksService.query(sql, [...values, id])
  }
}

export const adminRepository: AdminRepositoryPort = new DatabricksAdminRepository();
