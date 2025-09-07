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

  it('listOwnedSessionsForDashboard selects minimal fields from classroom_sessions (no analytics joins)', async () => {
    mockDB.query.mockResolvedValue([] as any);
    await repo.listOwnedSessionsForDashboard('teacher-1', 3);
    expect(mockDB.query).toHaveBeenCalled();
    const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
    // Must select from classroom_sessions with alias s
    expect(sql).toMatch(/FROM\s+\S+\.sessions\.classroom_sessions\s+s/i);
    // Explicit minimal columns, no star
    expect(sql).toMatch(/SELECT[\s\S]*s\.id[\s\S]*s\.status[\s\S]*s\.teacher_id[\s\S]*s\.school_id/i);
    expect(sql).not.toMatch(/SELECT\s+\*/i);
    expect(sql).not.toMatch(/\bs\.\*/);
    // Uses precomputed totals, not a join
    expect(sql).toContain('s.total_groups   AS group_count');
    expect(sql).toContain('s.total_students AS student_count');
    // Includes access_code and lightweight metrics
    expect(sql).toContain('s.access_code');
    expect(sql).toContain('s.participation_rate');
    expect(sql).toContain('s.engagement_score');
    // No analytics joins
    expect(sql).not.toMatch(/analytics\./i);
    expect(sql).not.toMatch(/JOIN\s+\S+analytics\./i);
  });
});
