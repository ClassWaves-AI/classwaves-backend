import { cacheManager } from './cache-manager.service';
import { cacheEventBus } from './cache-event-bus.service';
import { redisService } from './redis.service';
import { queryCacheService } from './query-cache.service';

/**
 * Cache Health Monitoring and Alerting System
 * Production-ready monitoring for cache performance and reliability
 */

export interface CacheHealthMetrics {
  overall: 'healthy' | 'degraded' | 'critical';
  redis: {
    connected: boolean;
    latency: number;
    memoryUsage: number;
    keyCount: number;
  };
  cache: {
    hitRate: number;
    errorRate: number;
    avgResponseTime: number;
    totalOperations: number;
  };
  queryCache?: {
    totals: {
      hits: number;
      misses: number;
      totalQueries: number;
      hitRate: number;
      legacyFallbacks: number;
      coalesced: number;
      refreshAhead: number;
      staleServed: number;
    };
    byType: Record<string, any>;
  };
  events: {
    processed: number;
    failed: number;
    avgProcessingTime: number;
  };
  alerts: CacheAlert[];
  timestamp: number;
  uptime: number;
}

export interface CacheAlert {
  id: string;
  level: 'warning' | 'error' | 'critical';
  message: string;
  timestamp: number;
  resolved?: boolean;
  resolvedAt?: number;
}

export interface CacheHealthThresholds {
  hitRate: {
    warning: number; // Below this % is warning
    critical: number; // Below this % is critical
  };
  errorRate: {
    warning: number; // Above this % is warning
    critical: number; // Above this % is critical
  };
  responseTime: {
    warning: number; // Above this ms is warning
    critical: number; // Above this ms is critical
  };
  redis: {
    latency: {
      warning: number; // Above this ms is warning
      critical: number; // Above this ms is critical
    };
    memoryUsage: {
      warning: number; // Above this % is warning
      critical: number; // Above this % is critical
    };
  };
}

/**
 * Default health monitoring thresholds
 */
export const DEFAULT_THRESHOLDS: CacheHealthThresholds = {
  hitRate: {
    warning: 80, // Below 80% hit rate
    critical: 60, // Below 60% hit rate
  },
  errorRate: {
    warning: 1, // Above 1% error rate
    critical: 5, // Above 5% error rate
  },
  responseTime: {
    warning: 100, // Above 100ms average
    critical: 500, // Above 500ms average
  },
  redis: {
    latency: {
      warning: 10, // Above 10ms latency
      critical: 50, // Above 50ms latency
    },
    memoryUsage: {
      warning: 80, // Above 80% memory usage
      critical: 95, // Above 95% memory usage
    },
  },
};

/**
 * Cache Health Monitor
 */
export class CacheHealthMonitor {
  private static instance: CacheHealthMonitor;
  private alerts: CacheAlert[] = [];
  private metrics: any = {};
  private startTime = Date.now();
  private isMonitoring = false;
  private monitoringInterval?: NodeJS.Timeout;
  private thresholds: CacheHealthThresholds;
  
  // Performance tracking
  private operationTimes: number[] = [];
  private maxOperationHistory = 1000;

  private constructor(thresholds: CacheHealthThresholds = DEFAULT_THRESHOLDS) {
    this.thresholds = thresholds;
    this.setupEventListeners();
  }

  static getInstance(thresholds?: CacheHealthThresholds): CacheHealthMonitor {
    if (!CacheHealthMonitor.instance) {
      CacheHealthMonitor.instance = new CacheHealthMonitor(thresholds);
    }
    return CacheHealthMonitor.instance;
  }

