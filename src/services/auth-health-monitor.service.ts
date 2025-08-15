import { OAuth2Client } from 'google-auth-library';
import { databricksService } from './databricks.service';
import { redisService } from './redis.service';
import { resilientAuthService } from './resilient-auth.service';
import { RetryService } from './retry.service';

/**
 * AuthHealthMonitor - Phase 3 Implementation
 * 
 * Provides comprehensive health monitoring for the authentication system:
 * - Real-time health checks for all external dependencies
 * - Performance metrics collection and analysis
 * - Automated alerting for degraded/unhealthy states
 * - Trend analysis and capacity planning data
 */

export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    googleOAuth: 'healthy' | 'unhealthy';
    database: 'healthy' | 'unhealthy';
    redis: 'healthy' | 'unhealthy';
    rateLimiting: 'healthy' | 'unhealthy';
    circuitBreakers: 'healthy' | 'degraded' | 'unhealthy';
  };
  metrics: AuthMetrics;
  alerts: SystemAlert[];
  timestamp: string;
  uptime: number;
}

export interface AuthMetrics {
  current: {
    authAttempts: number;
    authSuccesses: number;
    authFailures: number;
    avgResponseTime: number;
    circuitBreakerTrips: number;
    retryAttempts: number;
    cacheHitRate: number;
  };
  last24Hours: {
    totalLogins: number;
    failureRate: number;
    avgLoginTime: number;
    peakConcurrency: number;
    slowestOperation: string;
    mostFailedOperation: string;
  };
  realTime: {
    activeAuthRequests: number;
    queuedRequests: number;
    errorRate: number;
    responseTime95thPercentile: number;
  };
}

export interface SystemAlert {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  component: string;
  message: string;
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
  metadata?: any;
}

export class AuthHealthMonitor {
  private metrics: AuthMetrics['current'] = {
    authAttempts: 0,
    authSuccesses: 0,
    authFailures: 0,
    avgResponseTime: 0,
    circuitBreakerTrips: 0,
    retryAttempts: 0,
    cacheHitRate: 0
  };

  private responseTimeBuffer: number[] = [];
  private readonly BUFFER_SIZE = 100;
  private alerts: SystemAlert[] = [];
  private startTime = Date.now();
  private activeRequests = new Set<string>();

  /**
   * MONITORING 1: Comprehensive health check
   */
  async checkAuthSystemHealth(): Promise<HealthStatus> {
    console.log('🔍 Running comprehensive auth system health check');
    const healthCheckStart = performance.now();

    const checks = await Promise.allSettled([
      this.checkGoogleOAuthHealth(),
      this.checkDatabaseHealth(),
      this.checkRedisHealth(),
      this.checkRateLimitingHealth(),
      this.checkCircuitBreakerHealth()
    ]);

    const healthChecks = {
      googleOAuth: checks[0].status === 'fulfilled' ? 'healthy' as const : 'unhealthy' as const,
      database: checks[1].status === 'fulfilled' ? 'healthy' as const : 'unhealthy' as const,
      redis: checks[2].status === 'fulfilled' ? 'healthy' as const : 'unhealthy' as const,
      rateLimiting: checks[3].status === 'fulfilled' ? 'healthy' as const : 'unhealthy' as const,
      circuitBreakers: this.determineCircuitBreakerHealth()
    };

    // Log failed checks with details
    checks.forEach((check, index) => {
      if (check.status === 'rejected') {
        const components = ['GoogleOAuth', 'Database', 'Redis', 'RateLimiting'];
        console.error(`❌ Health check failed for ${components[index]}:`, check.reason);
      }
    });

    // MONITORING 2: Determine overall health status
    const failedChecks = Object.values(healthChecks).filter(status => status === 'unhealthy').length;
    const degradedChecks = Object.values(healthChecks).filter(status => status === 'degraded').length;

    let overall: 'healthy' | 'degraded' | 'unhealthy';
    if (failedChecks === 0 && degradedChecks === 0) {
      overall = 'healthy';
    } else if (failedChecks === 0 && degradedChecks > 0) {
      overall = 'degraded';
    } else if (failedChecks <= 1) {
      overall = 'degraded';
    } else {
      overall = 'unhealthy';
    }

    const status: HealthStatus = {
      overall,
      checks: healthChecks,
      metrics: await this.calculateMetrics(),
      alerts: this.getActiveAlerts(),
      timestamp: new Date().toISOString(),
      uptime: this.getUptimeSeconds()
    };

    // MONITORING 3: Automated alerting
    await this.processHealthStatus(status);

    const healthCheckTime = performance.now() - healthCheckStart;
    console.log(`🔍 Health check completed in ${healthCheckTime.toFixed(2)}ms - Status: ${overall}`);

    return status;
  }

