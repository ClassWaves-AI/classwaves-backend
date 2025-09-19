import { Request, Response, NextFunction } from 'express';
import { cacheManager, CacheTTLConfig } from '../services/cache-manager.service';
import * as client from 'prom-client';
import { cacheEventBus } from '../services/cache-event-bus.service';
import { AuthRequest } from '../types/auth.types';
import { logger } from '../utils/logger';

/**
 * Express Middleware for Automatic Cache Management
 * Provides declarative caching through route-level configuration
 */

export interface CacheConfig {
  key: string | ((req: Request) => string);
  tags: string[] | ((req: Request) => string[]);
  ttl?: number | string; // number (seconds) or TTL config key
  condition?: (req: Request) => boolean;
  autoInvalidate?: boolean;
  namespace?: string;
}

export interface CacheMiddlewareOptions {
  enabled?: boolean;
  defaultTTL?: number;
  skipOnError?: boolean;
  logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'none';
}

/**
 * Cache response middleware factory
 */
export function cacheResponse(config: CacheConfig, options: CacheMiddlewareOptions = {}) {
  const {
    enabled = true,
    defaultTTL = 300,
    skipOnError = true,
    logLevel = 'info'
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    if (!enabled) {
      return next();
    }

    try {
      // Check cache condition
      if (config.condition && !config.condition(req)) {
        return next();
      }

      // Generate cache key
      const cacheKey = typeof config.key === 'function' 
        ? config.key(req) 
        : config.key;

      // Generate cache tags
      const tags = typeof config.tags === 'function'
        ? config.tags(req)
        : config.tags;

      // Determine TTL
      const ttl = typeof config.ttl === 'string'
        ? CacheTTLConfig[config.ttl as keyof typeof CacheTTLConfig] || defaultTTL
        : config.ttl || defaultTTL;

      // Try to get from cache (track latency + hit/miss)
      const start = Date.now();
      const cached = await cacheManager.get(cacheKey);
      const queryType = String(config.namespace || 'api');
      const hitCounter = (client.register.getSingleMetric('cache_hit_total') as client.Counter<string>)
        || new client.Counter({ name: 'cache_hit_total', help: 'Cache hits', labelNames: ['queryType'] });
      const missCounter = (client.register.getSingleMetric('cache_miss_total') as client.Counter<string>)
        || new client.Counter({ name: 'cache_miss_total', help: 'Cache misses', labelNames: ['queryType'] });
      const getLatency = (client.register.getSingleMetric('cache_get_latency_ms') as client.Histogram<string>)
        || new client.Histogram({ name: 'cache_get_latency_ms', help: 'Cache GET latency (ms)', labelNames: ['queryType'], buckets: [1, 2, 5, 10, 20, 50, 100, 200] });
      
      if (cached) {
        if (logLevel !== 'none') {
          logger.debug(`⚡ Cache HIT: ${cacheKey}`);
        }
        try { hitCounter.inc({ queryType }); } catch { /* intentionally ignored: best effort cleanup */ }
        try { getLatency.observe({ queryType }, Date.now() - start); } catch { /* intentionally ignored: best effort cleanup */ }
        
        // Return cached response
        return res.json(cached);
      }

      // Cache miss - intercept response
      const originalJson = res.json;
      try { missCounter.inc({ queryType }); } catch { /* intentionally ignored: best effort cleanup */ }
      try { getLatency.observe({ queryType }, Date.now() - start); } catch { /* intentionally ignored: best effort cleanup */ }
      
      res.json = function(data: any) {
        // Store in cache asynchronously
        cacheManager.set(cacheKey, data, {
          tags,
          ttl,
          namespace: config.namespace,
          autoWarm: false
        }).catch(error => {
          if (logLevel !== 'none') {
            logger.warn(`⚠️ Cache set failed for ${cacheKey}:`, error);
          }
        });

        if (logLevel !== 'none') {
          logger.debug(`💾 Cache SET: ${cacheKey} (TTL: ${ttl}s, Tags: [${tags.join(', ')}])`);
        }

        // Call original json method
        return originalJson.call(this, data);
      };

      next();

    } catch (error) {
      if (skipOnError) {
        logger.warn('Cache middleware error (skipping):', error);
        next();
      } else {
        next(error);
      }
    }
  };
}

