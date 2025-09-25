import { getDatabricksService, resetDatabricksServiceForTests } from '../../../services/databricks.service';

describe('DatabricksService.batchInsert', () => {
  beforeAll(async () => {
    process.env.DATABRICKS_MOCK = '0';
    await resetDatabricksServiceForTests();
  });

  afterAll(async () => {
    delete process.env.DATABRICKS_MOCK;
    await resetDatabricksServiceForTests();
  });

  it('builds correct SQL and parameter order', async () => {
    const svc = getDatabricksService();
    const spy = jest.spyOn(svc, 'query').mockResolvedValueOnce([]);
    const rows = [
      { id: '1', actor_id: 'a1', event_type: 'e', event_category: 'session', resource_type: 'r', school_id: 'sch', description: 'd', event_timestamp: new Date('2020-01-01'), created_at: new Date('2020-01-01') },
      { id: '2', actor_id: 'a2', event_type: 'e', event_category: 'session', resource_type: 'r', school_id: 'sch', description: 'd', event_timestamp: new Date('2020-01-01'), created_at: new Date('2020-01-01') },
    ];
    await svc.batchInsert('audit_log', rows as any);
    expect(spy).toHaveBeenCalledTimes(1);
    const sql = spy.mock.calls[0][0];
    const params = spy.mock.calls[0][1] as any[];
    expect(sql).toMatch(/INSERT INTO .*compliance\.audit_log.*\(id, actor_id, event_type/);
    // First params should be row1 values in column order
    expect(params[0]).toBe('1');
    expect(params[1]).toBe('a1');
    // Later should contain row2 id
    expect(params).toContain('2');
    spy.mockRestore();
  });
});
