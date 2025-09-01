import { redisService } from './redis.service';
import { EventEmitter } from 'events';

/**
 * Industry-Standard Cache Management System
 * Implements tag-based invalidation, hierarchical TTL, and event-driven updates
 */

export interface CacheOptions {
  tags: string[];
  ttl: number;
  namespace?: string;
  autoWarm?: boolean;
}

export interface CacheEntry<T = any> {
  data: T;
  tags: string[];
  timestamp: number;
  ttl: number;
  namespace?: string;
}

export interface CacheMetrics {
  hits: number;
  misses: number;
  invalidations: number;
  warmings: number;
  errors: number;
  lastReset: number;
}

/**
 * TTL Configuration for different data types
 * Hierarchical strategy: more volatile data = shorter TTL
 */
export const CacheTTLConfig = {
  // Session data
  'session-list': 300,        // 5 minutes - frequently changing
  'session-detail': 900,      // 15 minutes - more stable
  'session-analytics': 60,    // 1 minute - real-time data
  
  // User data  
  'user-profile': 1800,       // 30 minutes - rarely changes
  'user-permissions': 600,    // 10 minutes - security sensitive
  
  // School/roster data
  'school-data': 3600,        // 1 hour - very stable
  'roster-data': 1800,        // 30 minutes - periodic updates
  
  // Default fallback
  'default': 300,             // 5 minutes
} as const;

/**
 * Main Cache Manager with advanced features
 */
export class CacheManager extends EventEmitter {
  private static instance: CacheManager;
  private tagRegistry = new Map<string, Set<string>>(); // tag -> keys
  private keyRegistry = new Map<string, Set<string>>(); // key -> tags
  private metrics: CacheMetrics = {
    hits: 0,
    misses: 0,
    invalidations: 0,
    warmings: 0,
    errors: 0,
    lastReset: Date.now(),
  };

  private constructor() {
    super();
    this.setupEventListeners();
  }

