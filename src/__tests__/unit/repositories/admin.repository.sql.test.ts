import { DatabricksAdminRepository } from '../../../adapters/repositories/databricks-admin.repository';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');

describe('DatabricksAdminRepository SQL Projections', () => {
  const repo = new DatabricksAdminRepository();
  const mockDB = databricksService as jest.Mocked<typeof databricksService>;

  beforeEach(() => jest.clearAllMocks());

  it('listSchools selects explicit fields (no SELECT *)', async () => {
    mockDB.query.mockResolvedValue([] as any);
    await repo.listSchools(10, 0);
    const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT[\s\S]*id,[\s\S]*name,[\s\S]*domain/);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });

  it('listTeachers selects explicit fields (no SELECT *)', async () => {
    mockDB.query.mockResolvedValue([] as any);
    await repo.listTeachers({}, 10, 0);
    const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
    expect(sql).toMatch(/SELECT[\s\S]*t\.id,[\s\S]*t\.email/);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
  });
});

