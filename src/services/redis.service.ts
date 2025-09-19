import Redis from 'ioredis';
import { LRUCache } from 'lru-cache';
import { Teacher, School } from '../types/auth.types';
import { createGuidanceRedisScriptRunner, GuidanceRedisScriptRunner } from '../redis-scripts';
import { logger } from '../utils/logger';

interface SessionData {
  teacherId: string;
  teacher: Teacher;
  school: School;
  sessionId: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

interface CacheEntry {
  data: SessionData;
  timestamp: number;
  ttl: number;
}

/**
 * RedisService - High-performance Redis service with in-memory LRU cache
 * 
 * Features:
 * - In-memory LRU cache for frequently accessed sessions
 * - Redis connection pooling for better performance
 * - Cache warming on successful authentication
 * - Cache invalidation on logout
 * - Circuit breaker pattern for Redis failures
 */
class RedisService {
  private client: Redis;
  private connected: boolean = false;
  private cache: LRUCache<string, CacheEntry>;
  private readonly CACHE_TTL = 300000; // 5 minutes in milliseconds
  private readonly CACHE_CHECK_INTERVAL = 60000; // 1 minute cleanup interval
  private cleanupInterval: NodeJS.Timeout | null = null;
  private clientConfig: any;
  private readonly useMock: boolean = process.env.REDIS_USE_MOCK === '1';
  private guidanceScripts?: GuidanceRedisScriptRunner;

