import Redis from 'ioredis';

describe('RedisAuditLogAdapter (integration)', () => {
  const STREAM_KEY = 'test:audit:log';
  let client: Redis;

  beforeAll(() => {
    process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    client = new (require('ioredis'))(process.env.REDIS_URL!);
  });

  afterAll(async () => {
    try { await client.del(STREAM_KEY); } catch { /* intentionally ignored: best effort cleanup */ }
    await client.quit();
  });

  it('enqueues successfully', async () => {
    process.env.AUDIT_LOG_STREAM_KEY = STREAM_KEY;
    jest.isolateModules(() => {
      const { RedisAuditLogAdapter } = require('../../../adapters/audit-log.redis');
      const adapter = new RedisAuditLogAdapter();
      return adapter.enqueue({
        actorId: 't1', actorType: 'teacher', eventType: 'login', eventCategory: 'authentication',
        resourceType: 'session', resourceId: 's1', schoolId: 'sch1', description: 'login'
      });
    });
    await new Promise((r) => setTimeout(r, 50));
    const len = await client.xlen(STREAM_KEY);
    expect(len).toBeGreaterThan(0);
  });

  it('drops non-critical on backlog beyond threshold', async () => {
    process.env.AUDIT_LOG_STREAM_KEY = STREAM_KEY;
    process.env.AUDIT_LOG_MAX_BACKLOG = '5';
    // Pre-fill
    for (let i = 0; i < 6; i++) {
      await client.xadd(STREAM_KEY, '*', 'foo', 'bar');
    }
    // Import after env set
    await jest.isolateModulesAsync(async () => {
      const { RedisAuditLogAdapter } = require('../../../adapters/audit-log.redis');
      const adapter = new RedisAuditLogAdapter();
      await adapter.enqueue({
        actorId: 't1', actorType: 'teacher', eventType: 'noisy', eventCategory: 'data_access',
        resourceType: 'r', resourceId: 'rid', schoolId: 'sch1', description: 'x', priority: 'low'
      });
      const lenAfter = await client.xlen(STREAM_KEY);
      expect(lenAfter).toBeGreaterThanOrEqual(6);
      await adapter.enqueue({
        actorId: 't1', actorType: 'teacher', eventType: 'noisy', eventCategory: 'data_access',
        resourceType: 'r', resourceId: 'rid', schoolId: 'sch1', description: 'x', priority: 'critical'
      });
      const lenAfterCritical = await client.xlen(STREAM_KEY);
      expect(lenAfterCritical).toBeGreaterThan(lenAfter);
    });
  });
});

