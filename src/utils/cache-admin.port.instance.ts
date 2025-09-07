import type { CacheAdminPort } from '../services/cache-admin.port';
import { RedisCacheAdminAdapter } from '../adapters/cache-admin.redis';

let adminInstance: CacheAdminPort | null = null;

export function getCacheAdminPort(): CacheAdminPort {
  if (!adminInstance) adminInstance = new RedisCacheAdminAdapter();
  return adminInstance;
}

export const cacheAdminPort: CacheAdminPort = getCacheAdminPort();

