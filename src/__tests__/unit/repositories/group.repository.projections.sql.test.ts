import { DatabricksGroupRepository } from '../../../adapters/repositories/databricks-group.repository';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');

describe('DatabricksGroupRepository projections', () => {
  const repo = new DatabricksGroupRepository();
  const mockDB = databricksService as jest.Mocked<typeof databricksService>;

  beforeEach(() => jest.clearAllMocks());

  it('getGroupsBasic selects explicit fields', async () => {
    mockDB.query.mockResolvedValue([] as any);
    await repo.getGroupsBasic('sess-1');
    expect(mockDB.query).toHaveBeenCalled();
    const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT\s+id,\s*name,\s*leader_id,\s*is_ready,\s*group_number/);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
    expect(sql).not.toMatch(/\b\w+\.\*/);
  });

  it('getMembersBySession selects explicit fields and joins students', async () => {
    mockDB.query.mockResolvedValue([] as any);
    await repo.getMembersBySession('sess-1');
    expect(mockDB.query).toHaveBeenCalled();
    const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT\s+m\.group_id,\s*m\.student_id,\s*s\.display_name\s+as\s+name/i);
    expect(sql).toContain('LEFT JOIN');
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });
});

