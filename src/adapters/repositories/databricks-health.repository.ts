import { databricksService } from '../../services/databricks.service';
import type { HealthRepositoryPort } from '../../services/ports/health.repository.port';

export class DatabricksHealthRepository implements HealthRepositoryPort {
  async getServerTime(): Promise<{ health_check: number; server_time: string } | null> {
    const rows = await databricksService.query('SELECT 1 as health_check, current_timestamp() as server_time');
    return rows?.[0] || null;
  }

  async countFromTable(tableFqn: string): Promise<number> {
    const rows = await databricksService.query(`SELECT COUNT(*) as count FROM ${tableFqn} LIMIT 1`);
    return (rows?.[0]?.count as number) ?? 0;
  }
}

export const healthRepository: HealthRepositoryPort = new DatabricksHealthRepository();

