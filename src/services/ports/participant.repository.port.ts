export interface ParticipantInsert {
  id: string;
  session_id: string;
  group_id: string | null;
  student_id: string;
  anonymous_id: string | null;
  display_name: string;
  join_time: Date;
  leave_time: Date | null;
  is_active: boolean;
  device_type: string | null;
  browser_info: string | null;
  connection_quality: string | null;
  can_speak: boolean;
  can_hear: boolean;
  is_muted: boolean;
  total_speaking_time_seconds: number | null;
  message_count: number | null;
  interaction_count: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ParticipantRepositoryPort {
  insertParticipant(p: ParticipantInsert): Promise<void>;
  listActiveBySession(sessionId: string): Promise<Array<{ id: string; display_name: string; group_id: string | null; is_active: boolean; join_time: Date; device_type: string | null }>>;
}

