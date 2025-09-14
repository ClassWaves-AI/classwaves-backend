/**
 * Query Cache Service - High-performance caching for optimized database queries
 * 
 * Addresses the critical Redis hit rate issue (8.89% -> target 70%+) by implementing
 * intelligent caching for our newly optimized minimal-field queries.
 * 
 * Key Features:
 * - Multi-layer caching (memory + Redis)
 * - Query-specific TTL management
 * - Cache warming for frequently accessed data
 * - Intelligent cache invalidation
 * - Performance monitoring
 * 
 * Created for: Platform Stabilization Task 2.11 - Redis Optimization
 */

import type { CachePort } from './cache.port';
import { cachePort } from '../utils/cache.port.instance';
import { performance } from 'perf_hooks';
import { makeKey, isPrefixEnabled, isDualWriteEnabled } from '../utils/key-prefix.util';
import { composeEpochKey, isEpochsEnabled } from './tag-epoch.service';
import { CacheTTLPolicy, ttlWithJitter } from './cache-ttl.policy';
import { decompressToString, compressString } from '../utils/compression.util';
import { cacheAdminPort } from '../utils/cache-admin.port.instance';
import * as client from 'prom-client';

interface CacheEntry<T = any> {
  data: T;
  cachedAt: number;
  ttl: number;
  queryHash: string;
  softTtl?: number; // seconds; if absent, computed as a fraction of ttl
}

interface CacheMetrics {
  hits: number;
  misses: number;
  hitRate: number;
  averageRetrievalTime: number;
  totalQueries: number;
  legacyFallbacks?: number;
  coalesced?: number;
  refreshAhead?: number;
  staleServed?: number;
}

interface CacheStrategy {
  ttlSeconds: number;
  warmOnMiss: boolean;
  preload: boolean;
  invalidateOnUpdate: boolean;
  compressionEnabled: boolean;
}

export class QueryCacheService {
  private metrics: Map<string, CacheMetrics> = new Map();
  private inflight: Map<string, Promise<any>> = new Map();
  // Enabled by default; disable with CW_CACHE_NX_LOCKS=0
  private useNxLocks: boolean = process.env.CW_CACHE_NX_LOCKS !== '0';
  private readonly STALE_IF_ERROR_GRACE_MS = 60_000; // 60s grace window
  constructor(private cache: CachePort = cachePort) {}
  
  // Prometheus metrics (per-keyspace/queryType)
  private static cacheHitsTotal = (() => {
    try {
      return new client.Counter({ name: 'query_cache_hits_total', help: 'Total cache hits by queryType', labelNames: ['queryType'] });
    } catch {
      return client.register.getSingleMetric('query_cache_hits_total') as client.Counter<string>;
    }
  })();
  private static cacheMissesTotal = (() => {
    try {
      return new client.Counter({ name: 'query_cache_misses_total', help: 'Total cache misses by queryType', labelNames: ['queryType'] });
    } catch {
      return client.register.getSingleMetric('query_cache_misses_total') as client.Counter<string>;
    }
  })();
  private static cacheRefreshAheadTotal = (() => {
    try {
      return new client.Counter({ name: 'query_cache_refresh_ahead_total', help: 'Refresh-ahead occurrences by queryType', labelNames: ['queryType'] });
    } catch {
      return client.register.getSingleMetric('query_cache_refresh_ahead_total') as client.Counter<string>;
    }
  })();
  private static cacheCoalescedTotal = (() => {
    try {
      return new client.Counter({ name: 'query_cache_coalesced_total', help: 'Coalesced single-flight counts by queryType', labelNames: ['queryType'] });
    } catch {
      return client.register.getSingleMetric('query_cache_coalesced_total') as client.Counter<string>;
    }
  })();
  private static cacheStaleServedTotal = (() => {
    try {
      return new client.Counter({ name: 'query_cache_stale_served_total', help: 'Stale-if-error served counts by queryType', labelNames: ['queryType'] });
    } catch {
      return client.register.getSingleMetric('query_cache_stale_served_total') as client.Counter<string>;
    }
  })();
  private static cacheLegacyFallbacksTotal = (() => {
    try {
      return new client.Counter({ name: 'query_cache_legacy_fallbacks_total', help: 'Legacy key fallbacks by queryType', labelNames: ['queryType'] });
    } catch {
      return client.register.getSingleMetric('query_cache_legacy_fallbacks_total') as client.Counter<string>;
    }
  })();
  
