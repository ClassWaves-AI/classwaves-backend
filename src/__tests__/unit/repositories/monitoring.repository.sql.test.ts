import { DatabricksMonitoringRepository } from '../../../adapters/repositories/databricks-monitoring.repository';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');

describe('DatabricksMonitoringRepository SQL passthrough and shapes', () => {
  const repo = new DatabricksMonitoringRepository();
  const mockDB = databricksService as jest.Mocked<typeof databricksService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDB.query.mockResolvedValue([] as any);
    mockDB.queryOne.mockResolvedValue({} as any);
  });

  it('executeSql passes raw SQL through directly', async () => {
    await repo.executeSql('SELECT 1');
    expect(mockDB.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('describeTable queries DESCRIBE TABLE with LIMIT 1', async () => {
    await repo.describeTable('classwaves.analytics.session_metrics');
    expect(mockDB.queryOne).toHaveBeenCalled();
    const sql = (mockDB.queryOne.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/DESCRIBE\s+TABLE\s+classwaves\.analytics\.session_metrics\s+LIMIT\s+1/i);
  });
});