  /**
   * Start health monitoring
   */
  startMonitoring(intervalMs: number = 30000): void {
    if (this.isMonitoring) {
      console.log('Cache health monitoring already running');
      return;
    }

    this.isMonitoring = true;
    console.log(`🏥 Starting cache health monitoring (interval: ${intervalMs}ms)`);

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkHealth();
      } catch (error) {
        // Downgrade to warning to avoid noisy logs on transient Redis hiccups
        const msg = error instanceof Error ? error.message : String(error);
        console.warn('Health check degraded:', msg);
      }
    }, intervalMs);

    // Initial health check after a short delay to avoid startup thrash
    setTimeout(() => this.checkHealth().catch(() => undefined), 1500);
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
    this.isMonitoring = false;
    console.log('🏥 Cache health monitoring stopped');
  }

  /**
   * Perform comprehensive health check
   */
  async checkHealth(): Promise<CacheHealthMetrics> {
    const startTime = Date.now();

    try {
      // Get cache manager metrics
      const cacheMetrics = cacheManager.getMetrics();
      
      // Get Redis health
      const redisHealth = await this.checkRedisHealth();
      
      // Get event bus stats
      const eventStats = cacheEventBus.getStats();
      
      // Calculate performance metrics
      const avgResponseTime = this.calculateAverageResponseTime();
      const errorRate = this.calculateErrorRate(cacheMetrics);

      // Query cache metrics
      const qcByType = queryCacheService.getCacheMetrics();
      const qcTotals = Object.values(qcByType).reduce((acc, m: any) => {
        acc.hits += m.hits || 0;
        acc.misses += m.misses || 0;
        acc.totalQueries += m.totalQueries || 0;
        acc.legacyFallbacks += m.legacyFallbacks || 0;
        acc.coalesced += m.coalesced || 0;
        acc.refreshAhead += m.refreshAhead || 0;
        acc.staleServed += m.staleServed || 0;
        return acc;
      }, { hits: 0, misses: 0, totalQueries: 0, legacyFallbacks: 0, coalesced: 0, refreshAhead: 0, staleServed: 0 });
      const qcHitRate = qcTotals.totalQueries > 0 ? (qcTotals.hits / qcTotals.totalQueries) * 100 : 0;

      // Build health report
      const healthMetrics: CacheHealthMetrics = {
        overall: this.determineOverallHealth(cacheMetrics, redisHealth, errorRate),
        redis: redisHealth,
        cache: {
          hitRate: cacheMetrics.hitRate,
          errorRate,
          avgResponseTime,
          totalOperations: cacheMetrics.hits + cacheMetrics.misses,
        },
        queryCache: {
          totals: { ...qcTotals, hitRate: Math.round(qcHitRate * 100) / 100 },
          byType: qcByType,
        },
        events: {
          processed: eventStats.eventCount,
          failed: 0, // TODO: Track failed events
          avgProcessingTime: 0, // TODO: Track processing time
        },
        alerts: this.getActiveAlerts(),
        timestamp: Date.now(),
        uptime: Date.now() - this.startTime,
      };

      // Check for new alerts
      await this.evaluateAlerts(healthMetrics);

      // Store metrics for trend analysis
      this.metrics = healthMetrics;

      return healthMetrics;

    } catch (error) {
      console.error('Health check failed:', error);
      
      // Return degraded health on check failure
      return {
        overall: 'critical',
        redis: { connected: false, latency: -1, memoryUsage: -1, keyCount: -1 },
        cache: { hitRate: 0, errorRate: 100, avgResponseTime: -1, totalOperations: 0 },
        events: { processed: 0, failed: 0, avgProcessingTime: -1 },
        alerts: this.getActiveAlerts(),
        timestamp: Date.now(),
        uptime: Date.now() - this.startTime,
      };
    } finally {
      const duration = Date.now() - startTime;
      this.recordOperationTime(duration);
    }
  }

  /**
   * Check Redis health and performance
   */
  private async checkRedisHealth() {
    const startTime = Date.now();
    
    try {
      // Test Redis connectivity and latency
      const isConnected = redisService.isConnected();
      
      if (!isConnected) {
        return {
          connected: false,
          latency: -1,
          memoryUsage: -1,
          keyCount: -1,
        };
      }

      // Measure latency with ping
      await redisService.ping();
      const latency = Date.now() - startTime;

      // Get Redis info with defensive timeouts to avoid noisy command timeouts
      const client = redisService.getClient();
      const info = await this.safeRedisCall(() => client.info('memory'), 2000);
      const keyCountRaw = await this.safeRedisCall(() => client.dbsize(), 2000);

      // Parse memory usage
      const memoryMatch = typeof info === 'string' ? info.match(/used_memory:(\d+)/) : null;
      const maxMemoryMatch = typeof info === 'string' ? info.match(/maxmemory:(\d+)/) : null;
      
      let memoryUsage = -1;
      if (memoryMatch && maxMemoryMatch) {
        const used = parseInt(memoryMatch[1]);
        const max = parseInt(maxMemoryMatch[1]);
        memoryUsage = max > 0 ? (used / max) * 100 : 0;
      }

      return {
        connected: true,
        latency,
        memoryUsage,
        keyCount: typeof keyCountRaw === 'number' ? keyCountRaw : -1,
      };

    } catch (error) {
      // Reduce noise; report degraded without stack
      const msg = error instanceof Error ? error.message : String(error);
      console.warn('Redis health check degraded:', msg);
      return {
        connected: false,
        latency: -1,
        memoryUsage: -1,
        keyCount: -1,
      };
    }
  }

  // Helper to wrap Redis calls with a soft timeout and error suppression
  private async safeRedisCall<T>(fn: () => Promise<T>, timeoutMs: number = 2000): Promise<T | null> {
    try {
      const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
      const guarded = fn().catch(() => null as unknown as T);
      const result = await Promise.race([guarded, timeout]);
      // If timed out, return null; underlying promise may still reject later, but we won't await it
      return (result === null ? null : (result as T));
    } catch {
      return null;
    }
  }

  /**
   * Determine overall health status
   */
  private determineOverallHealth(
    cacheMetrics: any,
    redisHealth: any,
    errorRate: number
  ): 'healthy' | 'degraded' | 'critical' {
    // Critical conditions
    if (!redisHealth.connected) return 'critical';
    if (cacheMetrics.hitRate < this.thresholds.hitRate.critical) return 'critical';
    if (errorRate > this.thresholds.errorRate.critical) return 'critical';
    if (redisHealth.latency > this.thresholds.redis.latency.critical) return 'critical';

    // Warning conditions (degraded)
    if (cacheMetrics.hitRate < this.thresholds.hitRate.warning) return 'degraded';
    if (errorRate > this.thresholds.errorRate.warning) return 'degraded';
    if (redisHealth.latency > this.thresholds.redis.latency.warning) return 'degraded';
    if (redisHealth.memoryUsage > this.thresholds.redis.memoryUsage.warning) return 'degraded';

    return 'healthy';
  }

  /**
   * Calculate error rate from cache metrics
   */
  private calculateErrorRate(metrics: any): number {
    const total = metrics.hits + metrics.misses + metrics.errors;
    return total > 0 ? (metrics.errors / total) * 100 : 0;
  }

  /**
   * Calculate average response time
   */
  private calculateAverageResponseTime(): number {
    if (this.operationTimes.length === 0) return 0;
    
    const sum = this.operationTimes.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.operationTimes.length);
  }

  /**
   * Record operation time for performance tracking
   */
  private recordOperationTime(time: number): void {
    this.operationTimes.push(time);
    
    // Keep only recent operations
    if (this.operationTimes.length > this.maxOperationHistory) {
      this.operationTimes.shift();
    }
  }

  /**
   * Evaluate and create alerts based on metrics
   */
  private async evaluateAlerts(metrics: CacheHealthMetrics): Promise<void> {
    const newAlerts: CacheAlert[] = [];

    // Redis connectivity alert
    if (!metrics.redis.connected) {
      newAlerts.push(this.createAlert(
        'redis-disconnected',
        'critical',
        'Redis connection lost - cache functionality disabled'
      ));
    }

    // Hit rate alerts
    if (metrics.cache.hitRate < this.thresholds.hitRate.critical) {
      newAlerts.push(this.createAlert(
        'cache-hit-rate-critical',
        'critical',
        `Cache hit rate critically low: ${metrics.cache.hitRate.toFixed(1)}%`
      ));
    } else if (metrics.cache.hitRate < this.thresholds.hitRate.warning) {
      newAlerts.push(this.createAlert(
        'cache-hit-rate-low',
        'warning',
        `Cache hit rate below threshold: ${metrics.cache.hitRate.toFixed(1)}%`
      ));
    }

    // Error rate alerts
    if (metrics.cache.errorRate > this.thresholds.errorRate.critical) {
      newAlerts.push(this.createAlert(
        'cache-error-rate-high',
        'critical',
        `Cache error rate critically high: ${metrics.cache.errorRate.toFixed(1)}%`
      ));
    } else if (metrics.cache.errorRate > this.thresholds.errorRate.warning) {
      newAlerts.push(this.createAlert(
        'cache-error-rate-elevated',
        'warning',
        `Cache error rate elevated: ${metrics.cache.errorRate.toFixed(1)}%`
      ));
    }

    // Redis latency alerts
    if (metrics.redis.latency > this.thresholds.redis.latency.critical) {
      newAlerts.push(this.createAlert(
        'redis-latency-high',
        'critical',
        `Redis latency critically high: ${metrics.redis.latency}ms`
      ));
    } else if (metrics.redis.latency > this.thresholds.redis.latency.warning) {
      newAlerts.push(this.createAlert(
        'redis-latency-elevated',
        'warning',
        `Redis latency elevated: ${metrics.redis.latency}ms`
      ));
    }

    // Memory usage alerts
    if (metrics.redis.memoryUsage > this.thresholds.redis.memoryUsage.critical) {
      newAlerts.push(this.createAlert(
        'redis-memory-critical',
        'critical',
        `Redis memory usage critically high: ${metrics.redis.memoryUsage.toFixed(1)}%`
      ));
    } else if (metrics.redis.memoryUsage > this.thresholds.redis.memoryUsage.warning) {
      newAlerts.push(this.createAlert(
        'redis-memory-high',
        'warning',
        `Redis memory usage high: ${metrics.redis.memoryUsage.toFixed(1)}%`
      ));
    }

    // Add new alerts and auto-resolve old ones
    for (const alert of newAlerts) {
      this.addAlert(alert);
    }

    // Auto-resolve alerts that are no longer applicable
    this.autoResolveAlerts(metrics);
  }

  /**
   * Create alert object
   */
  private createAlert(id: string, level: 'warning' | 'error' | 'critical', message: string): CacheAlert {
    return {
      id,
      level,
      message,
      timestamp: Date.now(),
      resolved: false,
    };
  }

  /**
   * Add alert (avoiding duplicates)
   */
  private addAlert(alert: CacheAlert): void {
    const existing = this.alerts.find(a => a.id === alert.id && !a.resolved);
    if (!existing) {
      this.alerts.push(alert);
      console.warn(`🚨 CACHE ALERT [${alert.level.toUpperCase()}]: ${alert.message}`);
    }
  }

  /**
   * Auto-resolve alerts based on current metrics
   */
  private autoResolveAlerts(metrics: CacheHealthMetrics): void {
    const now = Date.now();
    
    for (const alert of this.alerts) {
      if (alert.resolved) continue;

      let shouldResolve = false;

      switch (alert.id) {
        case 'redis-disconnected':
          shouldResolve = metrics.redis.connected;
          break;
        case 'cache-hit-rate-critical':
        case 'cache-hit-rate-low':
          shouldResolve = metrics.cache.hitRate >= this.thresholds.hitRate.warning;
          break;
        case 'cache-error-rate-high':
        case 'cache-error-rate-elevated':
          shouldResolve = metrics.cache.errorRate <= this.thresholds.errorRate.warning;
          break;
        case 'redis-latency-high':
        case 'redis-latency-elevated':
          shouldResolve = metrics.redis.latency <= this.thresholds.redis.latency.warning;
          break;
        case 'redis-memory-critical':
        case 'redis-memory-high':
          shouldResolve = metrics.redis.memoryUsage <= this.thresholds.redis.memoryUsage.warning;
          break;
      }

      if (shouldResolve) {
        alert.resolved = true;
        alert.resolvedAt = now;
        console.log(`✅ CACHE ALERT RESOLVED: ${alert.message}`);
      }
    }
  }

  /**
   * Get active (unresolved) alerts
   */
  private getActiveAlerts(): CacheAlert[] {
    return this.alerts.filter(a => !a.resolved);
  }

  /**
   * Set up event listeners for monitoring
   */
  private setupEventListeners(): void {
    // Listen to cache manager events
    cacheManager.on('cache:error', () => {
      // Track cache errors
    });

    // Listen to cache event bus
    cacheEventBus.on('error', (error: Error) => {
      console.error('Cache event bus error:', error);
    });
  }

  /**
   * Get current health status (cached)
   */
  getCurrentHealth(): CacheHealthMetrics | null {
    return this.metrics;
  }

  /**
   * Force health check
   */
  async forceHealthCheck(): Promise<CacheHealthMetrics> {
    return await this.checkHealth();
  }

  /**
   * Clear all alerts
   */
  clearAlerts(): void {
    this.alerts = [];
    console.log('🧹 Cache alerts cleared');
  }

  /**
   * Update monitoring thresholds
   */
  updateThresholds(thresholds: Partial<CacheHealthThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
    console.log('📊 Cache monitoring thresholds updated');
  }
}

// Singleton instance
export const cacheHealthMonitor = CacheHealthMonitor.getInstance();
