import { DatabricksHealthRepository } from '../../../adapters/repositories/databricks-health.repository';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');

describe('DatabricksHealthRepository SQL shape', () => {
  const repo = new DatabricksHealthRepository();
  const mockDB = databricksService as jest.Mocked<typeof databricksService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDB.query.mockResolvedValue([{ health_check: 1, server_time: new Date().toISOString() }] as any);
  });

  it('getServerTime selects explicit fields (no star)', async () => {
    await repo.getServerTime();
    expect(mockDB.query).toHaveBeenCalled();
    const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT\s+1\s+as\s+health_check,\s*current_timestamp\(\)\s+as\s+server_time/i);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });

  it('countFromTable uses COUNT(*) with explicit table and LIMIT 1', async () => {
    await repo.countFromTable('classwaves.users.teachers');
    expect(mockDB.query).toHaveBeenCalled();
    const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT\s+COUNT\(\*\)\s+as\s+count\s+FROM\s+classwaves\.users\.teachers\s+LIMIT\s+1/i);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });
});