  // Cache strategies by query type
  private readonly CACHE_STRATEGIES: Record<string, CacheStrategy> = {
    // Session queries can be cached longer since sessions don't change frequently
    'session-list': {
      ttlSeconds: CacheTTLPolicy.query['session-list'],
      warmOnMiss: true,
      preload: false,
      invalidateOnUpdate: true,
      compressionEnabled: true
    },
    'session-detail': {
      ttlSeconds: CacheTTLPolicy.query['session-detail'],
      warmOnMiss: true,
      preload: true, // Preload when session is accessed
      invalidateOnUpdate: true,
      compressionEnabled: false
    },
    // Analytics can be cached even longer since it's computed data
    'teacher-analytics': {
      ttlSeconds: CacheTTLPolicy.query['teacher-analytics'],
      warmOnMiss: true,
      preload: false,
      invalidateOnUpdate: false, // Analytics update in background
      compressionEnabled: true
    },
    // Group status summary for a session (short TTL)
    'group-status': {
      ttlSeconds: CacheTTLPolicy.query['group-status'],
      warmOnMiss: false,
      preload: false,
      invalidateOnUpdate: true,
      compressionEnabled: false
    },
    'session-analytics': {
      ttlSeconds: CacheTTLPolicy.query['session-analytics'],
      warmOnMiss: true,
      preload: false,
      invalidateOnUpdate: false,
      compressionEnabled: true
    },
    // Dashboard metrics per teacher (short TTL)
    'dashboard-metrics': {
      ttlSeconds: CacheTTLPolicy.query['dashboard-metrics'],
      warmOnMiss: false,
      preload: false,
      invalidateOnUpdate: true,
      compressionEnabled: false
    }
  };

  /**
   * Get cached query result with fallback to database
   */
  async getCachedQuery<T>(
    cacheKey: string,
    queryType: string,
    dataFetcher: () => Promise<T>,
    context: { teacherId?: string; sessionId?: string } = {}
  ): Promise<T> {
    const startTime = performance.now();
    const fullCacheKey = `query_cache:${queryType}:${cacheKey}`;
    const prefixedKey = makeKey('query_cache', queryType, cacheKey);
    const flightKey = isPrefixEnabled() ? prefixedKey : fullCacheKey;
    let cachedEntryForStale: CacheEntry<T> | null = null;
    try {
      // Try Redis first (prefixed if enabled, with legacy fallback)
      let cachedData: string | null = null;
      const epochTags = this.getEpochTags(queryType, context);
      const useEpochs = isEpochsEnabled() && epochTags.length > 0;
      let epochPrefixedKey = prefixedKey;
      let epochLegacyKey = fullCacheKey;
      if (useEpochs) {
        epochPrefixedKey = await composeEpochKey(prefixedKey, epochTags);
        epochLegacyKey = await composeEpochKey(fullCacheKey, epochTags);
      }
      if (isPrefixEnabled()) {
        cachedData = await this.cache.get(useEpochs ? epochPrefixedKey : prefixedKey);
        if (!cachedData) {
          cachedData = await this.cache.get(useEpochs ? epochLegacyKey : fullCacheKey);
          if (cachedData) this.recordLegacyFallback(queryType);
        }
        if (!cachedData && useEpochs) {
          // Fallback to non-epoch keys during migration
          cachedData = (await this.cache.get(prefixedKey)) ?? (await this.cache.get(fullCacheKey));
        }
      } else {
        cachedData = await this.cache.get(useEpochs ? epochLegacyKey : fullCacheKey);
        if (!cachedData && useEpochs) {
          cachedData = await this.cache.get(fullCacheKey);
        }
      }
      
      if (cachedData) {
        const cacheEntry: CacheEntry<T> = JSON.parse(decompressToString(cachedData));
        cachedEntryForStale = cacheEntry;
        const now = Date.now();
        const ageMs = now - cacheEntry.cachedAt;
        const strategy = this.CACHE_STRATEGIES[queryType];
        const softMs = ((cacheEntry.softTtl ?? this.computeSoftTtl(strategy.ttlSeconds)) * 1000);
        const hardMs = strategy.ttlSeconds * 1000;
        if (ageMs < softMs) {
          this.recordHit(queryType, performance.now() - startTime);
          return cacheEntry.data;
        }
        if (ageMs < hardMs) {
          // Serve stale but trigger refresh-ahead
          this.recordRefreshAhead(queryType);
          this.triggerRefreshAhead(flightKey, queryType, fullCacheKey, prefixedKey, cacheKey, context, () => dataFetcher());
          return cacheEntry.data;
        }
      }

      // Cache miss - single-flight coalescing
      if (this.inflight.has(flightKey)) {
        this.recordCoalesced(queryType);
        return this.inflight.get(flightKey)! as Promise<T>;
      }

      const p = (async () => {
        console.log(`💾 Cache MISS: ${queryType}, fetching from database`);
        const dbStartTime = performance.now();
        let data: T;
        const lockKey = makeKey('lock', 'query_cache', queryType, cacheKey);
        let acquired = false;
        if (this.useNxLocks) {
          try {
            // Lightweight NX lock via INCR + EXPIRE
            const n = await this.cache.incr(lockKey);
            if (n === 1) {
              await this.cache.expire(lockKey, 30);
              acquired = true;
            } else {
              // Another instance is fetching; poll briefly for cache fill
              for (let i = 0; i < 10; i++) {
                const maybe = isPrefixEnabled() ? (await this.cache.get(prefixedKey)) ?? (await this.cache.get(fullCacheKey)) : await this.cache.get(fullCacheKey);
                if (maybe) {
                  const entry: CacheEntry<T> = JSON.parse(decompressToString(maybe));
                  return entry.data;
                }
                await this.sleep(100);
              }
            }
          } catch {}
        }

        data = await dataFetcher();
        const dbTime = performance.now() - dbStartTime;
        await this.storeCachedQuery({ legacyKey: fullCacheKey, prefixedKey }, queryType, data, context);
        this.recordMiss(queryType, performance.now() - startTime, dbTime);
        console.log(`📊 Cache STORED: ${queryType} (fetch: ${dbTime.toFixed(2)}ms, total: ${(performance.now() - startTime).toFixed(2)}ms)`);
        // Release lock if held
        if (this.useNxLocks && acquired) {
          try { await this.cache.del(lockKey); } catch {}
        }
        return data;
      })().finally(() => {
        this.inflight.delete(flightKey);
      });
      this.inflight.set(flightKey, p);
      return p;
      
    } catch (error) {
      console.error(`❌ Cache error for ${queryType}:`, error);
      // Stale-if-error: if we have a recently expired entry, serve it within grace
      if (cachedEntryForStale) {
        const strategy = this.CACHE_STRATEGIES[queryType];
        const ageMs = Date.now() - cachedEntryForStale.cachedAt;
        const hardMs = strategy.ttlSeconds * 1000;
        if (ageMs <= hardMs + this.STALE_IF_ERROR_GRACE_MS) {
          this.recordStaleServed(queryType);
          return cachedEntryForStale.data;
        }
      }
      // Fallback to direct database call
      return await dataFetcher();
    }
  }

