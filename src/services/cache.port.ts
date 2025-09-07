export interface CachePort {
  // Simple KV
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<number>;

  // Counters / TTL helpers
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
}

