import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type { SessionBasic, SessionRepositoryPort, SessionStatus } from '../../services/ports/session.repository.port';

export class DatabricksSessionRepository implements SessionRepositoryPort {
  async getOwnedSessionBasic(sessionId: string, teacherId: string): Promise<SessionBasic | null> {
    const sql = `
      SELECT id, status, teacher_id, school_id
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions
      WHERE id = ? AND teacher_id = ?
    `;
    const row = await databricksService.queryOne(sql, [sessionId, teacherId]);
    return row ? (row as SessionBasic) : null;
  }

  async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await databricksService.updateSessionStatus(sessionId, status);
  }

  async updateOnStart(sessionId: string, startedAt: Date): Promise<void> {
    await databricksService.update('classroom_sessions', sessionId, {
      status: 'active',
      actual_start: startedAt,
      updated_at: startedAt,
    });
  }

  async insertSession(data: Record<string, any>): Promise<void> {
    await databricksService.insert('classroom_sessions', data);
  }

  async updateFields(sessionId: string, fields: Record<string, any>): Promise<void> {
    await databricksService.update('classroom_sessions', sessionId, fields);
  }

  async countActiveSessionsForTeacher(teacherId: string): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions 
      WHERE teacher_id = ? AND status = 'active'`;
    const row = await databricksService.queryOne(sql, [teacherId]);
    return (row?.count as number) ?? 0;
  }

  async countTodaySessionsForTeacher(teacherId: string): Promise<number> {
    const sql = `
      SELECT COUNT(*) as count
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions 
      WHERE teacher_id = ? 
      AND (
        DATE(scheduled_start) = CURRENT_DATE()
        OR DATE(created_at) = CURRENT_DATE()
      )`;
    const row = await databricksService.queryOne(sql, [teacherId]);
    return (row?.count as number) ?? 0;
  }

  async getOwnedSessionLifecycle(sessionId: string, teacherId: string): Promise<{
    id: string;
    status: SessionStatus;
    teacher_id: string;
    school_id: string;
    actual_start: Date | null;
    created_at: Date | null;
  } | null> {
    const sql = `
      SELECT id, status, teacher_id, school_id, actual_start, created_at
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions
      WHERE id = ? AND teacher_id = ?
    `;
    const row = await databricksService.queryOne(sql, [sessionId, teacherId]);
    return row ? (row as any) : null;
  }

  async getBasic(sessionId: string) {
    const sql = `
      SELECT id, status, teacher_id, school_id
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions
      WHERE id = ?
    `;
    const row = await databricksService.queryOne(sql, [sessionId]);
    return row ? (row as any) : null;
  }

  async listOwnedSessionIds(teacherId: string): Promise<string[]> {
    const sql = `
      SELECT id
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions
      WHERE teacher_id = ?
    `;
    const rows = await databricksService.query(sql, [teacherId]);
    return (rows || []).map((r: any) => r.id);
  }

  async listOwnedSessionsForList(
    teacherId: string,
    limit: number
  ): Promise<Array<SessionBasic & { group_count: number; student_count: number; participation_rate?: number; engagement_score?: number }>> {
    const sql = `
      SELECT
        s.id, s.status, s.teacher_id, s.school_id,
        s.title, s.description, s.target_group_size, s.scheduled_start, s.actual_start,
        s.planned_duration_minutes, s.created_at,
        g.group_count,
        g.student_count,
        sa.participation_rate,
        sa.engagement_score
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions s
      LEFT JOIN (
        SELECT session_id,
               COUNT(*) as group_count,
               COALESCE(SUM(current_size), 0) as student_count
        FROM ${databricksConfig.catalog}.sessions.student_groups
        GROUP BY session_id
      ) g ON s.id = g.session_id
      LEFT JOIN ${databricksConfig.catalog}.analytics.session_analytics sa ON sa.session_id = s.id
      WHERE s.teacher_id = ?
      ORDER BY s.created_at DESC
      LIMIT ?
    `;
    return (await databricksService.query(sql, [teacherId, limit])) as any[];
  }

  async getByAccessCode(accessCode: string): Promise<any | null> {
    const sql = `
      SELECT id, status, teacher_id, school_id, title, description, access_code
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions
      WHERE access_code = ?
    `;
    const row = await databricksService.queryOne(sql, [accessCode]);
    return row ? (row as any) : null;
  }
}

export const sessionRepository: SessionRepositoryPort = new DatabricksSessionRepository();