  /**
   * Write-through helper to upsert a cache entry for a given query type/key.
   * Uses the same storage format as getCachedQuery.
   */
  async upsertCachedQuery<T>(
    queryType: string,
    cacheKey: string,
    data: T,
    context: { teacherId?: string; sessionId?: string } = {}
  ): Promise<void> {
    const legacyKey = `query_cache:${queryType}:${cacheKey}`;
    const prefixedKey = makeKey('query_cache', queryType, cacheKey);
    await this.storeCachedQuery({ legacyKey, prefixedKey }, queryType, data, context);
  }

  /**
   * Store query result in cache with compression if needed
   */
  private async storeCachedQuery<T>(
    keys: { legacyKey: string; prefixedKey: string },
    queryType: string,
    data: T,
    context: { teacherId?: string; sessionId?: string }
  ): Promise<void> {
    const strategy = this.CACHE_STRATEGIES[queryType];
    if (!strategy) return;

    // Guard against accidental partial write-throughs for session-detail
    if (queryType === 'session-detail') {
      const d: any = data as any;
      const hasCore = d && (d.title != null || d.access_code != null || d.goal != null || d.description != null);
      if (!hasCore) {
        // Skip caching incomplete rows to avoid first-load UI gaps
        console.warn('⚠️ Skipping cache write: session-detail missing core fields (title/goal/description/access_code)');
        return;
      }
    }

    const baseKey = isPrefixEnabled() ? keys.prefixedKey : keys.legacyKey;
    const cacheEntry: CacheEntry<T> = {
      data,
      cachedAt: Date.now(),
      ttl: strategy.ttlSeconds,
      softTtl: this.computeSoftTtl(strategy.ttlSeconds),
      queryHash: this.generateQueryHash(baseKey, context)
    };

    let cacheData = JSON.stringify(cacheEntry);
    
    // Apply compression for large payloads
    const threshold = parseInt(process.env.CW_CACHE_COMPRESS_THRESHOLD || '4096', 10);
    if (strategy.compressionEnabled && cacheData.length > threshold) {
      cacheData = compressString(cacheData);
    }

    const effectiveTtl = ttlWithJitter(strategy.ttlSeconds);
    const epochTags = this.getEpochTags(queryType, context);
    const useEpochs = isEpochsEnabled() && epochTags.length > 0;
    if (useEpochs) {
      const epochPrefixedKey = await composeEpochKey(keys.prefixedKey, epochTags);
      const epochLegacyKey = await composeEpochKey(keys.legacyKey, epochTags);
      if (isPrefixEnabled()) {
        await this.cache.set(epochPrefixedKey, cacheData, effectiveTtl);
        if (isDualWriteEnabled()) {
          await this.cache.set(epochLegacyKey, cacheData, effectiveTtl);
        }
      } else {
        await this.cache.set(epochLegacyKey, cacheData, effectiveTtl);
      }
    } else {
      if (isPrefixEnabled()) {
        await this.cache.set(keys.prefixedKey, cacheData, effectiveTtl);
        if (isDualWriteEnabled()) {
          await this.cache.set(keys.legacyKey, cacheData, effectiveTtl);
        }
      } else {
        await this.cache.set(keys.legacyKey, cacheData, effectiveTtl);
      }
    }
    
    // Warm related caches if needed
    if (strategy.warmOnMiss) {
      this.scheduleWarmUp(queryType, context);
    }
  }

