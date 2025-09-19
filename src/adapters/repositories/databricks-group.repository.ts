import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type { GroupRepositoryPort } from '../../services/ports/group.repository.port';

export class DatabricksGroupRepository implements GroupRepositoryPort {
  async countReady(sessionId: string): Promise<number> {
    const sql = `
      SELECT COUNT(*) as ready_groups_count
      FROM ${databricksConfig.catalog}.sessions.student_groups
      WHERE session_id = ? AND is_ready = true
    `;
    const row = await databricksService.queryOne(sql, [sessionId]);
    return (row?.ready_groups_count as number) ?? 0;
  }

  async countTotal(sessionId: string): Promise<number> {
    const sql = `
      SELECT COUNT(*) as total_groups_count
      FROM ${databricksConfig.catalog}.sessions.student_groups
      WHERE session_id = ?
    `;
    const row = await databricksService.queryOne(sql, [sessionId]);
    return (row?.total_groups_count as number) ?? 0;
  }

  async getGroupsBasic(sessionId: string): Promise<Array<{ id: string; name: string | null; leader_id: string | null; is_ready: boolean | null; group_number: number | null }>> {
    const sql = `
      SELECT id, name, leader_id, is_ready, group_number
      FROM ${databricksConfig.catalog}.sessions.student_groups
      WHERE session_id = ?
      ORDER BY group_number
    `;
    return (await databricksService.query(sql, [sessionId])) as any[];
  }

  async getMembersBySession(sessionId: string): Promise<Array<{ group_id: string; student_id: string; name: string | null }>> {
    const sql = `
      SELECT m.group_id, m.student_id, s.display_name as name
      FROM ${databricksConfig.catalog}.sessions.student_group_members m
      LEFT JOIN ${databricksConfig.catalog}.users.students s ON m.student_id = s.id
      WHERE m.session_id = ?
    `;
    return (await databricksService.query(sql, [sessionId])) as any[];
  }

  async findLeaderAssignmentByEmail(sessionId: string, email: string) {
    const sql = `
      SELECT 
        sg.id as group_id,
        sg.name as group_name,
        sg.leader_id,
        s.display_name as leader_name,
        s.email as leader_email
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      JOIN ${databricksConfig.catalog}.users.students s ON sg.leader_id = s.id
      WHERE sg.session_id = ? AND LOWER(s.email) = LOWER(?)`;
    return (await databricksService.query(sql, [sessionId, email])) as any[];
  }

  async findLeaderAssignmentByName(sessionId: string, displayName: string) {
    const sql = `
      SELECT 
        sg.id as group_id,
        sg.name as group_name,
        sg.leader_id,
        s.display_name as leader_name,
        s.email as leader_email
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      JOIN ${databricksConfig.catalog}.users.students s ON sg.leader_id = s.id
      WHERE sg.session_id = ? AND s.display_name = ?`;
    return (await databricksService.query(sql, [sessionId, displayName])) as any[];
  }

  async insertGroup(data: Record<string, any>): Promise<void> {
    await databricksService.insert('student_groups', data);
  }

  async insertGroupMember(data: Record<string, any>): Promise<void> {
    await databricksService.insert('student_group_members', data);
  }

  async updateGroupFields(groupId: string, fields: Record<string, any>): Promise<void> {
    await databricksService.update('sessions.student_groups', groupId, fields);
  }

  async countTotalStudentsForTeacher(teacherId: string): Promise<number> {
    const sql = `
      SELECT COALESCE(SUM(g.current_size), 0) as count
      FROM ${databricksConfig.catalog}.sessions.student_groups g
      INNER JOIN ${databricksConfig.catalog}.sessions.classroom_sessions s 
        ON g.session_id = s.id
      WHERE s.teacher_id = ?`;
    const row = await databricksService.queryOne(sql, [teacherId]);
    return (row?.count as number) ?? 0;
  }

  async getGroupSessionAndNameById(groupId: string): Promise<{ session_id: string; name: string | null } | null> {
    const sql = `SELECT session_id, name FROM ${databricksConfig.catalog}.sessions.student_groups WHERE id = ?`;
    return (await databricksService.queryOne(sql, [groupId])) as any;
  }

  async groupExistsInSession(sessionId: string, groupId: string): Promise<boolean> {
    const sql = `SELECT id FROM ${databricksConfig.catalog}.sessions.student_groups WHERE id = ? AND session_id = ?`;
    const row = await databricksService.queryOne(sql, [groupId, sessionId]);
    return Boolean(row);
  }
}

export const groupRepository: GroupRepositoryPort = new DatabricksGroupRepository();
