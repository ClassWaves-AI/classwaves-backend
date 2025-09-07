import { SessionSnapshotCache, SimpleCacheClient, CounterClient } from '../../../../services/websocket/utils/snapshot-cache.util';

class MemoryCache implements SimpleCacheClient {
  store = new Map<string, { v: string; ttl?: number }>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.v ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, { v: value });
  }
  async del(key: string): Promise<number> {
    const had = this.store.delete(key);
    return had ? 1 : 0;
  }
}

class MemoryCounter implements CounterClient {
  store = new Map<string, number>();
  async incr(key: string): Promise<number> {
    const v = (this.store.get(key) || 0) + 1;
    this.store.set(key, v);
    return v;
  }
  async expire(): Promise<number> {
    return 1;
  }
}

describe('SessionSnapshotCache', () => {
  it('caches snapshots and invalidates correctly', async () => {
    const cache = new MemoryCache();
    const counter = new MemoryCounter();
    let builds = 0;
    const builder = async (sid: string) => ({ sid, ts: Date.now(), builds: ++builds });

    const ssc = new SessionSnapshotCache({ cache, counter, ttlSeconds: 5, build: builder });

    const first = await ssc.get('S1');
    const second = await ssc.get('S1');
    expect(first.builds).toBe(1);
    expect(second.builds).toBe(1); // cached

    await ssc.invalidate('S1');
    const third = await ssc.get('S1');
    expect(third.builds).toBe(2); // rebuilt after invalidation
  });
});

