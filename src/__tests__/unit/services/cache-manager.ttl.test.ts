import { cacheManager } from '../../../services/cache-manager.service';
import { cachePort } from '../../../utils/cache.port.instance';

describe('CacheManager TTL enforcement', () => {
  beforeEach(() => {
    process.env.REDIS_USE_MOCK = '1';
    jest.clearAllMocks();
  });

  it('returns null and deletes entry when entry timestamp exceeds TTL', async () => {
    const key = 'cm:ttl:test';
    const entry = {
      data: { a: 1 },
      tags: ['t'],
      timestamp: Date.now() - 2000, // 2s ago
      ttl: 1, // 1 second
    };
    // Store with a long Redis TTL so only manager TTL check applies
    await cachePort.set(key, JSON.stringify(entry), 60);

    const got = await cacheManager.get<typeof entry.data>(key);
    expect(got).toBeNull();
    // Manager should also delete the key
    const stillThere = await cachePort.get(key);
    expect(stillThere).toBeNull();
  });
});

