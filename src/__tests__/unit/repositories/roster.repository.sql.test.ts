import { DatabricksRosterRepository } from '../../../adapters/repositories/databricks-roster.repository';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');

describe('DatabricksRosterRepository SQL Projections', () => {
  const repo = new DatabricksRosterRepository();
  const mockDB = databricksService as jest.Mocked<typeof databricksService>;

  beforeEach(() => jest.clearAllMocks());

  it('listStudentsBySchool selects explicit fields (no SELECT *)', async () => {
    mockDB.query.mockResolvedValue([] as any);
    await repo.listStudentsBySchool('sch-1', {}, 10, 0);
    expect(mockDB.query).toHaveBeenCalled();
    const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT[\s\S]*s\.id,[\s\S]*s\.display_name,[\s\S]*s\.school_id/);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
    expect(sql).not.toMatch(/\b\w+\.\*/);
  });
});

