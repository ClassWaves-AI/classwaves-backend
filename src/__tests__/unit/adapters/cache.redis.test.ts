import { RedisCacheAdapter } from '../../../adapters/cache.redis';

// Minimal mock redisService via jest module factory
jest.mock('../../../services/redis.service', () => ({
  redisService: {
    get: jest.fn(async (k: string) => (k === 'hit' ? '1' : null)),
    set: jest.fn(async () => undefined),
    del: jest.fn(async () => 1),
    expire: jest.fn(async () => 1),
    getClient: () => ({ incr: jest.fn(async () => 2) }),
  },
}));

describe('RedisCacheAdapter', () => {
  it('wraps redisService methods', async () => {
    const adapter = new RedisCacheAdapter();
    expect(await adapter.get('hit')).toBe('1');
    await adapter.set('k', 'v', 5);
    expect(await adapter.del('k')).toBe(1);
    expect(await adapter.incr('ctr')).toBe(2);
    expect(await adapter.expire('k', 5)).toBe(1);
  });
});