  // Lightweight in-memory Redis mock for tests/local when REDIS_USE_MOCK=1
  private createInMemoryRedisMock(): any {
    type KV = Map<string, { value: string; expireAt?: number }>;
    const kv: KV = new Map();
    const sets = new Map<string, Set<string>>();
    const hashes = new Map<string, Map<string, string>>();
    const now = () => Date.now();
    const isExpired = (k: string) => {
      const e = kv.get(k);
      return !!(e && e.expireAt && e.expireAt <= now());
    };
    const ensureAlive = (k: string) => { if (isExpired(k)) kv.delete(k); };
    const wildcardToRegex = (pattern: string) => new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

    const client: any = {
      status: 'ready',
      async get(key: string) { ensureAlive(key); return kv.get(key)?.value ?? null; },
      async set(key: string, ...args: any[]) {
        const value = String(args[0] ?? '');
        let nx = false; let px: number | undefined; let ex: number | undefined;
        if (typeof args[1] === 'string') {
          const opts = args.slice(1);
          for (let i = 0; i < opts.length; i++) {
            const t = String(opts[i]).toUpperCase();
            if (t === 'NX') nx = true;
            if (t === 'PX') { px = Number(opts[i + 1]); i++; }
            if (t === 'EX') { ex = Number(opts[i + 1]); i++; }
          }
        } else if (typeof args[1] === 'object' && args[1] != null) {
          nx = !!args[1].NX; px = args[1].PX != null ? Number(args[1].PX) : undefined; ex = args[1].EX != null ? Number(args[1].EX) : undefined;
        }
        ensureAlive(key);
        if (nx && kv.has(key)) return null;
        const entry: { value: string; expireAt?: number } = { value };
        const ttlMs = px ?? (ex != null ? ex * 1000 : undefined);
        if (ttlMs && Number.isFinite(ttlMs)) entry.expireAt = now() + Number(ttlMs);
        kv.set(key, entry);
        return 'OK';
      },
      async setex(key: string, ttlSeconds: number, value: string) { kv.set(key, { value, expireAt: now() + ttlSeconds * 1000 }); return 'OK'; },
      async del(key: string) { const had = kv.delete(key) || sets.delete(key) || hashes.delete(key); return had ? 1 : 0; },
      async exists(key: string) { ensureAlive(key); return kv.has(key) ? 1 : 0; },
      async expire(key: string, seconds: number) { const e = kv.get(key); if (!e) return 0; e.expireAt = now() + seconds * 1000; return 1; },
      async pexpire(key: string, milliseconds: number) { const e = kv.get(key); if (!e) return 0; e.expireAt = now() + Number(milliseconds); return 1; },
      async ttl(key: string) { const e = kv.get(key); if (!e || !e.expireAt) return -1; const t = Math.ceil((e.expireAt - now()) / 1000); return t < 0 ? -2 : t; },
      async incrby(key: string, by: number) { ensureAlive(key); const v = Number(kv.get(key)?.value ?? '0') + by; kv.set(key, { value: String(v) }); return v; },
      async incr(key: string) { return client.incrby(key, 1); },
      async decr(key: string) { return client.incrby(key, -1); },
      async incrbyfloat(key: string, by: number) { ensureAlive(key); const v = Number(kv.get(key)?.value ?? '0') + by; kv.set(key, { value: String(v) }); return v; },
      async keys(pattern: string) { const rx = wildcardToRegex(pattern); const keys = new Set<string>([...kv.keys(), ...sets.keys(), ...hashes.keys()]); return Array.from(keys).filter(k => { ensureAlive(k); return rx.test(k); }); },
      async scan(cursor: string | number, ...args: any[]) {
        // Minimal SCAN implementation: returns all matching keys in one page
        let match = '*';
        for (let i = 0; i < args.length; i++) {
          const t = String(args[i]).toUpperCase();
          if (t === 'MATCH' && args[i + 1]) { match = String(args[i + 1]); i++; }
        }
        const rx = wildcardToRegex(match);
        const keys = new Set<string>([...kv.keys(), ...sets.keys(), ...hashes.keys()]);
        const matched = Array.from(keys).filter(k => { ensureAlive(k); return rx.test(k); });
        return ['0', matched];
      },
      async ping() { return 'PONG'; },
      // Sets
      async sadd(key: string, member: string) { if (!sets.has(key)) sets.set(key, new Set()); const s = sets.get(key)!; const had = s.has(member); s.add(member); return had ? 0 : 1; },
      async srem(key: string, member: string) { const s = sets.get(key); if (!s) return 0; const had = s.delete(member); return had ? 1 : 0; },
      async smembers(key: string) { return Array.from(sets.get(key) ?? []); },
      async sismember(key: string, member: string) { return sets.get(key)?.has(member) ? 1 : 0; },
      // Hashes
      async hset(key: string, field: string, value: string) { if (!hashes.has(key)) hashes.set(key, new Map()); hashes.get(key)!.set(field, value); return 1; },
      async hget(key: string, field: string) { return hashes.get(key)?.get(field) ?? null; },
      async hdel(key: string, field: string) { const h = hashes.get(key); if (!h) return 0; const had = h.delete(field); return had ? 1 : 0; },
      async hgetall(key: string) { const h = hashes.get(key) ?? new Map(); const obj: any = {}; h.forEach((v, k) => obj[k] = v); return obj; },
      pipeline() { return { exec: async () => [] }; },
      multi() { return { exec: async () => [] }; },
      async call(cmd: string, ...args: any[]) { if (String(cmd).toUpperCase() === 'SET') { const [key, value, ...rest] = args; return client.set(key, value, ...rest); } return 'OK'; },
      async quit() { client.status = 'end'; return 'OK'; },
      on(_e: string, _cb: (...a: any[]) => void) { /* no-op for mock */ },
    };
    return client;
  }

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisPassword = process.env.REDIS_PASSWORD || 'classwaves-redis-pass';
    const poolSize = parseInt(process.env.REDIS_POOL_SIZE || '5', 10);
    
    // Initialize LRU cache with optimized settings
    this.cache = new LRUCache<string, CacheEntry>({
      max: 1000, // Store up to 1000 sessions in memory
      ttl: this.CACHE_TTL,
      updateAgeOnGet: true, // Reset TTL on access
      allowStale: false,
    });

    // Parse Redis URL for connection pool configuration
    let redisConfig: any = {};
    