  /**
   * Invalidate cache entries for a specific query type or context
   */
  async invalidateCache(pattern: string): Promise<void> {
    try {
      let total = 0;
      const env = process.env.NODE_ENV || 'development';
      const matches = [`query_cache:${pattern}*`];
      if (isPrefixEnabled()) {
        matches.push(`cw:${env}:query_cache:${pattern}*`);
      }
      total = await cacheAdminPort.deleteByPattern(matches, 1000);
      if (total > 0) {
        console.log(`🧹 Invalidated ${total} cache entries for pattern: ${pattern}`);
      }
      
    } catch (error) {
      console.error('Failed to invalidate cache:', error);
    }
  }

  /**
   * Warm cache for frequently accessed queries
   */
  async warmCache(queryType: string, context: { teacherId?: string; sessionId?: string }): Promise<void> {
    const strategy = this.CACHE_STRATEGIES[queryType];
    if (!strategy?.preload) return;

    try {
      // This would trigger cache warming based on query type
      switch (queryType) {
        case 'session-detail':
          if (context.sessionId) {
            console.log(`🔥 Warming session detail cache: ${context.sessionId}`);
            // Trigger background cache warming
            this.scheduleWarmUp('session-detail', context);
          }
          break;
        case 'teacher-analytics':
          if (context.teacherId) {
            console.log(`🔥 Warming teacher analytics cache: ${context.teacherId}`);
            this.scheduleWarmUp('teacher-analytics', context);
          }
          break;
      }
    } catch (error) {
      console.error('Cache warming failed:', error);
    }
  }

  /**
   * Get cache performance metrics
   */
  getCacheMetrics(): Record<string, CacheMetrics> {
    const result: Record<string, CacheMetrics> = {};
    
    for (const [queryType, metrics] of this.metrics) {
      result[queryType] = {
        ...metrics,
        hitRate: metrics.totalQueries > 0 ? (metrics.hits / metrics.totalQueries) * 100 : 0
      };
    }
    
    return result;
  }

  /**
   * Get overall Redis performance improvement estimate
   */
  async getRedisImpactMetrics(): Promise<{
    estimatedHitRateImprovement: number;
    avgQueryTimeReduction: number;
    cacheUtilization: string;
  }> {
    const metrics = this.getCacheMetrics();
    const totalQueries = Object.values(metrics).reduce((sum, m) => sum + m.totalQueries, 0);
    const totalHits = Object.values(metrics).reduce((sum, m) => sum + m.hits, 0);
    
    const overallHitRate = totalQueries > 0 ? (totalHits / totalQueries) * 100 : 0;
    
    return {
      estimatedHitRateImprovement: Math.max(0, overallHitRate - 8.89), // Current baseline
      avgQueryTimeReduction: Object.values(metrics).reduce((sum, m) => sum + m.averageRetrievalTime, 0) / Object.keys(metrics).length || 0,
      cacheUtilization: `${totalQueries} queries, ${totalHits} hits, ${Object.keys(metrics).length} query types`
    };
  }

