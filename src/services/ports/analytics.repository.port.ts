export interface TeacherPromptMetricsRow {
  total_generated: number;
  total_acknowledged: number;
  total_used: number;
  total_dismissed: number;
  average_response_time: number;
  prompt_category: string;
  category_count: number;
}

export interface SessionOwnershipResult {
  isOwner: boolean;
  sessionInfo?: {
    topic: string | null;
    startTime: string | Date | null;
    endTime: string | Date | null;
    status: string | null;
  };
}

export interface PlannedVsActualRow {
  planned_groups: number | null;
  planned_group_size: number | null;
  planned_duration_minutes: number | null;
  planned_members: number | null;
  planned_leaders: number | null;
  planned_scheduled_start: string | Date | null;
  configured_at: string | Date | null;
  started_at: string | Date | null;
  started_without_ready_groups: boolean | null;
  ready_groups_at_start: number | null;
  ready_groups_at_5m: number | null;
  ready_groups_at_10m: number | null;
  adherence_members_ratio: number | null;
}

export interface ReadinessEventRow { event_time: string | Date; payload: string }

export interface GroupCountsRow {
  actual_groups: number;
  actual_avg_group_size: number | null;
  actual_members: number | null;
  actual_unique_students: number | null;
  actual_leaders: number | null;
}

export interface MembershipAnalyticsRow {
  group_id: string;
  group_name: string | null;
  leader_id: string | null;
  configured_size: number | null;
  actual_member_count: number | null;
  leader_present: number | null;
  regular_members_present: number | null;
  first_member_joined: string | Date | null;
  last_member_joined: string | Date | null;
}

export interface AnalyticsRepositoryPort {
  getTeacherPromptMetrics(teacherId: string, timeframe: string): Promise<TeacherPromptMetricsRow[]>;
  verifySessionOwnership(sessionId: string, teacherId: string, schoolId: string): Promise<SessionOwnershipResult>;
  getPlannedVsActual(sessionId: string): Promise<PlannedVsActualRow | null>;
  getReadinessEvents(sessionId: string): Promise<ReadinessEventRow[]>;
  getActualGroupCounts(sessionId: string): Promise<GroupCountsRow | null>;
  getMembershipAnalytics(sessionId: string): Promise<MembershipAnalyticsRow[]>;
  getSessionGroupsAnalytics(sessionId: string): Promise<any[]>;
  getSessionFinalSummary(sessionId: string): Promise<{ analytics_data?: string; computed_at?: string; status?: string } | null>;
  getLegacyMembershipRows(sessionId: string): Promise<any[]>;
  upsertSessionMetrics(sessionId: string, data: Record<string, any>): Promise<void>;
  updateSessionMetrics(sessionId: string, fields: Record<string, any>): Promise<void>;
  insertTier1Analysis(data: Record<string, any>): Promise<void>;
  insertTier2Analysis(data: Record<string, any>): Promise<void>;
  getTier1Results(
    sessionId: string,
    options?: { groupIds?: string[]; includeHistory?: boolean; hoursBack?: number; order?: 'ASC' | 'DESC' }
  ): Promise<any[]>;
  getTier2Results(
    sessionId: string,
    options?: { includeHistory?: boolean; hoursBack?: number; order?: 'ASC' | 'DESC' }
  ): Promise<any[]>;
}
