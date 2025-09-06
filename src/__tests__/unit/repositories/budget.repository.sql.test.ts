import { DatabricksBudgetRepository } from '../../../adapters/repositories/databricks-budget.repository';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');

describe('DatabricksBudgetRepository SQL Projections', () => {
  const repo = new DatabricksBudgetRepository();
  const mockDB = databricksService as jest.Mocked<typeof databricksService>;

  beforeEach(() => jest.clearAllMocks());

  it('getBudgetConfig selects explicit fields (no SELECT *)', async () => {
    mockDB.queryOne.mockResolvedValue(null as any);
    await repo.getBudgetConfig('sch-1');
    const sql = (mockDB.queryOne.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT\s+daily_minutes_limit,\s*alert_thresholds/);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });
});