/**
 * Cache invalidation middleware for mutation operations
 */
export function invalidateCache(tags: string[] | ((req: Request) => string[])) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Store original methods
      const originalJson = res.json;
      const originalSend = res.send;

      // Invalidate after successful response
      const handleSuccess = async () => {
        try {
          const tagsToInvalidate = typeof tags === 'function' ? tags(req) : tags;
          
          await Promise.all(
            tagsToInvalidate.map(tag => cacheManager.invalidateByTag(tag))
          );
          
          logger.debug(`🗑️ Cache invalidated tags: [${tagsToInvalidate.join(', ')}]`);
        } catch (error) {
          logger.warn('Cache invalidation error:', error);
        }
      };

      // Override json method
      res.json = function(data: any) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          setImmediate(handleSuccess); // Don't block response
        }
        return originalJson.call(this, data);
      };

      // Override send method
      res.send = function(data: any) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          setImmediate(handleSuccess); // Don't block response
        }
        return originalSend.call(this, data);
      };

      next();

    } catch (error) {
      logger.warn('Cache invalidation middleware error:', error);
      next(error);
    }
  };
}

/**
 * Predefined cache configurations for common patterns
 */
export const CacheConfigs = {
  /**
   * Session list cache - varies by teacher and query params
   */
  sessionList: (ttl: number = CacheTTLConfig['session-list']): CacheConfig => ({
    key: (req: Request) => {
      const authReq = req as AuthRequest;
      const teacherId = authReq.user?.id || 'anonymous';
      const limit = req.query.limit || 'all';
      const status = req.query.status || 'all';
      return `sessions:teacher:${teacherId}:limit:${limit}:status:${status}`;
    },
    tags: (req: Request) => {
      const authReq = req as AuthRequest;
      const teacherId = authReq.user?.id || 'anonymous';
      return [`teacher:${teacherId}`, 'sessions'];
    },
    ttl,
    condition: (req: Request) => req.method === 'GET',
    namespace: 'api'
  }),

  /**
   * Session detail cache - specific session
   */
  sessionDetail: (ttl: number = CacheTTLConfig['session-detail']): CacheConfig => ({
    key: (req: Request) => {
      const sessionId = req.params.sessionId || req.params.id;
      const authReq = req as AuthRequest;
      const teacherId = authReq.user?.id || 'anonymous';
      return `session:${sessionId}:teacher:${teacherId}`;
    },
    tags: (req: Request) => {
      const sessionId = req.params.sessionId || req.params.id;
      const authReq = req as AuthRequest;
      const teacherId = authReq.user?.id || 'anonymous';
      return [`session:${sessionId}`, `teacher:${teacherId}`];
    },
    ttl,
    condition: (req: Request) => req.method === 'GET',
    namespace: 'api'
  }),

  /**
   * Analytics cache - shorter TTL for real-time data
   */
  sessionAnalytics: (ttl: number = CacheTTLConfig['session-analytics']): CacheConfig => ({
    key: (req: Request) => {
      const sessionId = req.params.sessionId || req.params.id;
      return `analytics:session:${sessionId}`;
    },
    tags: (req: Request) => {
      const sessionId = req.params.sessionId || req.params.id;
      return [`analytics:${sessionId}`, 'analytics'];
    },
    ttl,
    condition: (req: Request) => req.method === 'GET',
    namespace: 'analytics'
  }),

  /**
   * User profile cache
   */
  userProfile: (ttl: number = CacheTTLConfig['user-profile']): CacheConfig => ({
    key: (req: Request) => {
      const authReq = req as AuthRequest;
      const userId = authReq.user?.id || req.params.userId;
      return `user:${userId}:profile`;
    },
    tags: (req: Request) => {
      const authReq = req as AuthRequest;
      const userId = authReq.user?.id || req.params.userId;
      return [`user:${userId}`];
    },
    ttl,
    condition: (req: Request) => req.method === 'GET',
    namespace: 'users'
  }),
};

