export interface SimpleCacheClient {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string, ttlSeconds?: number): Promise<void> | void;
  del(key: string): Promise<number> | number;
  expire?(key: string, seconds: number): Promise<number> | number;
}

export interface CounterClient {
  incr(key: string): Promise<number> | number;
  expire(key: string, seconds: number): Promise<number> | number;
}

type BuildFn<T> = (sessionId: string) => Promise<T>;

export class SessionSnapshotCache<T = any> {
  private cache: SimpleCacheClient;
  private counter: CounterClient;
  private ttlSeconds: number;
  private build: BuildFn<T>;

  constructor(opts: { cache: SimpleCacheClient; counter: CounterClient; ttlSeconds: number; build: BuildFn<T> }) {
    this.cache = opts.cache;
    this.counter = opts.counter;
    this.ttlSeconds = Math.max(1, opts.ttlSeconds || 5);
    this.build = opts.build;
  }

  async get(sessionId: string): Promise<T> {
    const key = this.snapshotKey(sessionId);
    const lockKey = `${key}:lock`;
    const lockTtl = 2; // seconds
    try {
      const cached = await this.cache.get(key);
      if (cached) return JSON.parse(cached) as T;
    } catch {}
    // Simple anti-stampede: try to acquire a short lock using counter.incr
    let haveLock = false;
    try {
      const v = await this.counter.incr(lockKey);
      await this.counter.expire(lockKey, lockTtl);
      haveLock = v === 1;
    } catch {}

    let snap: T;
    if (haveLock) {
      // We build and set
      snap = await this.build(sessionId);
      try {
        await this.cache.set(key, JSON.stringify(snap), this.ttlSeconds);
      } catch {}
    } else {
      // Another builder likely in flight; briefly wait and re-read
      await new Promise((r) => setTimeout(r, 50));
      const cached2 = await this.cache.get(key);
      if (cached2) return JSON.parse(cached2) as T;
      // Fallback: build anyway if still missing to avoid failure
      snap = await this.build(sessionId);
      try { await this.cache.set(key, JSON.stringify(snap), this.ttlSeconds); } catch {}
    }
    return snap;
  }

  async invalidate(sessionId: string): Promise<void> {
    try {
      await this.cache.del(this.snapshotKey(sessionId));
      await this.counter.incr(this.stateVersionKey(sessionId));
      await this.counter.expire(this.stateVersionKey(sessionId), 3600);
    } catch {}
  }

  private snapshotKey(sessionId: string) {
    return `ws:snapshot:${sessionId}`;
  }
  private stateVersionKey(sessionId: string) {
    return `ws:stateVersion:${sessionId}`;
  }
}
