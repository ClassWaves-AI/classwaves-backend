import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type {
  AnalyticsRepositoryPort,
  GroupCountsRow,
  MembershipAnalyticsRow,
  PlannedVsActualRow,
  ReadinessEventRow,
  SessionOwnershipResult,
  TeacherPromptMetricsRow,
} from '../../services/ports/analytics.repository.port';

export class DatabricksAnalyticsRepository implements AnalyticsRepositoryPort {
  async getTeacherPromptMetrics(teacherId: string, timeframe: string): Promise<TeacherPromptMetricsRow[]> {
    const sql = `
      SELECT 
        COUNT(*) as total_generated,
        COUNT(acknowledged_at) as total_acknowledged,
        COUNT(used_at) as total_used,
        COUNT(dismissed_at) as total_dismissed,
        AVG(response_time_seconds) as average_response_time,
        prompt_category,
        COUNT(*) as category_count
      FROM ${databricksConfig.catalog}.ai_insights.teacher_guidance_metrics
      WHERE teacher_id = ? 
        AND generated_at >= DATE_SUB(CURRENT_DATE(), INTERVAL ${this.getTimeframeInterval(timeframe)})
      GROUP BY prompt_category
    `;
    return (await databricksService.query(sql, [teacherId])) as any[];
  }

  async verifySessionOwnership(sessionId: string, teacherId: string, schoolId: string): Promise<SessionOwnershipResult> {
    const sql = `
      SELECT teacher_id, title as topic, scheduled_start, actual_end, status
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions
      WHERE id = ? AND school_id = ?
    `;
    const rows = await databricksService.query(sql, [sessionId, schoolId]);
    if (!rows || rows.length === 0) return { isOwner: false };
    const r = rows[0] as any;
    return {
      isOwner: r.teacher_id === teacherId,
      sessionInfo: {
        topic: r.topic ?? null,
        startTime: r.scheduled_start ?? null,
        endTime: r.actual_end ?? null,
        status: r.status ?? null,
      },
    };
  }

  async getPlannedVsActual(sessionId: string): Promise<PlannedVsActualRow | null> {
    const sql = `
      SELECT 
        planned_groups,
        planned_group_size,
        planned_duration_minutes,
        planned_members,
        planned_leaders,
        planned_scheduled_start,
        configured_at,
        started_at,
        started_without_ready_groups,
        ready_groups_at_start,
        ready_groups_at_5m,
        ready_groups_at_10m,
        adherence_members_ratio
      FROM ${databricksConfig.catalog}.analytics.session_metrics
      WHERE session_id = ?
    `;
    return (await databricksService.queryOne(sql, [sessionId])) as any;
  }

  async getReadinessEvents(sessionId: string): Promise<ReadinessEventRow[]> {
    const sql = `
      SELECT event_time, payload
      FROM ${databricksConfig.catalog}.analytics.session_events
      WHERE session_id = ? AND event_type = 'leader_ready'
      ORDER BY event_time
    `;
    return (await databricksService.query(sql, [sessionId])) as any[];
  }

  async getActualGroupCounts(sessionId: string): Promise<GroupCountsRow | null> {
    const sql = `
      SELECT 
        COUNT(DISTINCT sg.id) as actual_groups,
        AVG(sg.current_size) as actual_avg_group_size,
        SUM(sg.current_size) as actual_members,
        COUNT(DISTINCT sgm.student_id) as actual_unique_students,
        COUNT(DISTINCT CASE WHEN sg.leader_id = sgm.student_id THEN sgm.student_id END) as actual_leaders
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_group_members sgm ON sg.id = sgm.group_id
      WHERE sg.session_id = ?
    `;
    return (await databricksService.queryOne(sql, [sessionId])) as any;
  }

  async getMembershipAnalytics(sessionId: string): Promise<MembershipAnalyticsRow[]> {
    const sql = `
      SELECT 
        sg.id as group_id,
        sg.name as group_name,
        sg.leader_id,
        sg.current_size as configured_size,
        COUNT(sgm.student_id) as actual_member_count,
        COUNT(CASE WHEN sg.leader_id = sgm.student_id THEN 1 END) as leader_present,
        COUNT(CASE WHEN sg.leader_id != sgm.student_id THEN 1 END) as regular_members_present,
        MIN(sgm.created_at) as first_member_joined,
        MAX(sgm.created_at) as last_member_joined
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_group_members sgm ON sg.id = sgm.group_id
      WHERE sg.session_id = ?
      GROUP BY sg.id, sg.name, sg.leader_id, sg.current_size, sg.group_number
      ORDER BY sg.group_number
    `;
    return (await databricksService.query(sql, [sessionId])) as any[];
  }

