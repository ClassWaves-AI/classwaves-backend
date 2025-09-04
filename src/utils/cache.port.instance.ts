import type { CachePort } from '../services/cache.port';
import { RedisCacheAdapter } from '../adapters/cache.redis';

let instance: CachePort | null = null;

export function getCachePort(): CachePort {
  if (!instance) instance = new RedisCacheAdapter();
  return instance;
}

export const cachePort: CachePort = getCachePort();

