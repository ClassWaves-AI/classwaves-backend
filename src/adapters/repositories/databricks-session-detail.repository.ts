import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type { SessionDetailRepositoryPort } from '../../services/ports/session-detail.repository.port';
import { buildSessionDetailQuery } from '../../utils/query-builder.utils';

export class DatabricksSessionDetailRepository implements SessionDetailRepositoryPort {
  async getOwnedSessionDetail(sessionId: string, teacherId: string): Promise<any | null> {
    const qb = buildSessionDetailQuery();
    const sql = `${qb.sql}
         FROM ${databricksConfig.catalog}.sessions.classroom_sessions s
         WHERE s.id = ? AND s.teacher_id = ?`;
    return await databricksService.queryOne(sql, [sessionId, teacherId]);
  }
}

export const sessionDetailRepository: SessionDetailRepositoryPort = new DatabricksSessionDetailRepository();

