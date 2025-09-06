import { queryCacheService } from '../../../services/query-cache.service';
import { cachePort } from '../../../utils/cache.port.instance';
import { makeKey } from '../../../utils/key-prefix.util';

describe('QueryCacheService.invalidateCache - legacy + prefixed', () => {
  const OLD_ENV = { ...process.env } as any;

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.NODE_ENV = 'test';
    process.env.REDIS_USE_MOCK = '1';
    process.env.CW_CACHE_PREFIX_ENABLED = '1';
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('deletes both legacy and prefixed keys matching pattern', async () => {
    const legacy1 = 'query_cache:session-detail:K1';
    const legacy2 = 'query_cache:session-detail:K2';
    const prefixed = makeKey('query_cache', 'session-detail', 'P1');

    await cachePort.set(legacy1, JSON.stringify({ v: 1 }), 60);
    await cachePort.set(legacy2, JSON.stringify({ v: 2 }), 60);
    await cachePort.set(prefixed, JSON.stringify({ v: 3 }), 60);

    // Sanity: ensure seeded
    expect(await cachePort.get(legacy1)).not.toBeNull();
    expect(await cachePort.get(legacy2)).not.toBeNull();
    expect(await cachePort.get(prefixed)).not.toBeNull();

    await queryCacheService.invalidateCache('session-detail:');

    expect(await cachePort.get(legacy1)).toBeNull();
    expect(await cachePort.get(legacy2)).toBeNull();
    expect(await cachePort.get(prefixed)).toBeNull();
  });
});

