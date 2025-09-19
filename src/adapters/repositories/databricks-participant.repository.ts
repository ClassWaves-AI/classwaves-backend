import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type { ParticipantInsert, ParticipantRepositoryPort } from '../../services/ports/participant.repository.port';

export class DatabricksParticipantRepository implements ParticipantRepositoryPort {
  async insertParticipant(p: ParticipantInsert): Promise<void> {
    const sql = `
      INSERT INTO ${databricksConfig.catalog}.sessions.participants 
       (id, session_id, group_id, student_id, anonymous_id, display_name, join_time, leave_time, 
        is_active, device_type, browser_info, connection_quality, can_speak, can_hear, is_muted, 
        total_speaking_time_seconds, message_count, interaction_count, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await databricksService.query(sql, [
      p.id, p.session_id, p.group_id, p.student_id, p.anonymous_id, p.display_name,
      p.join_time, p.leave_time, p.is_active, p.device_type, p.browser_info, p.connection_quality,
      p.can_speak, p.can_hear, p.is_muted, p.total_speaking_time_seconds, p.message_count,
      p.interaction_count, p.created_at, p.updated_at,
    ]);
  }

  async listActiveBySession(sessionId: string) {
    const sql = `
      SELECT id, display_name, group_id, is_active, join_time, device_type 
      FROM ${databricksConfig.catalog}.sessions.participants 
      WHERE session_id = ? AND is_active = true`;
    return (await databricksService.query(sql, [sessionId])) as any[];
  }
}

export const participantRepository: ParticipantRepositoryPort = new DatabricksParticipantRepository();

