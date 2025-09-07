import type { CachePort } from '../services/cache.port';
import { redisService } from '../services/redis.service';

export class RedisCacheAdapter implements CachePort {
  async get(key: string): Promise<string | null> {
    return redisService.get(key);
  }
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    return redisService.set(key, value, ttlSeconds);
  }
  async del(key: string): Promise<number> {
    return redisService.del(key);
  }
  async incr(key: string): Promise<number> {
    return redisService.getClient().incr(key);
  }
  async expire(key: string, seconds: number): Promise<number> {
    return redisService.expire(key, seconds);
  }
}

export const redisCacheAdapter = new RedisCacheAdapter();

