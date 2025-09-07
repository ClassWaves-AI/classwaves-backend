import { databricksService } from '../../services/databricks.service';
import type { MonitoringRepositoryPort } from '../../services/ports/monitoring.repository.port';

export class DatabricksMonitoringRepository implements MonitoringRepositoryPort {
  async executeSql(sql: string): Promise<any[]> {
    return await databricksService.query(sql);
  }

  async describeTable(tableFqn: string): Promise<any> {
    return await databricksService.queryOne(`DESCRIBE TABLE ${tableFqn} LIMIT 1`);
  }
}

export const monitoringRepository: MonitoringRepositoryPort = new DatabricksMonitoringRepository();

