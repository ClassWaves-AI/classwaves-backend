import type { SessionRepositoryPort, SessionStatus, SessionBasic } from '../../services/ports/session.repository.port';
import type { DbPort } from '../../services/ports/db.port';

const SESSION_TABLE = 'classwaves.sessions.classroom_sessions';
const GROUP_TABLE = 'classwaves.sessions.student_groups';

export class DbSessionRepository implements SessionRepositoryPort {
  constructor(private readonly db: DbPort) {}

  async getOwnedSessionBasic(sessionId: string, teacherId: string): Promise<SessionBasic | null> {
    const sql = `
      SELECT id, status, teacher_id, school_id, title, description, access_code, planned_duration_minutes, created_at
      FROM ${SESSION_TABLE}
      WHERE id = ? AND teacher_id = ?
    `;
    return (await this.db.queryOne<SessionBasic>(sql, [sessionId, teacherId])) ?? null;
  }

  async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.db.update(SESSION_TABLE, sessionId, { status, updated_at: new Date() });
  }

  async updateOnStart(sessionId: string, startedAt: Date): Promise<void> {
    await this.db.update(SESSION_TABLE, sessionId, {
      status: 'active',
      actual_start: startedAt,
      updated_at: startedAt,
    });
  }

  async insertSession(data: Record<string, unknown>): Promise<void> {
    await this.db.insert(SESSION_TABLE, data);
  }

  async updateFields(sessionId: string, fields: Record<string, unknown>): Promise<void> {
    await this.db.update(SESSION_TABLE, sessionId, { ...fields, updated_at: new Date() });
  }

  async countActiveSessionsForTeacher(teacherId: string): Promise<number> {
    const sql = `
      SELECT COUNT(*)::int AS count
      FROM ${SESSION_TABLE}
      WHERE teacher_id = ? AND status = 'active'
    `;
    const row = await this.db.queryOne<{ count: number }>(sql, [teacherId]);
    return row?.count ?? 0;
  }

  async countTodaySessionsForTeacher(teacherId: string): Promise<number> {
    const sql = `
      SELECT COUNT(*)::int AS count
      FROM ${SESSION_TABLE}
      WHERE teacher_id = ?
        AND (
          DATE(scheduled_start) = CURRENT_DATE
          OR DATE(created_at) = CURRENT_DATE
        )
    `;
    const row = await this.db.queryOne<{ count: number }>(sql, [teacherId]);
    return row?.count ?? 0;
  }

  async getOwnedSessionLifecycle(sessionId: string, teacherId: string): Promise<{
    id: string;
    status: SessionStatus;
    teacher_id: string;
    school_id: string;
    actual_start: Date | null;
    created_at: Date | null;
    participation_rate?: number;
    engagement_score?: number;
  } | null> {
    const sql = `
      SELECT id, status, teacher_id, school_id, actual_start, created_at, participation_rate, engagement_score
      FROM ${SESSION_TABLE}
      WHERE id = ? AND teacher_id = ?
    `;
    return (await this.db.queryOne(sql, [sessionId, teacherId])) ?? null;
  }

  async getBasic(sessionId: string): Promise<SessionBasic | null> {
    const sql = `
      SELECT id, status, teacher_id, school_id, title, description, access_code, planned_duration_minutes, created_at
      FROM ${SESSION_TABLE}
      WHERE id = ?
    `;
    return (await this.db.queryOne<SessionBasic>(sql, [sessionId])) ?? null;
  }

  async listOwnedSessionIds(teacherId: string): Promise<string[]> {
    const sql = `
      SELECT id
      FROM ${SESSION_TABLE}
      WHERE teacher_id = ?
      ORDER BY created_at DESC
    `;
    const rows = await this.db.query<{ id: string }>(sql, [teacherId]);
    return rows.map((row) => row.id);
  }

  async listOwnedSessionsForList(
    teacherId: string,
    limit: number
  ): Promise<Array<SessionBasic & { group_count: number; student_count: number; participation_rate?: number; engagement_score?: number }>> {
    const sql = `
      SELECT
        s.id,
        s.status,
        s.teacher_id,
        s.school_id,
        s.title,
        s.description,
        s.goal,
        s.subject,
        s.target_group_size,
        s.scheduled_start,
        s.actual_start,
        s.planned_duration_minutes,
        s.created_at,
        s.access_code,
        COALESCE(g.group_count, 0) AS group_count,
        COALESCE(g.student_count, 0) AS student_count,
        s.participation_rate,
        s.engagement_score
      FROM ${SESSION_TABLE} s
      LEFT JOIN (
        SELECT
          session_id,
          COUNT(*) AS group_count,
          COALESCE(SUM(current_size), 0) AS student_count
        FROM ${GROUP_TABLE}
        GROUP BY session_id
      ) g ON s.id = g.session_id
      WHERE s.teacher_id = ?
      ORDER BY s.created_at DESC
      LIMIT ?
    `;
    return this.db.query<SessionBasic & { group_count: number; student_count: number; participation_rate?: number; engagement_score?: number }>(
      sql,
      [teacherId, limit]
    );
  }

  async listOwnedSessionsForDashboard(
    teacherId: string,
    limit = 3
  ): Promise<Array<SessionBasic & { group_count: number; student_count: number; participation_rate?: number; engagement_score?: number; access_code?: string }>> {
    const sql = `
      SELECT
        s.id,
        s.status,
        s.teacher_id,
        s.school_id,
        s.title,
        s.description,
        s.goal,
        s.subject,
        s.scheduled_start,
        s.actual_start,
        s.created_at,
        s.target_group_size,
        COALESCE(g.group_count, 0) AS group_count,
        COALESCE(g.student_count, 0) AS student_count,
        s.participation_rate,
        s.engagement_score,
        s.access_code
      FROM ${SESSION_TABLE} s
      LEFT JOIN (
        SELECT
          session_id,
          COUNT(*) AS group_count,
          COALESCE(SUM(current_size), 0) AS student_count
        FROM ${GROUP_TABLE}
        GROUP BY session_id
      ) g ON s.id = g.session_id
      WHERE s.teacher_id = ?
      ORDER BY s.created_at DESC
      LIMIT ?
    `;
    return this.db.query<SessionBasic & {
      group_count: number;
      student_count: number;
      participation_rate?: number;
      engagement_score?: number;
      access_code?: string;
    }>(sql, [teacherId, limit]);
  }

  async getByAccessCode(accessCode: string): Promise<any | null> {
    const sql = `
      SELECT id, status, teacher_id, school_id, title, description, access_code
      FROM ${SESSION_TABLE}
      WHERE access_code = ?
    `;
    return (await this.db.queryOne(sql, [accessCode])) ?? null;
  }
}

export function createDbSessionRepository(db: DbPort): SessionRepositoryPort {
  return new DbSessionRepository(db);
}