/**
 * Cache invalidation configurations for mutations
 */
export const InvalidationConfigs = {
  /**
   * Session mutations - invalidate teacher and session-specific caches
   */
  sessionMutation: (req: Request) => {
    const authReq = req as AuthRequest;
    const teacherId = authReq.user?.id || 'unknown';
    const sessionId = req.params.sessionId || req.params.id;
    
    const tags = [`teacher:${teacherId}`, 'sessions'];
    if (sessionId) {
      tags.push(`session:${sessionId}`, `analytics:${sessionId}`);
    }
    return tags;
  },

  /**
   * Teacher mutations - invalidate all teacher-related caches
   */
  teacherMutation: (req: Request) => {
    const authReq = req as AuthRequest;
    const teacherId = authReq.user?.id || req.params.teacherId;
    return [`teacher:${teacherId}`, `user:${teacherId}`];
  },

  /**
   * School mutations - broad invalidation
   */
  schoolMutation: (req: Request) => {
    const schoolId = req.params.schoolId;
    return [`school:${schoolId}`];
  },
};

/**
 * Event-driven cache middleware - emits domain events for invalidation
 */
export function emitCacheEvent(eventType: string, payloadExtractor: (req: Request, res: Response) => any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const originalJson = res.json;
      
      res.json = function(data: any) {
        // Emit cache event after successful response
        if (res.statusCode >= 200 && res.statusCode < 300) {
          setImmediate(async () => {
            try {
              const payload = payloadExtractor(req, res);
              
              // Emit specific event type
              switch (eventType) {
                case 'session.created':
                  await cacheEventBus.sessionCreated(
                    payload.sessionId,
                    payload.teacherId,
                    payload.schoolId
                  );
                  break;
                case 'session.updated':
                  await cacheEventBus.sessionUpdated(
                    payload.sessionId,
                    payload.teacherId,
                    payload.changes || []
                  );
                  break;
                case 'session.deleted':
                  await cacheEventBus.sessionDeleted(
                    payload.sessionId,
                    payload.teacherId
                  );
                  break;
                case 'session.status_changed':
                  await cacheEventBus.sessionStatusChanged(
                    payload.sessionId,
                    payload.teacherId,
                    payload.oldStatus,
                    payload.newStatus
                  );
                  break;
              }
            } catch (error) {
              logger.warn('Cache event emission failed:', error);
            }
          });
        }
        
        return originalJson.call(this, data);
      };

      next();

    } catch (error) {
      logger.warn('Cache event middleware error:', error);
      next(error);
    }
  };
}

/**
 * Convenience decorators for common cache operations
 */
export const CacheDecorators = {
  /**
   * Cache session list with standard configuration
   */
  sessionList: (options?: CacheMiddlewareOptions) => 
    cacheResponse(CacheConfigs.sessionList(), options),

  /**
   * Cache session detail with standard configuration  
   */
  sessionDetail: (options?: CacheMiddlewareOptions) =>
    cacheResponse(CacheConfigs.sessionDetail(), options),

  /**
   * Cache session analytics with short TTL
   */
  sessionAnalytics: (options?: CacheMiddlewareOptions) =>
    cacheResponse(CacheConfigs.sessionAnalytics(), options),

  /**
   * Invalidate after session mutations
   */
  invalidateSessionCache: () =>
    invalidateCache(InvalidationConfigs.sessionMutation),

  /**
   * Emit session created event
   */
  sessionCreatedEvent: () =>
    emitCacheEvent('session.created', (req: Request) => {
      const authReq = req as AuthRequest;
      return {
        sessionId: req.body.sessionId || (req as any).sessionId,
        teacherId: authReq.user?.id,
        schoolId: authReq.school?.id,
      };
    }),

  /**
   * Emit session updated event
   */
  sessionUpdatedEvent: (changes: string[] = []) =>
    emitCacheEvent('session.updated', (req: Request) => {
      const authReq = req as AuthRequest;
      return {
        sessionId: req.params.sessionId || req.params.id,
        teacherId: authReq.user?.id,
        changes,
      };
    }),
};