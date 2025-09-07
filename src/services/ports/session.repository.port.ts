export type SessionStatus = 'created' | 'active' | 'paused' | 'ended' | 'archived';

export interface SessionBasic {
  id: string;
  status: SessionStatus;
  teacher_id: string;
  school_id: string;
  // Optional fields (not guaranteed by basic queries)
  title?: string;
  description?: string;
  access_code?: string;
  planned_duration_minutes?: number;
  created_at?: Date;
}

export interface SessionRepositoryPort {
  getOwnedSessionBasic(sessionId: string, teacherId: string): Promise<SessionBasic | null>;
  updateStatus(sessionId: string, status: SessionStatus): Promise<void>;
  /**
   * Minimal list projection for teacher dashboard session list
   */
  listOwnedSessionsForList(
    teacherId: string,
    limit: number
  ): Promise<Array<SessionBasic & { group_count: number; student_count: number; participation_rate?: number; engagement_score?: number }>>;
  /**
   * Ultra-lean projection for dashboard recent sessions view
   */
  listOwnedSessionsForDashboard(
    teacherId: string,
    limit?: number
  ): Promise<Array<SessionBasic & { group_count: number; student_count: number; participation_rate?: number; engagement_score?: number; access_code?: string }>>;
  /**
   * Update session to active and set timing fields when starting a session
   */
  updateOnStart(sessionId: string, startedAt: Date): Promise<void>;
  insertSession(data: Record<string, any>): Promise<void>;
  updateFields(sessionId: string, fields: Record<string, any>): Promise<void>;
  countActiveSessionsForTeacher(teacherId: string): Promise<number>;
  countTodaySessionsForTeacher(teacherId: string): Promise<number>;
  /**
   * Lookup a session by access code (minimal fields)
   */
  getByAccessCode(accessCode: string): Promise<SessionBasic & { title?: string; description?: string; access_code?: string } | null>;
  /**
   * Get basic by id (minimal fields)
   */
  getOwnedSessionLifecycle(sessionId: string, teacherId: string): Promise<{
    id: string;
    status: SessionStatus;
    teacher_id: string;
    school_id: string;
    actual_start: Date | null;
    created_at: Date | null;
    participation_rate?: number;
    engagement_score?: number;
  } | null>;
  getBasic(sessionId: string): Promise<SessionBasic | null>;
  listOwnedSessionIds(teacherId: string): Promise<string[]>;
}
