import { DatabricksAnalyticsRepository } from '../../../adapters/repositories/databricks-analytics.repository';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');

describe('DatabricksAnalyticsRepository filters (Tier1/Tier2)', () => {
  const repo = new DatabricksAnalyticsRepository();
  const mockDB = databricksService as jest.Mocked<typeof databricksService>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDB.query.mockResolvedValue([] as any);
    mockDB.queryOne.mockResolvedValue(null as any);
  });

  describe('getTier1Results', () => {
    it('applies defaults: last 2 hours, ASC, no group filter', async () => {
      await repo.getTier1Results('sess-1');
      expect(mockDB.query).toHaveBeenCalled();
      const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
      const params = (mockDB.query.mock.calls[0]?.[1] || []) as any[];
      expect(sql).toMatch(/SELECT\s+group_id,\s*insights,\s*created_at,\s*analysis_timestamp/i);
      expect(sql).toMatch(/FROM\s+[\w.]+ai_insights\.tier1_analysis/i);
      expect(sql).toMatch(/WHERE\s+session_id\s*=\s*\?/i);
      expect(sql).toMatch(/created_at\s*>=\s*CURRENT_TIMESTAMP\(\)\s*-\s*INTERVAL\s+2\s+HOURS/i);
      expect(sql).toMatch(/ORDER BY\s+created_at\s+ASC/i);
      expect(sql).not.toMatch(/SELECT\s+\*/i);
      expect(params).toEqual(['sess-1']);
    });

    it('omits time filter when includeHistory=true', async () => {
      await repo.getTier1Results('sess-1', { includeHistory: true });
      const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
      expect(sql).not.toMatch(/created_at\s*>=\s*CURRENT_TIMESTAMP\(\)/i);
    });

    it('honors hoursBack and DESC order', async () => {
      await repo.getTier1Results('sess-1', { hoursBack: 6, order: 'DESC' });
      const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
      expect(sql).toMatch(/INTERVAL\s+6\s+HOURS/i);
      expect(sql).toMatch(/ORDER BY\s+created_at\s+DESC/i);
    });

    it('applies groupIds filter with placeholders and params appended', async () => {
      await repo.getTier1Results('sess-1', { groupIds: ['g1', 'g2', 'g3'] });
      const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
      const params = (mockDB.query.mock.calls[0]?.[1] || []) as any[];
      expect(sql).toMatch(/group_id\s+IN\s*\(\s*\?,\s*\?,\s*\?\s*\)/i);
      expect(params).toEqual(['sess-1', 'g1', 'g2', 'g3']);
    });
  });

  describe('getTier2Results', () => {
    it('applies defaults: last 2 hours and ASC', async () => {
      await repo.getTier2Results('sess-2');
      const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
      const params = (mockDB.query.mock.calls[0]?.[1] || []) as any[];
      expect(sql).toMatch(/SELECT\s+insights,\s*created_at,\s*analysis_timestamp/i);
      expect(sql).toMatch(/FROM\s+[\w.]+ai_insights\.tier2_analysis/i);
      expect(sql).toMatch(/WHERE\s+session_id\s*=\s*\?/i);
      expect(sql).toMatch(/created_at\s*>=\s*CURRENT_TIMESTAMP\(\)\s*-\s*INTERVAL\s+2\s+HOURS/i);
      expect(sql).toMatch(/ORDER BY\s+created_at\s+ASC/i);
      expect(sql).not.toMatch(/SELECT\s+\*/i);
      expect(params).toEqual(['sess-2']);
    });

    it('omits time filter when includeHistory=true', async () => {
      await repo.getTier2Results('sess-2', { includeHistory: true });
      const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
      expect(sql).not.toMatch(/created_at\s*>=\s*CURRENT_TIMESTAMP\(\)/i);
    });

    it('honors hoursBack and DESC order', async () => {
      await repo.getTier2Results('sess-2', { hoursBack: 12, order: 'DESC' });
      const sql = (mockDB.query.mock.calls[0]?.[0] || '') as string;
      expect(sql).toMatch(/INTERVAL\s+12\s+HOURS/i);
      expect(sql).toMatch(/ORDER BY\s+created_at\s+DESC/i);
    });
  });
});

