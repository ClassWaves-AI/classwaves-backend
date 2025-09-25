import type { DbPort } from '../../services/ports/db.port';
import type { ParticipantInsert, ParticipantRepositoryPort } from '../../services/ports/participant.repository.port';

const PARTICIPANTS_TABLE = 'sessions.participants';

export function createDbParticipantRepository(db: DbPort): ParticipantRepositoryPort {
  return {
    async insertParticipant(p: ParticipantInsert): Promise<void> {
      await db.insert(PARTICIPANTS_TABLE, {
        id: p.id,
        session_id: p.session_id,
        group_id: p.group_id,
        student_id: p.student_id,
        anonymous_id: p.anonymous_id,
        display_name: p.display_name,
        join_time: p.join_time,
        leave_time: p.leave_time,
        is_active: p.is_active,
        device_type: p.device_type,
        browser_info: p.browser_info,
        connection_quality: p.connection_quality,
        can_speak: p.can_speak,
        can_hear: p.can_hear,
        is_muted: p.is_muted,
        total_speaking_time_seconds: p.total_speaking_time_seconds,
        message_count: p.message_count,
        interaction_count: p.interaction_count,
        created_at: p.created_at,
        updated_at: p.updated_at,
      });
    },

    async listActiveBySession(sessionId: string) {
      const rows = await db.query(
        `SELECT id, display_name, group_id, is_active, join_time, device_type
         FROM ${PARTICIPANTS_TABLE}
         WHERE session_id = ? AND is_active = true`,
        [sessionId]
      );
      return rows as Array<{ id: string; display_name: string; group_id: string | null; is_active: boolean; join_time: Date; device_type: string | null }>;
    },
  };
}