    try {
      if (redisUrl.startsWith('redis://')) {
        const url = new URL(redisUrl);
        redisConfig = {
          host: url.hostname,
          port: parseInt(url.port || '6379', 10),
          password: url.password || redisPassword,
          // Connection pool settings
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
          connectTimeout: parseInt(process.env.REDIS_TIMEOUT || '5000', 10),
          commandTimeout: parseInt(process.env.REDIS_TIMEOUT || '5000', 10),
          retryStrategy: (times: number) => {
            const delay = Math.min(times * 50, 2000);
            if (times > 10) {
              logger.error('Redis connection failed after 10 retries');
              return null;
            }
            return delay;
          },
          reconnectOnError: (err: Error) => {
            const targetError = 'READONLY';
            if (err.message.includes(targetError)) {
              return true;
            }
            return false;
          },
          // Pool-specific settings
          maxLoadingTimeout: 5000,
          enableAutoPipelining: true,
          keepAlive: 30000,
        };
      }
    } catch (error) {
      logger.error('Error parsing Redis URL, using defaults:', error);
      redisConfig = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
        connectTimeout: 5000,
        commandTimeout: 5000,
      };
    }
    
    // In tests, avoid establishing connections until actually used
    if (process.env.NODE_ENV === 'test') {
      redisConfig.lazyConnect = true;
      redisConfig.enableReadyCheck = false;
      // Reduce side effects in tests
      redisConfig.autoResubscribe = false;
      redisConfig.autoResendUnfulfilledCommands = false;
      redisConfig.maxRetriesPerRequest = 0;
    }
    this.clientConfig = redisConfig;
    if (this.useMock) {
      this.client = this.createInMemoryRedisMock() as unknown as Redis;
      this.connected = true;
    } else {
      this.client = new Redis(this.clientConfig);
      this.setupEventHandlers();
    }

