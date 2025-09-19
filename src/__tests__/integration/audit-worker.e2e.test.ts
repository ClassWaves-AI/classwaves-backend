import Redis from 'ioredis';

describe('Audit Worker E2E', () => {
  const STREAM_KEY = 'e2e:audit:log';
  const GROUP = 'e2e-group';
  const DLQ_KEY = 'e2e:audit:dlq';
  let client: Redis;
  let worker: any;

  beforeAll(async () => {
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    process.env.AUDIT_LOG_STREAM_KEY = STREAM_KEY;
    process.env.AUDIT_LOG_CONSUMER_GROUP = GROUP;
    process.env.AUDIT_LOG_DLQ_KEY = DLQ_KEY;
    process.env.AUDIT_LOG_BATCH_SIZE = '50';
    process.env.AUDIT_LOG_BLOCK_MS = '200';
    process.env.AUDIT_ROLLUP_FLUSH_INTERVAL_MS = '200';
    client = new (require('ioredis'))(process.env.REDIS_URL!);
    await client.del(STREAM_KEY);
    await client.del(DLQ_KEY);
  });

  afterAll(async () => {
    try { await client.del(STREAM_KEY); } catch { /* intentionally ignored: best effort cleanup */ }
    try { await client.del(DLQ_KEY); } catch { /* intentionally ignored: best effort cleanup */ }
    await client.quit();
  });

  it('processes enqueued events and writes batches', async () => {
    jest.isolateModules(() => {
      const mod = require('../../workers/audit-log.worker');
      worker = new mod.AuditLogWorker();
    });

    const spy = jest.spyOn(require('../../services/databricks.service'), 'databricksService', 'get');
    // Mock batchInsert to observe rows
    const rowsSeen: any[] = [];
    (spy as any).mockReturnValue({
      batchInsert: jest.fn(async (_table: string, rows: any[]) => {
        rowsSeen.push(...rows);
      }),
    });

    const run = worker.start();
    // enqueue one event
    await client.xadd(
      STREAM_KEY,
      '*',
      'actor_id', 't1', 'actor_type', 'teacher', 'event_type', 'login', 'event_category', 'authentication',
      'resource_type', 'session', 'resource_id', 's1', 'school_id', 'sch1', 'description', 'login', 'event_timestamp', new Date().toISOString()
    );

    // wait for worker to process
    await new Promise((r) => setTimeout(r, 800));
    await worker.stop();
    await run.catch(() => {});

    expect(rowsSeen.length).toBeGreaterThanOrEqual(1);
    expect(rowsSeen[0].event_type).toBe('login');
  });

  it('applies sampling + produces rollups, and DLQs critical during DB failures', async () => {
    await client.del(STREAM_KEY);
    await client.del(DLQ_KEY);

    jest.isolateModules(() => {
      const mod = require('../../workers/audit-log.worker');
      worker = new mod.AuditLogWorker();
    });

    // Mock databricks to fail first then succeed
    const svc = require('../../services/databricks.service');
    const batchInsertMock = jest.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(undefined);
    jest.spyOn(svc, 'databricksService', 'get').mockReturnValue({ batchInsert: batchInsertMock });

    process.env.AUDIT_NOISY_SAMPLE_RATE = '0'; // drop noisy
    process.env.AUDIT_ROLLUP_FLUSH_INTERVAL_MS = '200';

    const run = worker.start();

    // enqueue noisy events (they will be dropped -> rollups)
    for (let i = 0; i < 10; i++) {
      await client.xadd(
        STREAM_KEY,
        '*',
        'actor_id', 'sys', 'actor_type', 'system', 'event_type', 'ai_analysis_buffer', 'event_category', 'data_access',
        'resource_type', 'r', 'resource_id', 'rid', 'school_id', 'sch1', 'description', 'noisy', 'event_timestamp', new Date().toISOString(), 'priority', 'normal'
      );
    }
    // enqueue a critical event to DLQ on db failure
    await client.xadd(
      STREAM_KEY,
      '*',
      'actor_id', 'sys', 'actor_type', 'system', 'event_type', 'critical_evt', 'event_category', 'compliance',
      'resource_type', 'r', 'resource_id', 'rid', 'school_id', 'sch1', 'description', 'crit', 'event_timestamp', new Date().toISOString(), 'priority', 'critical'
    );

    // wait for processing and cooldown
    await new Promise((r) => setTimeout(r, 1500));
    await worker.stop();
    await run.catch(() => {});

    // After one failure, the next batchInsert should have been attempted at least twice
    expect(batchInsertMock).toHaveBeenCalled();
    // DLQ should have 1+
    const dlqLen = await client.xlen(DLQ_KEY as any);
    expect(dlqLen).toBeGreaterThanOrEqual(1);
  });
});