  // Private helper methods
  private recordHit(queryType: string, retrievalTime: number): void {
    const metrics = this.getOrCreateMetrics(queryType);
    metrics.hits++;
    metrics.totalQueries++;
    metrics.averageRetrievalTime = (metrics.averageRetrievalTime * (metrics.totalQueries - 1) + retrievalTime) / metrics.totalQueries;
    try { QueryCacheService.cacheHitsTotal.inc({ queryType }); } catch {}
  }

  private recordMiss(queryType: string, totalTime: number, dbTime: number): void {
    const metrics = this.getOrCreateMetrics(queryType);
    metrics.misses++;
    metrics.totalQueries++;
    metrics.averageRetrievalTime = (metrics.averageRetrievalTime * (metrics.totalQueries - 1) + totalTime) / metrics.totalQueries;
    try { QueryCacheService.cacheMissesTotal.inc({ queryType }); } catch {}
  }

  private recordLegacyFallback(queryType: string): void {
    const metrics = this.getOrCreateMetrics(queryType);
    metrics.legacyFallbacks = (metrics.legacyFallbacks || 0) + 1;
    try { QueryCacheService.cacheLegacyFallbacksTotal.inc({ queryType }); } catch {}
  }

  private recordCoalesced(queryType: string): void {
    const metrics = this.getOrCreateMetrics(queryType);
    metrics.coalesced = (metrics.coalesced || 0) + 1;
    try { QueryCacheService.cacheCoalescedTotal.inc({ queryType }); } catch {}
  }

  private recordRefreshAhead(queryType: string): void {
    const metrics = this.getOrCreateMetrics(queryType);
    metrics.refreshAhead = (metrics.refreshAhead || 0) + 1;
    try { QueryCacheService.cacheRefreshAheadTotal.inc({ queryType }); } catch {}
  }

  private recordStaleServed(queryType: string): void {
    const metrics = this.getOrCreateMetrics(queryType);
    metrics.staleServed = (metrics.staleServed || 0) + 1;
    try { QueryCacheService.cacheStaleServedTotal.inc({ queryType }); } catch {}
  }

  private getOrCreateMetrics(queryType: string): CacheMetrics {
    if (!this.metrics.has(queryType)) {
      this.metrics.set(queryType, {
        hits: 0,
        misses: 0,
        hitRate: 0,
        averageRetrievalTime: 0,
        totalQueries: 0
      });
    }
    return this.metrics.get(queryType)!;
  }

  private generateQueryHash(cacheKey: string, context: any): string {
    return Buffer.from(`${cacheKey}:${JSON.stringify(context)}`).toString('base64').slice(0, 16);
  }

  private scheduleWarmUp(queryType: string, context: any): void {
    // In production, this would use a job queue
    // For now, just log the intent
    console.log(`📋 Scheduled cache warm-up: ${queryType}`, context);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private getEpochTags(queryType: string, context: { teacherId?: string; sessionId?: string }): string[] {
    switch (queryType) {
      case 'session-list':
        return context.teacherId ? [`teacher:${context.teacherId}`] : [];
      case 'session-detail':
        return context.sessionId ? [`session:${context.sessionId}`] : [];
      case 'session-analytics':
        return context.sessionId ? [`analytics:${context.sessionId}`] : [];
      case 'teacher-analytics':
        return context.teacherId ? [`teacher:${context.teacherId}`] : [];
      case 'group-status':
        return context.sessionId ? [`session:${context.sessionId}`] : [];
      case 'dashboard-metrics':
        return context.teacherId ? [`teacher:${context.teacherId}`] : [];
      default:
        return [];
    }
  }

  private computeSoftTtl(ttlSeconds: number): number {
    // Default soft TTL is 70% of hard TTL
    const soft = Math.floor(ttlSeconds * 0.7);
    return Math.max(1, soft);
  }

  private triggerRefreshAhead(
    flightKey: string,
    queryType: string,
    legacyKey: string,
    prefixedKey: string,
    cacheKey: string,
    context: { teacherId?: string; sessionId?: string },
    dataFetcher: () => Promise<any>
  ): void {
    if (this.inflight.has(flightKey)) return; // already refreshing
    const p = (async () => {
      try {
        const data = await dataFetcher();
        await this.storeCachedQuery({ legacyKey, prefixedKey }, queryType, data, context);
      } catch (e) {
        console.warn(`⚠️ Refresh-ahead failed for ${queryType}:${cacheKey}`, e);
      } finally {
        this.inflight.delete(flightKey);
      }
    })();
    this.inflight.set(flightKey, p);
  }
}

// Singleton instance
export const queryCacheService = new QueryCacheService();
