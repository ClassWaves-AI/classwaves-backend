import { DatabricksGroupRepository } from '../../../adapters/repositories/databricks-group.repository';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');

describe('DatabricksGroupRepository COUNT SQL', () => {
  const repo = new DatabricksGroupRepository();
  const mockDB = databricksService as jest.Mocked<typeof databricksService>;

  beforeEach(() => jest.clearAllMocks());

  it('countReady uses COUNT(*) with is_ready filter', async () => {
    mockDB.queryOne.mockResolvedValue({ ready_groups_count: 3 } as any);
    const n = await repo.countReady('sess-1');
    expect(n).toBe(3);
    const sql = (mockDB.queryOne.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT\s+COUNT\(\*\)\s+as\s+ready_groups_count/i);
    expect(sql).toMatch(/WHERE\s+session_id\s*=\s*\?\s+AND\s+is_ready\s*=\s*true/i);
  });

  it('countTotal uses COUNT(*) for session groups', async () => {
    mockDB.queryOne.mockResolvedValue({ total_groups_count: 5 } as any);
    const n = await repo.countTotal('sess-2');
    expect(n).toBe(5);
    const sql = (mockDB.queryOne.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT\s+COUNT\(\*\)\s+as\s+total_groups_count/i);
    expect(sql).toMatch(/WHERE\s+session_id\s*=\s*\?/i);
  });
});

