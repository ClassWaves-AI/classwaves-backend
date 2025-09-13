import type { IdempotencyPort } from '../services/idempotency.port';
import { getRedisService } from '../services/redis.service';

/**
 * Redis-backed Idempotency adapter
 * - Uses SET key value NX PX ttlMs for atomic one-time acquisition
 * - Wrapper executes provided fn only on first acquisition
 */
export class RedisIdempotencyAdapter implements IdempotencyPort {
  async acquireOnce(key: string, ttlMs: number): Promise<boolean> {
    const client = getRedisService().getClient();
    // ioredis supports: set(key, value, 'NX', 'PX', ttlMs)
    const result = await (client as any).set(key, '1', 'NX', 'PX', Math.max(1, Math.floor(ttlMs)));
    return result === 'OK';
  }

  async withIdempotency<T>(
    key: string,
    ttlMs: number,
    fn: () => Promise<T>
  ): Promise<{ executed: boolean; result?: T }> {
    const acquired = await this.acquireOnce(key, ttlMs);
    if (!acquired) return { executed: false };
    const result = await fn();
    return { executed: true, result };
  }
}

