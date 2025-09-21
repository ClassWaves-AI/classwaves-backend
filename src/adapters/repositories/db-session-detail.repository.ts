import type { SessionDetailRepositoryPort } from '../../services/ports/session-detail.repository.port';
import type { DbPort } from '../../services/ports/db.port';
import { buildSessionDetailQuery } from '../../utils/query-builder.utils';

const SESSION_TABLE = 'classwaves.sessions.classroom_sessions';

export class DbSessionDetailRepository implements SessionDetailRepositoryPort {
  constructor(private readonly db: DbPort) {}

  async getOwnedSessionDetail(sessionId: string, teacherId: string): Promise<any | null> {
    const qb = buildSessionDetailQuery();
    const sql = `${qb.sql}
         FROM ${SESSION_TABLE} s
         WHERE s.id = ? AND s.teacher_id = ?`;
    return (await this.db.queryOne(sql, [sessionId, teacherId])) ?? null;
  }
}

export function createDbSessionDetailRepository(db: DbPort): SessionDetailRepositoryPort {
  return new DbSessionDetailRepository(db);
}
