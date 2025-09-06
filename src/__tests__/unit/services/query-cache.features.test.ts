import { queryCacheService } from '../../../services/query-cache.service';
import { cachePort } from '../../../utils/cache.port.instance';
import { makeKey } from '../../../utils/key-prefix.util';
import { composeEpochKey, bumpTagEpoch } from '../../../services/tag-epoch.service';

describe('QueryCacheService features', () => {
  beforeEach(() => {
    process.env.REDIS_USE_MOCK = '1';
    // Keep prefix/epochs off for deterministic keys unless a test enables them explicitly
    process.env.CW_CACHE_PREFIX_ENABLED = '0';
    process.env.CW_CACHE_EPOCHS_ENABLED = '0';
    jest.clearAllMocks();
  });

  it('coalesces concurrent misses (single-flight)', async () => {
    const key = 'sf-key';
    const type = 'session-detail';
    let calls = 0;
    const fetcher = jest.fn(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true, n: calls };
    });

    const [a, b] = await Promise.all([
      queryCacheService.getCachedQuery(key, type, fetcher, { sessionId: 's1' }),
      queryCacheService.getCachedQuery(key, type, fetcher, { sessionId: 's1' }),
    ]);

    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  it('serves stale within hard TTL and triggers refresh-ahead', async () => {
    const key = 'ra-key';
    const type = 'session-detail';
    const legacyKey = `query_cache:${type}:${key}`;
    const now = Date.now();
    // softTTL default is 70% of 600s = 420s
    const cached = {
      data: { from: 'cache' },
      cachedAt: now - (421 * 1000),
      ttl: 600,
      softTtl: 420,
      queryHash: 'h',
    };
    await cachePort.set(legacyKey, JSON.stringify(cached), 600);

    const fetcher = jest.fn(async () => ({ from: 'db' }));
    const res = await queryCacheService.getCachedQuery(key, type, fetcher, { sessionId: 's1' });
    expect(res).toEqual({ from: 'cache' });
    // Allow microtask for refresh-ahead to run
    await new Promise((r) => setTimeout(r, 10));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('respects tag epochs to bypass stale epoch keys', async () => {
    const key = 'epoch-key';
    const type = 'session-detail';
    const sessionId = 'sess-1';
    process.env.CW_CACHE_EPOCHS_ENABLED = '1';
    process.env.CW_CACHE_PREFIX_ENABLED = '0';
    const legacyBase = `query_cache:${type}:${key}`;
    const epoch0Key = await composeEpochKey(legacyBase, [`session:${sessionId}`]);
    // Write an entry under epoch 0
    const entry = { data: { v: 0 }, cachedAt: Date.now(), ttl: 600, softTtl: 420, queryHash: 'x' };
    await cachePort.set(epoch0Key, JSON.stringify(entry), 600);

    // Bump epoch to 1
    await bumpTagEpoch(`session:${sessionId}`);
    const fetcher = jest.fn(async () => ({ v: 1 }));
    const res = await queryCacheService.getCachedQuery(key, type, fetcher, { sessionId });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ v: 1 });
  });

  it('pattern invalidation removes cached entries', async () => {
    const type = 'session-detail';
    const k1 = `query_cache:${type}:k1`;
    const k2 = `query_cache:${type}:k2`;
    await cachePort.set(k1, JSON.stringify({ data: 1, cachedAt: Date.now(), ttl: 600, queryHash: 'a' }), 600);
    await cachePort.set(k2, JSON.stringify({ data: 2, cachedAt: Date.now(), ttl: 600, queryHash: 'b' }), 600);

    await queryCacheService.invalidateCache(`${type}:*`);
    expect(await cachePort.get(k1)).toBeNull();
    expect(await cachePort.get(k2)).toBeNull();
  });
});

