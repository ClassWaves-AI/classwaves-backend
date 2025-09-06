import { DatabricksSessionRepository } from '../../../adapters/repositories/databricks-session.repository';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');

describe('DatabricksSessionRepository SQL Projections', () => {
  const repo = new DatabricksSessionRepository();
  const mockDB = databricksService as jest.Mocked<typeof databricksService>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getOwnedSessionBasic selects explicit fields (no SELECT *)', async () => {
    mockDB.queryOne.mockResolvedValue(null as any);
    await repo.getOwnedSessionBasic('sess-1', 'teacher-1');
    expect(mockDB.queryOne).toHaveBeenCalled();
    const sql = (mockDB.queryOne.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT\s+id,\s*status,\s*teacher_id,\s*school_id/);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
    expect(sql).not.toMatch(/\b\w+\.\*/);
  });
});

