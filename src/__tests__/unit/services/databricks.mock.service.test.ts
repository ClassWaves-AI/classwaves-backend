import type { DatabricksMockService } from '../../../services/databricks.mock.service';
import { databricksMock, databricksMockService } from '../../../services/databricks.mock.service';

describe('DatabricksMockService', () => {
  beforeEach(() => {
    databricksMock.reset();
  });

  it('returns fixture results for matching queries', async () => {
    databricksMock.registerFixture(/select \* from classwaves\.ai_insights\.teacher_guidance_metrics/i, async (_sql, params) => {
      return params[0] === 'session-1'
        ? [{ prompt_id: 'p1', session_id: 'session-1' }]
        : [];
    });

    const rows = await databricksMockService.query(
      'SELECT * FROM classwaves.ai_insights.teacher_guidance_metrics WHERE session_id = ?',
      ['session-1']
    );

    expect(rows).toEqual([{ prompt_id: 'p1', session_id: 'session-1' }]);
  });

  it('tracks columns when ALTER TABLE ADD COLUMNS is issued', async () => {
    await databricksMockService.query(
      "ALTER TABLE classwaves.ai_insights.teacher_guidance_metrics ADD COLUMNS (context_reason STRING, on_track_summary STRING)"
    );

    const hasColumns = await databricksMockService.tableHasColumns('ai_insights', 'teacher_guidance_metrics', [
      'context_reason',
      'on_track_summary',
    ]);

    expect(hasColumns).toBe(true);
  });
});

describe('getDatabricksService mock selection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, DATABRICKS_MOCK: '1' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns the mock instance when DATABRICKS_MOCK=1', async () => {
    const { databricksMockService: freshMock } = await import('../../../services/databricks.mock.service');
    const { getDatabricksService, isDatabricksMockEnabled } = await import('../../../services/databricks.service');
    const service = getDatabricksService();
    expect(isDatabricksMockEnabled()).toBe(true);
    expect(service).toBe(freshMock);
  });
});