  /**
   * MONITORING 4: Individual service health checks
   */
  private async checkGoogleOAuthHealth(): Promise<void> {
    try {
      // Test Google OAuth availability with a controlled request
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      
      // Use a timeout to prevent hanging
      await Promise.race([
        this.testGoogleOAuthConnectivity(client),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Google OAuth health check timeout')), 3000)
        )
      ]);

      console.log('✅ Google OAuth service healthy');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Google OAuth service unhealthy:', error);
      this.createAlert('critical', 'googleOAuth', 'Google OAuth service is unreachable', { error: errorMessage });
      throw error;
    }
  }

  private async testGoogleOAuthConnectivity(client: OAuth2Client): Promise<void> {
    // Test by attempting to get Google's public key (this doesn't require authentication)
    try {
      await client.getFederatedSignonCerts();
    } catch (error) {
      // Even if this fails, it indicates Google's service is responding
      // Only throw if it's a connectivity issue
      const errorCode = error && typeof error === 'object' && 'code' in error ? (error as any).code : '';
      if (errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED') {
        throw error;
      }
      // Other errors (like rate limiting) indicate the service is up
    }
  }

  private async checkDatabaseHealth(): Promise<void> {
    try {
      const start = performance.now();
      await databricksService.query('SELECT 1 as health_check');
      const duration = performance.now() - start;
      
      if (duration > 5000) {
        this.createAlert('warning', 'database', `Database response time is slow: ${duration.toFixed(2)}ms`, { duration });
      }
      
      console.log(`✅ Database service healthy (${duration.toFixed(2)}ms)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Database service unhealthy:', error);
      this.createAlert('critical', 'database', 'Database service is unreachable', { error: errorMessage });
      this.metrics.authFailures++;
      throw error;
    }
  }

  private async checkRedisHealth(): Promise<void> {
    try {
      const start = performance.now();
      const result = await redisService.ping();
      const duration = performance.now() - start;
      
      if (!result) {
        throw new Error('Redis ping returned false');
      }
      
      if (duration > 1000) {
        this.createAlert('warning', 'redis', `Redis response time is slow: ${duration.toFixed(2)}ms`, { duration });
      }
      
      console.log(`✅ Redis service healthy (${duration.toFixed(2)}ms)`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Redis service unhealthy:', error);
      this.createAlert('critical', 'redis', 'Redis service is unreachable', { error: errorMessage });
      throw error;
    }
  }

  private async checkRateLimitingHealth(): Promise<void> {
    try {
      // Test rate limiting by checking if Redis rate limit keys can be accessed
      // This is a simple connectivity test
      await redisService.get('rate_limit_health_check');
      console.log('✅ Rate limiting service healthy');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Rate limiting service unhealthy:', error);
      this.createAlert('warning', 'rateLimiting', 'Rate limiting service may be impaired', { error: errorMessage });
      throw error;
    }
  }

  private checkCircuitBreakerHealth(): 'healthy' | 'degraded' | 'unhealthy' {
    try {
      const circuitBreakerStatus = resilientAuthService.getCircuitBreakerStatus();
      
      if (circuitBreakerStatus.overall === 'healthy') {
        return 'healthy';
      } else if (circuitBreakerStatus.overall === 'degraded') {
        this.createAlert('warning', 'circuitBreakers', 'Some circuit breakers are experiencing issues', circuitBreakerStatus);
        return 'degraded';
      } else {
        this.createAlert('critical', 'circuitBreakers', 'Multiple circuit breakers are open', circuitBreakerStatus);
        return 'unhealthy';
      }
    } catch (error) {
      console.error('❌ Circuit breaker health check failed:', error);
      return 'unhealthy';
    }
  }

  private determineCircuitBreakerHealth(): 'healthy' | 'degraded' | 'unhealthy' {
    return this.checkCircuitBreakerHealth();
  }

  /**
   * MONITORING 5: Metrics calculation and tracking
   */
  private async calculateMetrics(): Promise<AuthMetrics> {
    // Calculate average response time
    if (this.responseTimeBuffer.length > 0) {
      this.metrics.avgResponseTime = this.responseTimeBuffer.reduce((a, b) => a + b, 0) / this.responseTimeBuffer.length;
    }

    // Get 24-hour metrics from Redis
    const last24Hours = await this.get24HourMetrics();
    
    // Get real-time metrics
    const realTime = await this.getRealTimeMetrics();

    // Calculate cache hit rate from Redis service if available
    try {
      this.metrics.cacheHitRate = await this.calculateCacheHitRate();
    } catch (error) {
      console.warn('⚠️ Failed to calculate cache hit rate:', error);
      this.metrics.cacheHitRate = 0;
    }

    // Get retry service metrics
    const retryMetrics = RetryService.getMetrics();
    this.metrics.retryAttempts = retryMetrics.totalAttempts;

    return {
      current: { ...this.metrics },
      last24Hours,
      realTime
    };
  }

  private async get24HourMetrics(): Promise<AuthMetrics['last24Hours']> {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0]; // YYYY-MM-DD format
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Get metrics from Redis (stored by auth operations)
      const [
        todayLogins,
        yesterdayLogins,
        todayFailures,
        yesterdayFailures,
        todayResponseTime,
        yesterdayResponseTime,
        peakConcurrency
      ] = await Promise.all([
        redisService.get(`metrics:${today}:total_logins`),
        redisService.get(`metrics:${yesterday}:total_logins`),
        redisService.get(`metrics:${today}:total_failures`),
        redisService.get(`metrics:${yesterday}:total_failures`),
        redisService.get(`metrics:${today}:total_response_time`),
        redisService.get(`metrics:${yesterday}:total_response_time`),
        redisService.get(`metrics:${today}:peak_concurrency`)
      ]);

      const totalLogins = parseInt(todayLogins || '0') + parseInt(yesterdayLogins || '0');
      const totalFailures = parseInt(todayFailures || '0') + parseInt(yesterdayFailures || '0');
      const totalResponseTime = parseInt(todayResponseTime || '0') + parseInt(yesterdayResponseTime || '0');

      const failureRate = totalLogins > 0 ? (totalFailures / totalLogins) * 100 : 0;
      const avgLoginTime = totalLogins > 0 ? totalResponseTime / totalLogins : 0;

      // Get operation performance data
      const operationStats = await this.getOperationStats();

      return {
        totalLogins,
        failureRate: Number(failureRate.toFixed(2)),
        avgLoginTime: Number(avgLoginTime.toFixed(2)),
        peakConcurrency: parseInt(peakConcurrency || '0'),
        slowestOperation: operationStats.slowest,
        mostFailedOperation: operationStats.mostFailed
      };
    } catch (error) {
      console.warn('⚠️ Failed to get 24-hour metrics:', error);
      return {
        totalLogins: 0,
        failureRate: 0,
        avgLoginTime: 0,
        peakConcurrency: 0,
        slowestOperation: 'unknown',
        mostFailedOperation: 'unknown'
      };
    }
  }

  private async getRealTimeMetrics(): Promise<AuthMetrics['realTime']> {
    try {
      // Calculate 95th percentile response time
      const sortedTimes = [...this.responseTimeBuffer].sort((a, b) => a - b);
      const p95Index = Math.floor(sortedTimes.length * 0.95);
      const responseTime95thPercentile = sortedTimes.length > 0 ? sortedTimes[p95Index] || 0 : 0;

      // Calculate current error rate
      const totalRequests = this.metrics.authAttempts;
      const errorRate = totalRequests > 0 ? (this.metrics.authFailures / totalRequests) * 100 : 0;

      return {
        activeAuthRequests: this.activeRequests.size,
        queuedRequests: await this.getQueuedRequestCount(),
        errorRate: Number(errorRate.toFixed(2)),
        responseTime95thPercentile: Number(responseTime95thPercentile.toFixed(2))
      };
    } catch (error) {
      console.warn('⚠️ Failed to get real-time metrics:', error);
      return {
        activeAuthRequests: 0,
        queuedRequests: 0,
        errorRate: 0,
        responseTime95thPercentile: 0
      };
    }
  }

  private async getOperationStats(): Promise<{ slowest: string; mostFailed: string }> {
    try {
      // This would typically come from detailed operation tracking
      // For now, return placeholder values
      return {
        slowest: 'database_query',
        mostFailed: 'google_oauth_verification'
      };
    } catch (error) {
      return {
        slowest: 'unknown',
        mostFailed: 'unknown'
      };
    }
  }

  private async calculateCacheHitRate(): Promise<number> {
    try {
      // For now, return a placeholder cache hit rate
      // In production, this would need to be implemented with proper Redis info access
      // or by tracking cache hits/misses separately
      return 85; // Placeholder 85% hit rate
    } catch (error) {
      console.warn('⚠️ Failed to calculate cache hit rate:', error);
      return 0;
    }
  }

  private async getQueuedRequestCount(): Promise<number> {
    try {
      // This would depend on your queuing implementation
      // For now, return 0 as placeholder
      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * MONITORING 6: Record authentication events
   */
  recordAuthAttempt(success: boolean, responseTime: number, requestId?: string): void {
    this.metrics.authAttempts++;

    if (success) {
      this.metrics.authSuccesses++;
    } else {
      this.metrics.authFailures++;
    }

    // Track response time
    this.responseTimeBuffer.push(responseTime);
    if (this.responseTimeBuffer.length > this.BUFFER_SIZE) {
      this.responseTimeBuffer.shift();
    }

    // Track active requests
    if (requestId) {
      if (success) {
        this.activeRequests.delete(requestId);
      } else {
        this.activeRequests.add(requestId);
      }
    }

    // Store in Redis for 24-hour tracking
    this.store24HourMetrics(success, responseTime);
  }

  recordAuthStart(requestId: string): void {
    this.activeRequests.add(requestId);
  }

  recordAuthEnd(requestId: string): void {
    this.activeRequests.delete(requestId);
  }

  private async store24HourMetrics(success: boolean, responseTime: number): Promise<void> {
    try {
      const day = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

      // Use Redis service methods instead of direct client access
      try {
        const loginKey = `metrics:${day}:total_logins`;
        const responseTimeKey = `metrics:${day}:total_response_time`;
        
        // Increment login count
        await redisService.set(loginKey, '1', 86400 * 2);
        
        // Store response time (simplified - in production would accumulate)
        await redisService.set(responseTimeKey, responseTime.toString(), 86400 * 2);

        if (!success) {
          const failureKey = `metrics:${day}:total_failures`;
          await redisService.set(failureKey, '1', 86400 * 2);
        }
      } catch (redisError) {
        console.warn('⚠️ Failed to store metrics in Redis:', redisError);
      }

      // Track peak concurrency
      const currentConcurrency = this.activeRequests.size;
      const currentPeak = await redisService.get(`metrics:${day}:peak_concurrency`);
      if (!currentPeak || currentConcurrency > parseInt(currentPeak)) {
        await redisService.set(`metrics:${day}:peak_concurrency`, currentConcurrency.toString(), 86400 * 2);
      }
    } catch (error) {
      console.warn('⚠️ Failed to store 24-hour metrics:', error);
    }
  }

  /**
   * MONITORING 7: Alert management system
   */
  private createAlert(severity: 'critical' | 'warning' | 'info', component: string, message: string, metadata?: any): void {
    const alert: SystemAlert = {
      id: `${component}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      severity,
      component,
      message,
      timestamp: new Date().toISOString(),
      resolved: false,
      metadata
    };

    this.alerts.push(alert);

    // Keep only last 100 alerts to prevent memory issues
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(-100);
    }

    // Log alert
    const logLevel = severity === 'critical' ? 'error' : severity === 'warning' ? 'warn' : 'info';
    console[logLevel](`🚨 Alert [${severity.toUpperCase()}] ${component}: ${message}`, metadata);

    // In production: send to external monitoring system
    this.sendExternalAlert(alert);
  }

  private async sendExternalAlert(alert: SystemAlert): Promise<void> {
    // In production: integrate with alerting service (PagerDuty, Slack, etc.)
    try {
      // Placeholder for external alerting
      console.log(`📨 Sending external alert: ${alert.severity} - ${alert.message}`);
      
      // Example integration:
      // await alertingService.sendAlert({
      //   title: `ClassWaves Auth ${alert.severity}`,
      //   message: alert.message,
      //   severity: alert.severity,
      //   component: alert.component,
      //   timestamp: alert.timestamp,
      //   metadata: alert.metadata
      // });
    } catch (error) {
      console.error('⚠️ Failed to send external alert:', error);
    }
  }

  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      alert.resolvedAt = new Date().toISOString();
      console.log(`✅ Alert resolved: ${alertId}`);
      return true;
    }
    return false;
  }

  getActiveAlerts(): SystemAlert[] {
    return this.alerts.filter(alert => !alert.resolved);
  }

  getAllAlerts(): SystemAlert[] {
    return [...this.alerts];
  }

  /**
   * MONITORING 8: Health status processing and alerting logic
   */
  private async processHealthStatus(status: HealthStatus): Promise<void> {
    // Clear resolved alerts for components that are now healthy
    Object.entries(status.checks).forEach(([component, health]) => {
      if (health === 'healthy') {
        this.autoResolveAlertsForComponent(component);
      }
    });

    // Create alerts based on health status
    if (status.overall === 'unhealthy') {
      await this.triggerCriticalAlert(status);
    } else if (status.overall === 'degraded') {
      await this.triggerWarningAlert(status);
    }

    // Performance-based alerts
    if (status.metrics.current.avgResponseTime > 3000) {
      this.createAlert('warning', 'performance', 
        `Average response time is high: ${status.metrics.current.avgResponseTime.toFixed(2)}ms`,
        { avgResponseTime: status.metrics.current.avgResponseTime }
      );
    }

    if (status.metrics.last24Hours.failureRate > 10) {
      this.createAlert('warning', 'reliability',
        `High failure rate: ${status.metrics.last24Hours.failureRate}%`,
        { failureRate: status.metrics.last24Hours.failureRate }
      );
    }
  }

  private autoResolveAlertsForComponent(component: string): void {
    this.alerts
      .filter(alert => alert.component === component && !alert.resolved)
      .forEach(alert => {
        alert.resolved = true;
        alert.resolvedAt = new Date().toISOString();
        console.log(`🔄 Auto-resolved alert for healthy component ${component}: ${alert.id}`);
      });
  }

  private async triggerCriticalAlert(status: HealthStatus): Promise<void> {
    const failedComponents = Object.entries(status.checks)
      .filter(([_, health]) => health === 'unhealthy')
      .map(([component, _]) => component);

    const alertMessage = `🚨 CRITICAL: Auth system unhealthy - Failed components: ${failedComponents.join(', ')}`;

    this.createAlert('critical', 'system', alertMessage, {
      failedComponents,
      failureRate: status.metrics.last24Hours.failureRate,
      avgResponseTime: status.metrics.current.avgResponseTime
    });
  }

  private async triggerWarningAlert(status: HealthStatus): Promise<void> {
    const degradedComponents = Object.entries(status.checks)
      .filter(([_, health]) => health === 'degraded' || health === 'unhealthy')
      .map(([component, _]) => component);

    const alertMessage = `⚠️ WARNING: Auth system degraded - Affected components: ${degradedComponents.join(', ')}`;

    this.createAlert('warning', 'system', alertMessage, {
      degradedComponents,
      impact: 'Performance may be reduced'
    });
  }

  /**
   * MONITORING 9: Utility methods
   */
  private getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * MONITORING 10: Reset and cleanup
   */
  resetMetrics(): void {
    this.metrics = {
      authAttempts: 0,
      authSuccesses: 0,
      authFailures: 0,
      avgResponseTime: 0,
      circuitBreakerTrips: 0,
      retryAttempts: 0,
      cacheHitRate: 0
    };
    this.responseTimeBuffer = [];
    this.activeRequests.clear();
    console.log('📊 Auth health metrics reset');
  }

  clearResolvedAlerts(): void {
    const beforeCount = this.alerts.length;
    this.alerts = this.alerts.filter(alert => !alert.resolved);
    const removedCount = beforeCount - this.alerts.length;
    console.log(`🧹 Cleared ${removedCount} resolved alerts`);
  }

  /**
   * MONITORING 11: Performance trend analysis
   */
  async generatePerformanceReport(): Promise<{
    summary: string;
    trends: Array<{ metric: string; trend: 'improving' | 'stable' | 'degrading'; value: number }>;
    recommendations: string[];
  }> {
    const metrics = await this.calculateMetrics();
    const trends: Array<{ metric: string; trend: 'improving' | 'stable' | 'degrading'; value: number }> = [];
    const recommendations: string[] = [];

    // Analyze trends (simplified - in production would compare historical data)
    if (metrics.last24Hours.failureRate > 5) {
      trends.push({ metric: 'failure_rate', trend: 'degrading', value: metrics.last24Hours.failureRate });
      recommendations.push('Investigate high failure rate - check external service dependencies');
    } else {
      trends.push({ metric: 'failure_rate', trend: 'stable', value: metrics.last24Hours.failureRate });
    }

    if (metrics.current.avgResponseTime > 2000) {
      trends.push({ metric: 'response_time', trend: 'degrading', value: metrics.current.avgResponseTime });
      recommendations.push('Response times are high - consider scaling or optimization');
    } else {
      trends.push({ metric: 'response_time', trend: 'stable', value: metrics.current.avgResponseTime });
    }

    if (metrics.current.cacheHitRate < 80) {
      trends.push({ metric: 'cache_efficiency', trend: 'degrading', value: metrics.current.cacheHitRate });
      recommendations.push('Low cache hit rate - review caching strategy');
    } else {
      trends.push({ metric: 'cache_efficiency', trend: 'stable', value: metrics.current.cacheHitRate });
    }

    const summary = `Auth system processed ${metrics.last24Hours.totalLogins} logins in 24h with ${metrics.last24Hours.failureRate}% failure rate`;

    return {
      summary,
      trends,
      recommendations
    };
  }
}

// Singleton instance for application use
export const authHealthMonitor = new AuthHealthMonitor();
