import { RedisIdempotencyAdapter } from '../../../adapters/idempotency.redis';

// Mock ioredis via redis.service pattern
jest.mock('../../../services/redis.service', () => {
  const store = new Map<string, { v: string; exp?: number }>();
  const now = () => Date.now();
  const client = {
    set: jest.fn(async (k: string, v: string, opt1?: any, opt2?: any, opt3?: any) => {
      // Support both ('NX','PX',ms) or object opts (not used here)
      const args = [opt1, opt2, opt3].filter((x) => x != null).map((x) => String(x).toUpperCase());
      const hasNX = args.includes('NX');
      const pxIdx = args.indexOf('PX');
      let ttlMs: number | undefined;
      if (pxIdx >= 0 && typeof [opt1, opt2, opt3][pxIdx + 1] !== 'undefined') {
        const raw = [opt1, opt2, opt3][pxIdx + 1];
        ttlMs = Number(raw);
      }
      if (hasNX && store.has(k)) return null;
      const exp = ttlMs ? now() + ttlMs : undefined;
      store.set(k, { v, exp });
      return 'OK';
    }),
  } as any;
  return { getRedisService: () => ({ getClient: () => client }) };
});

describe('RedisIdempotencyAdapter', () => {
  let adapter: RedisIdempotencyAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new RedisIdempotencyAdapter();
  });

  it('acquireOnce returns true first time, false thereafter (until TTL expiry)', async () => {
    const key = 'test:once:1';
    const ttl = 50; // ms
    const first = await adapter.acquireOnce(key, ttl);
    const second = await adapter.acquireOnce(key, ttl);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('withIdempotency executes fn once and returns executed flag', async () => {
    const key = 'test:wrap:1';
    const fn = jest.fn(async () => 42);
    const a = await adapter.withIdempotency(key, 1000, fn);
    const b = await adapter.withIdempotency(key, 1000, fn);
    expect(a.executed).toBe(true);
    expect(a.result).toBe(42);
    expect(b.executed).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