    // Start cache cleanup interval
    this.startCacheCleanup();
  }

  private setupEventHandlers(): void {
    // Socket connected; authentication/ready may still be pending
    this.client.on('connect', () => {
      logger.debug('🔌 RedisService socket connected');
    });

    // Mark service ready only when Redis is fully ready (post-auth, post-handshake)
    this.client.on('ready', () => {
      this.connected = true;
      logger.debug('✅ RedisService ready');
    });

    this.client.on('error', (err: any) => {
      this.connected = false;
      logger.error('❌ RedisService error:', err);
    });

    this.client.on('close', () => {
      this.connected = false;
      logger.debug('🔌 RedisService connection closed');
    });
  }

  /**
   * Start periodic cache cleanup to remove expired entries
   */
  private startCacheCleanup(): void {
    const isJest = !!process.env.JEST_WORKER_ID;
    if (process.env.NODE_ENV === 'test' || isJest) {
      return; // avoid timers in tests
    }
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];
      
      this.cache.forEach((entry: CacheEntry, key: string) => {
        if (now - entry.timestamp > entry.ttl) {
          keysToDelete.push(key);
        }
      });
      
      keysToDelete.forEach(key => this.cache.delete(key));
      
      if (keysToDelete.length > 0) {
        logger.debug(`🧹 Cleaned up ${keysToDelete.length} expired cache entries`);
      }
    }, this.CACHE_CHECK_INTERVAL);
    (this.cleanupInterval as any).unref?.();
  }

  /**
   * Stop cache cleanup interval
   */
  private stopCacheCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  isConnected(): boolean {
    // Ensure the underlying client reports ready state
    const status = (this.client as any)?.status;
    return this.connected && status === 'ready';
  }

  /**
   * Optimized session storage with cache warming
   */
  async storeSession(sessionId: string, data: SessionData, expiresIn: number = 3600): Promise<void> {
    const key = `session:${sessionId}`;
    const serializedData = JSON.stringify({
      ...data,
      createdAt: data.createdAt.toISOString(),
      expiresAt: data.expiresAt.toISOString()
    });
    
    // Store in Redis
    await this.client.setex(key, expiresIn, serializedData);
    
    // Warm cache with new session
    this.warmCache(sessionId, data, expiresIn * 1000);
    
    logger.debug(`🔥 Cache warmed for session: ${sessionId}`);
  }

  /**
   * Get session - direct Redis read (bypasses cache) for test determinism
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    const key = `session:${sessionId}`;
    try {
      const data = await this.client.get(key);
      if (!data) return null;
      const parsed = JSON.parse(data);
      const sessionData: SessionData = {
        ...parsed,
        createdAt: new Date(parsed.createdAt),
        expiresAt: new Date(parsed.expiresAt)
      };
      // Optionally warm cache for subsequent requests
      const ttl = sessionData.expiresAt.getTime() - Date.now();
      if (ttl > 0) this.warmCache(sessionId, sessionData, ttl);
      return sessionData;
    } catch (error) {
      if (error instanceof SyntaxError) throw error; // invalid JSON should reject in tests
      logger.warn(`⚠️  Redis getSession error for key: ${key}`, error);
      return null;
    }
  }

  /**
   * Optimized session retrieval with LRU cache
   */
  async getSessionOptimized(sessionId: string): Promise<SessionData | null> {
    const cacheStart = performance.now();
    
    // Check cache first
    const cacheKey = `session:${sessionId}`;
    const cachedEntry = this.cache.get(cacheKey);
    
    if (cachedEntry) {
      logger.debug(`⚡ Cache hit for session: ${sessionId} (${(performance.now() - cacheStart).toFixed(2)}ms)`);
      return cachedEntry.data;
    }
    
    // Cache miss - fetch from Redis
    logger.debug(`💾 Cache miss for session: ${sessionId}, fetching from Redis`);
    const redisStart = performance.now();
    
    try {
      const redisKey = `session:${sessionId}`;
      
      // Add timeout to prevent Redis hanging; handle late rejection to avoid unhandled noise
      const getPromise = this.client.get(redisKey).catch(() => null);
      const timeoutPromise = new Promise<'timeout'>(resolve => 
        setTimeout(() => resolve('timeout'), parseInt(process.env.REDIS_TIMEOUT || '5000', 10))
      );
      
      const raced = await Promise.race([getPromise as any, timeoutPromise]);
      const data = raced === 'timeout' ? null : (raced as string | null);
      
      if (!data) {
        logger.debug(`❌ Session not found in Redis: ${sessionId}`);
        return null;
      }
      
      const parsedData = JSON.parse(data);
      const sessionData: SessionData = {
        ...parsedData,
        createdAt: new Date(parsedData.createdAt),
        expiresAt: new Date(parsedData.expiresAt)
      };
      
      // Cache the result for future requests
      const ttl = sessionData.expiresAt.getTime() - Date.now();
      if (ttl > 0) {
        this.warmCache(sessionId, sessionData, ttl);
      }
      
      logger.debug(`📡 Redis fetch completed: ${sessionId} (${(performance.now() - redisStart).toFixed(2)}ms)`);
      return sessionData;
      
    } catch (error) {
      // Invalid JSON should throw (unit test expectation)
      if (error instanceof SyntaxError) {
        throw error;
      }
      logger.warn(`⚠️  Redis getSession timeout or error for key: ${sessionId}`, error);
      return null; // Return null to trigger session expiry flow
    }
  }

  /**
   * Warm cache with session data
   */
  private warmCache(sessionId: string, data: SessionData, ttl: number): void {
    const cacheKey = `session:${sessionId}`;
    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      ttl,
    };
    
    this.cache.set(cacheKey, entry);
  }

  /**
   * Delete session with cache invalidation
   */
  async deleteSession(sessionId: string): Promise<void> {
    const key = `session:${sessionId}`;
    
    // Remove from Redis
    await this.client.del(key);
    
    // Invalidate cache
    this.cache.delete(key);
    
    logger.debug(`🗑️  Session deleted and cache invalidated: ${sessionId}`);
  }

  /**
   * Extend session with cache update
   */
  async extendSession(sessionId: string, expiresIn: number = 3600): Promise<boolean> {
    const key = `session:${sessionId}`;
    const result = await this.client.expire(key, expiresIn);
    
    // Update cache TTL if session exists in cache
    const cacheKey = `session:${sessionId}`;
    const cachedEntry = this.cache.peek(cacheKey); // Don't update LRU order
    if (cachedEntry) {
      cachedEntry.ttl = expiresIn * 1000;
      cachedEntry.timestamp = Date.now();
      this.cache.set(cacheKey, cachedEntry);
    }
    
    return result === 1;
  }

  /**
   * Get teacher active sessions (cache-aware)
   */
  async getTeacherActiveSessions(teacherId: string): Promise<string[]> {
    const pattern = 'session:*';
    const keys = await this.scanKeys(pattern);
    const activeSessions: string[] = [];
    
    for (const key of keys) {
      // Try cache first
      const sessionId = key.replace('session:', '');
      const cachedEntry = this.cache.peek(sessionId);
      
      if (cachedEntry && cachedEntry.data.teacherId === teacherId) {
        activeSessions.push(cachedEntry.data.sessionId);
        continue;
      }
      
      // Fallback to Redis
      const data = await this.client.get(key);
      if (data) {
        const session = JSON.parse(data) as SessionData;
        if (session.teacherId === teacherId) {
          activeSessions.push(session.sessionId);
        }
      }
    }
    
    return activeSessions;
  }

  /**
   * SCAN utility to retrieve all keys matching a pattern without blocking Redis.
   */
  private async scanKeys(pattern: string, count: number = 1000): Promise<string[]> {
    const out: string[] = [];
    let cursor: string = '0';
    do {
      // @ts-ignore ioredis scan signature
      const [nextCursor, batch]: [string, string[]] = await (this.client as any).scan(cursor, 'MATCH', pattern, 'COUNT', count);
      if (Array.isArray(batch) && batch.length) out.push(...batch);
      cursor = nextCursor;
    } while (cursor !== '0');
    return out;
  }

  /**
   * Store refresh token (no cache needed for refresh tokens)
   */
  async storeRefreshToken(tokenId: string, teacherId: string, expiresIn: number = 2592000): Promise<void> {
    const key = `refresh:${tokenId}`;
    const data = {
      teacherId,
      createdAt: new Date().toISOString()
    };
    
    await this.client.setex(key, expiresIn, JSON.stringify(data));
  }

  /**
   * Get refresh token (no cache needed for refresh tokens)
   */
  async getRefreshToken(tokenId: string): Promise<{ teacherId: string; createdAt: string } | null> {
    const key = `refresh:${tokenId}`;
    const data = await this.client.get(key);
    
    if (!data) {
      return null;
    }
    
    return JSON.parse(data);
  }

  /**
   * Delete refresh token
   */
  async deleteRefreshToken(tokenId: string): Promise<void> {
    const key = `refresh:${tokenId}`;
    await this.client.del(key);
  }

  /**
   * Invalidate all teacher sessions with cache cleanup
   */
  async invalidateAllTeacherSessions(teacherId: string): Promise<void> {
    const sessions = await this.getTeacherActiveSessions(teacherId);
    
    for (const sessionId of sessions) {
      await this.deleteSession(sessionId);
    }
    
    logger.debug(`🧹 Invalidated ${sessions.length} sessions for teacher: ${teacherId}`);
  }

  /**
   * Ping Redis
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis ping failed:', error);
      return false;
    }
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    this.stopCacheCleanup();
    this.cache.clear();
    
    if (this.client && (this.client as any).status !== 'end') {
      try {
        await (this.client as any).quit?.();
        logger.debug('✅ RedisService disconnected cleanly');
      } catch (error) {
        // Connection already closed, ignore the error
        logger.debug('ℹ️  Redis connection already closed during disconnect');
      }
    }
  }

  /**
   * Wait for connection
   */
  async waitForConnection(timeout: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (this.connected && this.client.status === 'ready') {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  /**
   * Get Redis client for advanced operations
   */
  getClient(): Redis {
    // Auto-recreate client if previously disconnected (helps suite-level teardown in tests)
    if (!this.client || (this.client as any).status === 'end' || (this.client as any).status === 'close') {
      if (this.useMock) {
        this.client = this.createInMemoryRedisMock() as unknown as Redis;
        this.connected = true;
      } else {
        this.client = new Redis(this.clientConfig || {});
        this.setupEventHandlers();
      }
    }
    return this.client;
  }

  getGuidanceScripts(): GuidanceRedisScriptRunner {
    if (!this.guidanceScripts) {
      this.guidanceScripts = createGuidanceRedisScriptRunner(this.getClient());
    }
    return this.guidanceScripts;
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; max: number; hitRate: string } {
    const calculatedLength = this.cache.calculatedSize || this.cache.size;
    return {
      size: calculatedLength,
      max: this.cache.max,
      hitRate: 'N/A', // LRU cache doesn't provide hit rate by default
    };
  }

  /**
   * Clear cache (for testing/debugging)
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('🧹 Cache cleared');
  }
}

// Singleton instance
let redisServiceInstance: RedisService | null = null;

export const getRedisService = (): RedisService => {
  if (!redisServiceInstance) {
    redisServiceInstance = new RedisService();
  }
  return redisServiceInstance;
};

// Export service interface - maintains backward compatibility
export const redisService = {
  isConnected: () => getRedisService().isConnected(),
  storeSession: (sessionId: string, data: SessionData, expiresIn?: number) => 
    getRedisService().storeSession(sessionId, data, expiresIn),
  getSession: (sessionId: string) => getRedisService().getSession(sessionId),
  deleteSession: (sessionId: string) => getRedisService().deleteSession(sessionId),
  extendSession: (sessionId: string, expiresIn?: number) => 
    getRedisService().extendSession(sessionId, expiresIn),
  getTeacherActiveSessions: (teacherId: string) => 
    getRedisService().getTeacherActiveSessions(teacherId),
  storeRefreshToken: (tokenId: string, teacherId: string, expiresIn?: number) => 
    getRedisService().storeRefreshToken(tokenId, teacherId, expiresIn),
  getRefreshToken: (tokenId: string) => getRedisService().getRefreshToken(tokenId),
  deleteRefreshToken: (tokenId: string) => getRedisService().deleteRefreshToken(tokenId),
  invalidateAllTeacherSessions: (teacherId: string) => 
    getRedisService().invalidateAllTeacherSessions(teacherId),
  ping: () => getRedisService().ping(),
  disconnect: () => getRedisService().disconnect(),
  waitForConnection: (timeout?: number) => getRedisService().waitForConnection(timeout),
  getClient: () => getRedisService().getClient(),
  getGuidanceScripts: () => getRedisService().getGuidanceScripts(),
  
  // New optimized methods
  getSessionOptimized: (sessionId: string) => getRedisService().getSessionOptimized(sessionId),
  getCacheStats: () => getRedisService().getCacheStats(),
  clearCache: () => getRedisService().clearCache(),
  
  // Thin helpers used by some unit tests
  async get(key: string): Promise<string | null> {
    return getRedisService().getClient().get(key);
  },
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = getRedisService().getClient();
    if (ttlSeconds && ttlSeconds > 0) {
      await client.setex(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
  },
  
  // Advanced SET operation with options (for distributed locking)
  async setWithOptions(key: string, value: string, ttlSeconds: number, mode: 'NX' | 'XX' = 'NX'): Promise<string | null> {
    const client = getRedisService().getClient();
    // Use Redis command with proper argument order for ioredis
    const args = [key, value, 'EX', ttlSeconds, mode];
    const result = await (client as any).call('SET', ...args);
    return result;
  },
  
  // Additional Redis methods for advanced use cases
  async del(key: string): Promise<number> {
    return getRedisService().getClient().del(key);
  },
  
  async ttl(key: string): Promise<number> {
    return getRedisService().getClient().ttl(key);
  },
  
  async expire(key: string, seconds: number): Promise<number> {
    return getRedisService().getClient().expire(key, seconds);
  },
  
  async keys(pattern: string): Promise<string[]> {
    // Prefer scan-based retrieval to avoid blocking
    const svc = getRedisService();
    // @ts-ignore access private method in same module
    if ((svc as any).scanKeys) return (svc as any).scanKeys(pattern);
    return svc.getClient().keys(pattern);
  }
};