  static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }

  /**
   * Get data from cache with automatic metrics tracking
   */
  async get<T = any>(key: string): Promise<T | null> {
    try {
      const cached = await redisService.get(key);
      
      if (!cached) {
        this.metrics.misses++;
        this.emit('cache:miss', { key });
        return null;
      }

      const entry: CacheEntry<T> = JSON.parse(cached);
      
      // Check if entry is expired (additional safety check)
      const age = Date.now() - entry.timestamp;
      if (age > entry.ttl * 1000) {
        await this.delete(key);
        this.metrics.misses++;
        this.emit('cache:expired', { key, age });
        return null;
      }

      this.metrics.hits++;
      this.emit('cache:hit', { key });
      return entry.data;
    } catch (error) {
      this.metrics.errors++;
      this.emit('cache:error', { key, error });
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set data in cache with tagging and metadata
   */
  async set<T = any>(key: string, data: T, options: CacheOptions): Promise<void> {
    try {
      const entry: CacheEntry<T> = {
        data,
        tags: options.tags,
        timestamp: Date.now(),
        ttl: options.ttl,
        namespace: options.namespace,
      };

      // Store in Redis with TTL
      await redisService.set(key, JSON.stringify(entry), options.ttl);

      // Update tag registry (tag -> keys mapping)
      for (const tag of options.tags) {
        if (!this.tagRegistry.has(tag)) {
          this.tagRegistry.set(tag, new Set());
        }
        this.tagRegistry.get(tag)!.add(key);
      }

      // Update key registry (key -> tags mapping)  
      this.keyRegistry.set(key, new Set(options.tags));

      this.emit('cache:set', { key, tags: options.tags, ttl: options.ttl });

      // Auto-warm related cache entries if enabled
      if (options.autoWarm) {
        this.scheduleWarming(options.tags);
      }
    } catch (error) {
      this.metrics.errors++;
      this.emit('cache:error', { key, error });
      console.error(`Cache set error for key ${key}:`, error);
    }
  }

  /**
   * Get or Set pattern - cache-aside implementation
   */
  async getOrSet<T = any>(
    key: string,
    factory: () => Promise<T>,
    options: CacheOptions
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - fetch from source
    try {
      const data = await factory();
      await this.set(key, data, options);
      return data;
    } catch (error) {
      this.metrics.errors++;
      this.emit('cache:factory-error', { key, error });
      throw error; // Re-throw factory errors
    }
  }

  /**
   * Delete specific cache entry
   */
  async delete(key: string): Promise<void> {
    try {
      await redisService.getClient().del(key);
      
      // Clean up registries
      const tags = this.keyRegistry.get(key);
      if (tags) {
        for (const tag of tags) {
          this.tagRegistry.get(tag)?.delete(key);
        }
        this.keyRegistry.delete(key);
      }

      this.emit('cache:delete', { key });
    } catch (error) {
      this.metrics.errors++;
      console.error(`Cache delete error for key ${key}:`, error);
    }
  }

  /**
   * Invalidate all cache entries with specific tag
   */
  async invalidateByTag(tag: string): Promise<number> {
    try {
      const keys = this.tagRegistry.get(tag);
      if (!keys || keys.size === 0) {
        return 0;
      }

      const keysArray = Array.from(keys);
      
      // Batch delete from Redis
      if (keysArray.length > 0) {
        await redisService.getClient().del(...keysArray);
      }

      // Clean up registries
      for (const key of keysArray) {
        const keyTags = this.keyRegistry.get(key);
        if (keyTags) {
          for (const keyTag of keyTags) {
            this.tagRegistry.get(keyTag)?.delete(key);
          }
          this.keyRegistry.delete(key);
        }
      }

      // Clean up the tag itself
      this.tagRegistry.delete(tag);
      
      this.metrics.invalidations++;
      this.emit('cache:invalidate-tag', { tag, count: keysArray.length });
      
      console.log(`🗑️ Invalidated ${keysArray.length} cache entries for tag: ${tag}`);
      return keysArray.length;
    } catch (error) {
      this.metrics.errors++;
      this.emit('cache:error', { tag, error });
      console.error(`Cache invalidation error for tag ${tag}:`, error);
      return 0;
    }
  }

  /**
   * Invalidate cache entries by pattern
   */
  async invalidateByPattern(pattern: string): Promise<number> {
    try {
      const keys = await redisService.getClient().keys(pattern);
      
      if (keys.length > 0) {
        await redisService.getClient().del(...keys);
        
        // Clean up registries
        for (const key of keys) {
          const keyTags = this.keyRegistry.get(key);
          if (keyTags) {
            for (const tag of keyTags) {
              this.tagRegistry.get(tag)?.delete(key);
            }
            this.keyRegistry.delete(key);
          }
        }
      }

      this.metrics.invalidations++;
      this.emit('cache:invalidate-pattern', { pattern, count: keys.length });
      
      console.log(`🗑️ Invalidated ${keys.length} cache entries for pattern: ${pattern}`);
      return keys.length;
    } catch (error) {
      this.metrics.errors++;
      this.emit('cache:error', { pattern, error });
      console.error(`Cache pattern invalidation error for ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * Get cache metrics
   */
  getMetrics(): CacheMetrics & { hitRate: number; uptime: number } {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRate = total > 0 ? (this.metrics.hits / total) * 100 : 0;
    const uptime = Date.now() - this.metrics.lastReset;

    return {
      ...this.metrics,
      hitRate: Math.round(hitRate * 100) / 100,
      uptime,
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      hits: 0,
      misses: 0,
      invalidations: 0,
      warmings: 0,
      errors: 0,
      lastReset: Date.now(),
    };
    this.emit('cache:metrics-reset');
  }

  /**
   * Get cache health status
   */
  async getHealthStatus() {
    const metrics = this.getMetrics();
    const redisConnected = redisService.isConnected();
    
    return {
      healthy: redisConnected && metrics.errors < 10, // Arbitrary error threshold
      redis: redisConnected,
      metrics,
      tagCount: this.tagRegistry.size,
      keyCount: this.keyRegistry.size,
    };
  }

  /**
   * Schedule cache warming for related entries
   */
  private scheduleWarming(tags: string[]) {
    // Implement intelligent warming based on access patterns
    // This is a placeholder for more sophisticated warming logic
    setImmediate(() => {
      this.emit('cache:warm-requested', { tags });
    });
  }

  /**
   * Set up event listeners for monitoring
   */
  private setupEventListeners() {
    this.on('cache:hit', ({ key }) => {
      // Could send to monitoring service
      console.log(`📊 Cache HIT: ${key}`);
    });

    this.on('cache:miss', ({ key }) => {
      console.log(`📊 Cache MISS: ${key}`);
    });

    this.on('cache:invalidate-tag', ({ tag, count }) => {
      console.log(`🗑️ Cache invalidation: ${tag} (${count} keys)`);
    });

    this.on('cache:error', ({ error }) => {
      console.error('❌ Cache error:', error);
    });
  }
}

// Singleton instance
export const cacheManager = CacheManager.getInstance();
