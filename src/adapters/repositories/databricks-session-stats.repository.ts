import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type { SessionStats, SessionStatsRepositoryPort } from '../../services/ports/session-stats.repository.port.ts';

export class DatabricksSessionStatsRepository implements SessionStatsRepositoryPort {
  async getEndSessionStats(sessionId: string): Promise<SessionStats> {
    const sql = `
      SELECT 
        total_groups,
        total_students,
        (
          SELECT COUNT(id)
          FROM ${databricksConfig.catalog}.sessions.transcriptions 
          WHERE session_id = s.id
        ) as total_transcriptions
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions s
      WHERE s.id = ?
    `;
    const row = await databricksService.queryOne(sql, [sessionId]);
    return {
      total_groups: (row?.total_groups as number) ?? 0,
      total_students: (row?.total_students as number) ?? 0,
      total_transcriptions: (row?.total_transcriptions as number) ?? 0,
    };
  }
}

export const sessionStatsRepository: SessionStatsRepositoryPort = new DatabricksSessionStatsRepository();

