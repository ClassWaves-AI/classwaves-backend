import { queryCacheService } from '../../../services/query-cache.service';
import { redisService } from '../../../services/redis.service';

describe('QueryCacheService – new strategies (group-status, dashboard-metrics)', () => {
  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.CW_CACHE_PREFIX_ENABLED = '0';
    process.env.CW_CACHE_EPOCHS_ENABLED = '0';
    process.env.REDIS_USE_MOCK = '1';
  });

  beforeEach(async () => {
    // Invalidate any prior keys used by these tests
    await queryCacheService.invalidateCache('group-status:*');
    await queryCacheService.invalidateCache('dashboard-metrics:*');
  });

  it('caches and serves dashboard-metrics with correct TTL', async () => {
    const teacherId = 't-1';
    const key = `dashboard:teacher:${teacherId}`;
    let calls = 0;

    const factory = async () => {
      calls += 1;
      return { metrics: { active: 1 }, timestamp: 'x' };
    };

    const r1 = await queryCacheService.getCachedQuery(key, 'dashboard-metrics', factory, { teacherId });
    const r2 = await queryCacheService.getCachedQuery(key, 'dashboard-metrics', factory, { teacherId });
    expect(calls).toBe(1); // second call from cache
    expect(r1).toEqual(r2);

    const storedKey = `query_cache:dashboard-metrics:${key}`;
    const ttl = await redisService.ttl(storedKey);
    expect(ttl).toBe(45);
  });

  it('caches and serves group-status with correct TTL and invalidates by pattern', async () => {
    const sessionId = 's-1';
    const key = `${sessionId}`;
    let calls = 0;

    const factory = async () => {
      calls += 1;
      return { sessionId, groups: [], summary: {}, timestamp: 'y' } as any;
    };

    await queryCacheService.getCachedQuery(key, 'group-status', factory, { sessionId });
    await queryCacheService.getCachedQuery(key, 'group-status', factory, { sessionId });
    expect(calls).toBe(1);

    const storedKey = `query_cache:group-status:${key}`;
    const ttl = await redisService.ttl(storedKey);
    expect(ttl).toBe(10);

    // Invalidate and ensure factory is called again
    await queryCacheService.invalidateCache('group-status:' + sessionId);
    await queryCacheService.getCachedQuery(key, 'group-status', factory, { sessionId });
    expect(calls).toBe(2);
  });
});
