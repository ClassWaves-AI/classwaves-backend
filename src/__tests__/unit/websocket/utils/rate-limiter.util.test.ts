import { RedisRateLimiter, KeyCounterClient } from '../../../../services/websocket/utils/rate-limiter.util';

class FakeCounter implements KeyCounterClient {
  store = new Map<string, number>();
  async incr(key: string): Promise<number> {
    const v = (this.store.get(key) || 0) + 1;
    this.store.set(key, v);
    return v;
  }
  async expire(): Promise<void> {
    // no-op for unit test
  }
}

describe('RedisRateLimiter', () => {
  it('allows up to max within window then denies', async () => {
    const client = new FakeCounter();
    const limiter = new RedisRateLimiter(client);

    const key = 'ws:rate:test:abc';
    expect(await limiter.allow(key, 2, 10)).toBe(true);
    expect(await limiter.allow(key, 2, 10)).toBe(true);
    expect(await limiter.allow(key, 2, 10)).toBe(false);
  });

  it('separates counters per key', async () => {
    const client = new FakeCounter();
    const limiter = new RedisRateLimiter(client);

    expect(await limiter.allow('k1', 1, 10)).toBe(true);
    expect(await limiter.allow('k2', 1, 10)).toBe(true);
    expect(await limiter.allow('k1', 1, 10)).toBe(false);
    expect(await limiter.allow('k2', 1, 10)).toBe(false);
  });
});

