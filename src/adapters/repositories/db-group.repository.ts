import type { GroupRepositoryPort } from '../../services/ports/group.repository.port';
import type { DbPort } from '../../services/ports/db.port';

import { normalizeTableFqn } from '../db/fqn.utils';
const { identifier: GROUP_TABLE } = normalizeTableFqn('classwaves.sessions.student_groups');
const { identifier: MEMBERS_TABLE } = normalizeTableFqn('classwaves.sessions.student_group_members');
const { identifier: SESSION_TABLE } = normalizeTableFqn('classwaves.sessions.classroom_sessions');
const { identifier: STUDENTS_TABLE } = normalizeTableFqn('classwaves.users.students');

export class DbGroupRepository implements GroupRepositoryPort {
  constructor(private readonly db: DbPort) {}

  async countReady(sessionId: string): Promise<number> {
    const sql = `SELECT COUNT(*)::int AS ready_groups_count FROM ${GROUP_TABLE} WHERE session_id = ? AND is_ready IS TRUE`;
    const row = await this.db.queryOne<{ ready_groups_count: number }>(sql, [sessionId]);
    return row?.ready_groups_count ?? 0;
  }

  async countTotal(sessionId: string): Promise<number> {
    const sql = `SELECT COUNT(*)::int AS total_groups_count FROM ${GROUP_TABLE} WHERE session_id = ?`;
    const row = await this.db.queryOne<{ total_groups_count: number }>(sql, [sessionId]);
    return row?.total_groups_count ?? 0;
  }

  async getGroupsBasic(sessionId: string): Promise<Array<{ id: string; name: string | null; leader_id: string | null; is_ready: boolean | null; group_number: number | null }>> {
    const sql = `
      SELECT id, name, leader_id, is_ready, group_number
      FROM ${GROUP_TABLE}
      WHERE session_id = ?
      ORDER BY group_number NULLS LAST
    `;
    return this.db.query<{ id: string; name: string | null; leader_id: string | null; is_ready: boolean | null; group_number: number | null }>(
      sql,
      [sessionId]
    );
  }

  async getMembersBySession(sessionId: string): Promise<Array<{ group_id: string; student_id: string; name: string | null }>> {
    const sql = `
      SELECT 
        m.group_id,
        m.student_id,
        COALESCE(
          s.display_name,
          NULLIF(s.preferred_name, ''),
          NULLIF(TRIM(CONCAT_WS(' ', s.given_name, s.family_name)), '')
        ) AS name
      FROM ${MEMBERS_TABLE} m
      LEFT JOIN ${STUDENTS_TABLE} s ON m.student_id = s.id
      WHERE m.session_id = ?
    `;
    return this.db.query<{ group_id: string; student_id: string; name: string | null }>(sql, [sessionId]);
  }

  async findLeaderAssignmentByEmail(sessionId: string, email: string) {
    const sql = `
      SELECT
        sg.id AS group_id,
        sg.name AS group_name,
        sg.leader_id,
        COALESCE(
          s.display_name,
          NULLIF(s.preferred_name, ''),
          NULLIF(TRIM(CONCAT_WS(' ', s.given_name, s.family_name)), '')
        ) AS leader_name,
        s.email AS leader_email
      FROM ${GROUP_TABLE} sg
      JOIN ${STUDENTS_TABLE} s ON sg.leader_id = s.id
      WHERE sg.session_id = ? AND LOWER(s.email) = LOWER(?)
    `;
    return this.db.query<{ group_id: string; group_name: string; leader_id: string; leader_name: string; leader_email: string }>(
      sql,
      [sessionId, email]
    );
  }

  async findLeaderAssignmentByName(sessionId: string, displayName: string) {
    const sql = `
      SELECT
        sg.id AS group_id,
        sg.name AS group_name,
        sg.leader_id,
        COALESCE(
          s.display_name,
          NULLIF(s.preferred_name, ''),
          NULLIF(TRIM(CONCAT_WS(' ', s.given_name, s.family_name)), '')
        ) AS leader_name,
        s.email AS leader_email
      FROM ${GROUP_TABLE} sg
      JOIN ${STUDENTS_TABLE} s ON sg.leader_id = s.id
      WHERE sg.session_id = ? AND COALESCE(
          s.display_name,
          NULLIF(s.preferred_name, ''),
          NULLIF(TRIM(CONCAT_WS(' ', s.given_name, s.family_name)), '')
        ) = ?
    `;
    return this.db.query<{ group_id: string; group_name: string; leader_id: string; leader_name: string; leader_email: string | null }>(
      sql,
      [sessionId, displayName]
    );
  }

  async insertGroup(data: Record<string, unknown>): Promise<void> {
    await this.db.insert(GROUP_TABLE, data);
  }

  async insertGroupMember(data: Record<string, unknown>): Promise<void> {
    await this.db.insert(MEMBERS_TABLE, data);
  }

  async updateGroupFields(groupId: string, fields: Record<string, unknown>): Promise<void> {
    await this.db.update(GROUP_TABLE, groupId, { ...fields, updated_at: new Date() });
  }

  async countTotalStudentsForTeacher(teacherId: string): Promise<number> {
    const sql = `
      SELECT COALESCE(SUM(g.current_size), 0)::int AS count
      FROM ${GROUP_TABLE} g
      INNER JOIN ${SESSION_TABLE} s ON g.session_id = s.id
      WHERE s.teacher_id = ?
    `;
    const row = await this.db.queryOne<{ count: number }>(sql, [teacherId]);
    return row?.count ?? 0;
  }

  async getGroupSessionAndNameById(groupId: string): Promise<{ session_id: string; name: string | null } | null> {
    const sql = `SELECT session_id, name FROM ${GROUP_TABLE} WHERE id = ?`;
    return (await this.db.queryOne(sql, [groupId])) ?? null;
  }

  async groupExistsInSession(sessionId: string, groupId: string): Promise<boolean> {
    const sql = `SELECT id FROM ${GROUP_TABLE} WHERE id = ? AND session_id = ?`;
    const row = await this.db.queryOne(sql, [groupId, sessionId]);
    return Boolean(row);
  }
}

export function createDbGroupRepository(db: DbPort): GroupRepositoryPort {
  return new DbGroupRepository(db);
}
