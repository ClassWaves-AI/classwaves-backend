import { DatabricksSessionDetailRepository } from '../../../adapters/repositories/databricks-session-detail.repository';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');

describe('DatabricksSessionDetailRepository SQL projection', () => {
  const repo = new DatabricksSessionDetailRepository();
  const mockDB = databricksService as jest.Mocked<typeof databricksService>;

  beforeEach(() => jest.clearAllMocks());

  it('uses minimal SELECT projection for session detail', async () => {
    mockDB.queryOne.mockResolvedValue(null as any);
    await repo.getOwnedSessionDetail('sess-1', 'teacher-1');
    expect(mockDB.queryOne).toHaveBeenCalled();
    const sql = (mockDB.queryOne.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT\s+/i);
    expect(sql).toContain('FROM');
    expect(sql).not.toMatch(/SELECT\s+\*/i);
    expect(sql).not.toMatch(/\b\w+\.\*/);
    expect(sql).toMatch(/WHERE\s+s\.id\s*=\s*\?\s+AND\s+s\.teacher_id\s*=\s*\?/i);
  });
});