  async getSessionGroupsAnalytics(sessionId: string): Promise<any[]> {
    const sql = `
      SELECT 
        sg.id,
        sg.name,
        sg.leader_id,
        sg.is_ready,
        sg.max_size as configured_size,
        sg.current_size as members_present,
        MAX(ga.leader_ready_at) as leader_ready_at,
        MAX(ga.members_configured) as members_configured,
        MAX(ga.configured_name) as configured_name,
        COUNT(sgm.student_id) as actual_member_count,
        COUNT(CASE WHEN sg.leader_id = sgm.student_id THEN 1 END) as leader_present,
        COUNT(CASE WHEN sg.leader_id != sgm.student_id THEN 1 END) as regular_members_count,
        MIN(sgm.created_at) as first_member_joined,
        MAX(sgm.created_at) as last_member_joined
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      LEFT JOIN ${databricksConfig.catalog}.analytics.group_metrics ga ON sg.id = ga.group_id
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_group_members sgm ON sg.id = sgm.group_id
      WHERE sg.session_id = ?
      GROUP BY sg.id, sg.name, sg.leader_id, sg.is_ready, sg.max_size, sg.current_size, 
               sg.group_number
      ORDER BY sg.group_number
    `;
    return (await databricksService.query(sql, [sessionId])) as any[];
  }

  async getSessionFinalSummary(sessionId: string): Promise<{ analytics_data?: string; computed_at?: string; status?: string } | null> {
    const sql = `
      SELECT analytics_data, computed_at, status
      FROM ${databricksConfig.catalog}.analytics.session_analytics 
      WHERE session_id = ? AND analysis_type = 'final_summary'
      ORDER BY computed_at DESC 
      LIMIT 1
    `;
    return (await databricksService.queryOne(sql, [sessionId])) as any;
  }

  async getLegacyMembershipRows(sessionId: string): Promise<any[]> {
    const sql = `
      SELECT 
        sg.id,
        sg.name,
        sg.max_size as configured_size,
        COUNT(sgm.student_id) as actual_member_count,
        COUNT(CASE WHEN sg.leader_id = sgm.student_id THEN 1 END) as leader_present,
        MIN(sgm.created_at) as first_member_joined,
        MAX(sgm.created_at) as last_member_joined
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_group_members sgm ON sg.id = sgm.group_id
      WHERE sg.session_id = ?
      GROUP BY sg.id, sg.name, sg.max_size
      ORDER BY sg.name
    `;
    return (await databricksService.query(sql, [sessionId])) as any[];
  }

  async upsertSessionMetrics(sessionId: string, data: Record<string, any>): Promise<void> {
    await databricksService.upsert('session_metrics', { session_id: sessionId }, {
      session_id: sessionId,
      ...data,
    });
  }

  async updateSessionMetrics(sessionId: string, fields: Record<string, any>): Promise<void> {
    await databricksService.update('session_metrics', `session_id = '${sessionId}'`, fields);
  }

  async insertTier1Analysis(data: Record<string, any>): Promise<void> {
    await databricksService.insert('ai_insights.tier1_analysis', data);
  }

  async insertTier2Analysis(data: Record<string, any>): Promise<void> {
    await databricksService.insert('ai_insights.tier2_analysis', data);
  }

  async getTier1Results(
    sessionId: string,
    options: { groupIds?: string[]; includeHistory?: boolean; hoursBack?: number; order?: 'ASC' | 'DESC' } = {}
  ): Promise<any[]> {
    const hoursBack = options.hoursBack ?? 2;
    let where = `WHERE session_id = ?`;
    const params: any[] = [sessionId];
    if (options.groupIds && options.groupIds.length > 0) {
      const placeholders = options.groupIds.map(() => '?').join(', ');
      where += ` AND group_id IN (${placeholders})`;
      params.push(...options.groupIds);
    }
    if (!options.includeHistory) {
      where += ` AND created_at >= CURRENT_TIMESTAMP() - INTERVAL ${hoursBack} HOURS`;
    }
    const order = options.order || 'ASC';
    const sql = `
      SELECT group_id, insights, created_at, analysis_timestamp
      FROM ${databricksConfig.catalog}.ai_insights.tier1_analysis 
      ${where}
      ORDER BY created_at ${order}`;
    return (await databricksService.query(sql, params)) as any[];
  }

  async getTier2Results(
    sessionId: string,
    options: { includeHistory?: boolean; hoursBack?: number; order?: 'ASC' | 'DESC' } = {}
  ): Promise<any[]> {
    const hoursBack = options.hoursBack ?? 2;
    let where = `WHERE session_id = ?`;
    const params: any[] = [sessionId];
    if (!options.includeHistory) {
      where += ` AND created_at >= CURRENT_TIMESTAMP() - INTERVAL ${hoursBack} HOURS`;
    }
    const order = options.order || 'ASC';
    const sql = `SELECT insights, created_at, analysis_timestamp
                 FROM ${databricksConfig.catalog}.ai_insights.tier2_analysis 
                 ${where}
                 ORDER BY created_at ${order}`;
    return (await databricksService.query(sql, params)) as any[];
  }

  private getTimeframeInterval(timeframe: string): string {
    const intervals: Record<string, string> = {
      session: '1 DAY',
      daily: '1 DAY',
      weekly: '7 DAY',
      monthly: '30 DAY',
      all_time: '365 DAY',
    };
    return intervals[timeframe] || '7 DAY';
  }
}

export const analyticsRepository: AnalyticsRepositoryPort = new DatabricksAnalyticsRepository();
