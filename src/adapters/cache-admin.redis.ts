import type { CacheAdminPort } from '../services/cache-admin.port';
import { redisService } from '../services/redis.service';

export class RedisCacheAdminAdapter implements CacheAdminPort {
  async scan(matchPattern: string, count: number = 1000): Promise<string[]> {
    const client: any = redisService.getClient();
    let cursor = '0';
    const keys: string[] = [];
    do {
      const [nextCursor, batch]: [string, string[]] = await client.scan(
        cursor,
        'MATCH',
        matchPattern,
        'COUNT',
        count
      );
      if (Array.isArray(batch) && batch.length) keys.push(...batch);
      cursor = nextCursor;
    } while (cursor !== '0');
    return keys;
  }

  async deleteMany(keys: string[]): Promise<number> {
    if (!keys || keys.length === 0) return 0;
    const client: any = redisService.getClient();
    const pipeline = typeof client.pipeline === 'function' ? client.pipeline() : null;
    if (pipeline && typeof pipeline.del === 'function') {
      for (const k of keys) pipeline.del(k);
      const results: Array<[Error | null, number]> = await pipeline.exec();
      return results.reduce((sum, [, res]) => sum + (typeof res === 'number' ? res : 0), 0);
    }
    // Fallback: sequential DEL for mock client
    let total = 0;
    for (const k of keys) {
      try {
        const n: number = await client.del(k);
        total += typeof n === 'number' ? n : 0;
      } catch {}
    }
    return total;
  }

  async unlinkMany(keys: string[]): Promise<number> {
    if (!keys || keys.length === 0) return 0;
    const client: any = redisService.getClient();
    const hasUnlink = typeof client.unlink === 'function';
    if (!hasUnlink) return this.deleteMany(keys);
    const pipeline = typeof client.pipeline === 'function' ? client.pipeline() : null;
    if (pipeline && typeof pipeline.unlink === 'function') {
      for (const k of keys) pipeline.unlink(k);
      const results: Array<[Error | null, number]> = await pipeline.exec();
      return results.reduce((sum, [, res]) => sum + (typeof res === 'number' ? res : 0), 0);
    }
    // Fallback: sequential UNLINK (or DEL if unlink missing)
    let total = 0;
    for (const k of keys) {
      try {
        const n: number = await client.unlink(k);
        total += typeof n === 'number' ? n : 0;
      } catch {
        try {
          const n: number = await client.del(k);
          total += typeof n === 'number' ? n : 0;
        } catch {}
      }
    }
    return total;
  }

  async deleteByPattern(patterns: string[], count: number = 1000): Promise<number> {
    let total = 0;
    for (const p of patterns) {
      const keys = await this.scan(p, count);
      total += await this.unlinkMany(keys);
    }
    return total;
  }
}
