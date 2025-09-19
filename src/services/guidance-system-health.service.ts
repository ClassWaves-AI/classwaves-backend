/**
 * Guidance System Health Monitor
 * 
 * Monitors the health and performance of the complete teacher guidance pipeline:
 * - AI analysis success rates and latency
 * - Prompt generation and delivery rates
 * - System component availability
 * - End-to-end pipeline performance
 * - Alert on system degradation
 * 
 * ✅ COMPLIANCE: FERPA/COPPA compliant health monitoring
 * ✅ PERFORMANCE: Real-time health metrics with alerting
 * ✅ RELIABILITY: Comprehensive system monitoring
 */

import { EventEmitter } from 'events';
import { databricksService } from './databricks.service';
import { logger } from '../utils/logger';

// ============================================================================
// Health Monitoring Types
// ============================================================================

export interface SystemHealthMetrics {
  overall: {
    status: 'healthy' | 'degraded' | 'critical' | 'unavailable';
    score: number; // 0-1
    lastUpdated: Date;
  };
  components: {
    aiAnalysis: ComponentHealth;
    promptGeneration: ComponentHealth;
    alertDelivery: ComponentHealth;
    websocket: ComponentHealth;
    database: ComponentHealth;
  };
  pipeline: {
    endToEndLatency: PerformanceMetrics;
    successRate: PerformanceMetrics;
    throughput: PerformanceMetrics;
  };
  alerts: SystemAlert[];
}

interface ComponentHealth {
  status: 'healthy' | 'degraded' | 'critical' | 'unavailable';
  uptime: number; // percentage
  avgResponseTime: number; // milliseconds
  errorRate: number; // percentage
  lastCheck: Date;
  lastError?: string;
}

interface PerformanceMetrics {
  current: number;
  average: number;
  min: number;
  max: number;
  trend: 'improving' | 'stable' | 'degrading';
}

interface SystemAlert {
  id: string;
  level: 'warning' | 'critical';
  component: string;
  message: string;
  timestamp: Date;
  resolved: boolean;
  details?: any;
}

interface HealthCheckResult {
  component: string;
  healthy: boolean;
  responseTime: number;
  error?: string;
  metadata?: any;
}

// ============================================================================
// Guidance System Health Service
// ============================================================================

export class GuidanceSystemHealthService extends EventEmitter {
  private healthMetrics: SystemHealthMetrics;
  private healthHistory = new Map<string, HealthCheckResult[]>();
  private alertHistory = new Map<string, SystemAlert[]>();
  private monitoringInterval: NodeJS.Timeout | null = null;
  
  private readonly config = {
    checkIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '300000'), // 5 minutes
    historyRetentionMs: parseInt(process.env.HEALTH_HISTORY_RETENTION_MS || '3600000'), // 1 hour
    alertThresholds: {
      responseTime: parseInt(process.env.HEALTH_RESPONSE_TIME_THRESHOLD_MS || '5000'),
      errorRate: parseFloat(process.env.HEALTH_ERROR_RATE_THRESHOLD || '0.05'), // 5%
      uptime: parseFloat(process.env.HEALTH_UPTIME_THRESHOLD || '0.95'), // 95%
    },
    enableRealTimeAlerts: process.env.HEALTH_ENABLE_ALERTS !== 'false'
  };

  constructor() {
    super();
    
    this.healthMetrics = this.initializeHealthMetrics();
    // Avoid starting timers during tests to prevent Jest open-handle leaks
    if (process.env.NODE_ENV !== 'test') {
      this.startHealthMonitoring();
    }
    
    logger.debug('🏥 Guidance System Health Monitor initialized', {
      checkInterval: this.config.checkIntervalMs,
      alertsEnabled: this.config.enableRealTimeAlerts
    });
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Get current system health status
   */
  getSystemHealth(): SystemHealthMetrics {
    return { ...this.healthMetrics };
  }

  /**
   * Get health metrics for a specific component
   */
  getComponentHealth(component: string): ComponentHealth | null {
    return (this.healthMetrics.components as any)[component] || null;
  }

  /**
   * Record a successful operation for metrics
   */
  recordSuccess(component: string, operation: string, duration: number): void {
    this.updateComponentMetrics(component, true, duration);
    this.updatePipelineMetrics('success', duration);
  }

  /**
   * Record a failed operation for metrics
   */
  recordFailure(component: string, operation: string, duration: number, error: string): void {
    this.updateComponentMetrics(component, false, duration, error);
    this.updatePipelineMetrics('failure', duration);
    
    // Check if this triggers an alert
    this.checkForAlerts(component, error);
  }

  /**
   * Force a health check of all components
   */
  async performHealthCheck(): Promise<SystemHealthMetrics> {
    logger.debug('🏥 Performing comprehensive health check...');
    
    try {
      // Perform health checks on all components
      const checks = await Promise.allSettled([
        this.checkAIAnalysisHealth(),
        this.checkPromptGenerationHealth(),
        this.checkAlertDeliveryHealth(),
        this.checkWebSocketHealth(),
        this.checkDatabaseHealth()
      ]);

      // Process results
      for (let i = 0; i < checks.length; i++) {
        const result = checks[i];
        if (result.status === 'fulfilled') {
          this.processHealthCheckResult(result.value);
        } else {
          logger.error(`Health check failed:`, result.reason);
        }
      }

      // Update overall health
      this.calculateOverallHealth();
      
      // Emit health update event
      this.emit('healthUpdate', this.healthMetrics);
      
      return this.healthMetrics;
      
    } catch (error) {
      logger.error('❌ Health check failed:', error);
      throw error;
    }
  }

  /**
   * Get system performance trends
   */
  getPerformanceTrends(timeframe: 'hour' | 'day' | 'week' = 'hour'): any {
    const trends = {
      timeframe,
      components: {} as any,
      pipeline: {
        latencyTrend: this.healthMetrics.pipeline.endToEndLatency.trend,
        successRateTrend: this.healthMetrics.pipeline.successRate.trend,
        throughputTrend: this.healthMetrics.pipeline.throughput.trend
      },
      alerts: this.getRecentAlerts(timeframe)
    };

    // Calculate component trends
    for (const [name, component] of Object.entries(this.healthMetrics.components)) {
      trends.components[name] = {
        uptimeTrend: component.uptime > this.config.alertThresholds.uptime ? 'stable' : 'degrading',
        responseTrend: component.avgResponseTime < this.config.alertThresholds.responseTime ? 'stable' : 'degrading',
        errorTrend: component.errorRate < this.config.alertThresholds.errorRate ? 'stable' : 'degrading'
      };
    }

    return trends;
  }

  /**
   * Get active system alerts
   */
  getActiveAlerts(): SystemAlert[] {
    return this.healthMetrics.alerts.filter(alert => !alert.resolved);
  }

  /**
   * Resolve a system alert
   */
  async resolveAlert(alertId: string, resolution: string): Promise<void> {
    const alert = this.healthMetrics.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      alert.details = { ...alert.details, resolution, resolvedAt: new Date() };
      
      // Log resolution
      await this.auditLog({
        eventType: 'system_alert_resolved',
        alertId,
        resolution,
        component: alert.component
      });
      
      logger.debug(`✅ System alert resolved: ${alertId} - ${resolution}`);
    }
  }

  // ============================================================================
  // Private Methods - Health Checks
  // ============================================================================

  private async checkAIAnalysisHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Import AI service to avoid circular dependencies
      const { databricksAIService } = await import('./databricks-ai.service');
      
      // Validate configuration
      const validation = databricksAIService.validateConfiguration();
      const responseTime = Date.now() - startTime;
      
      return {
        component: 'aiAnalysis',
        healthy: validation.valid,
        responseTime,
        error: validation.valid ? undefined : validation.errors.join(', '),
        metadata: { configurationValid: validation.valid, errors: validation.errors }
      };
      
    } catch (error) {
      return {
        component: 'aiAnalysis',
        healthy: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: { error: 'Service unavailable' }
      };
    }
  }

  private async checkPromptGenerationHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Import teacher prompt service to avoid circular dependencies
      const { teacherPromptService } = await import('./teacher-prompt.service');
      
      // Check if service is responsive
      const metrics = teacherPromptService.getSessionMetrics('health-check');
      const responseTime = Date.now() - startTime;
      
      return {
        component: 'promptGeneration',
        healthy: true,
        responseTime,
        metadata: { responsive: true }
      };
      
    } catch (error) {
      return {
        component: 'promptGeneration',
        healthy: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkAlertDeliveryHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Import alert prioritization service
      const { alertPrioritizationService } = await import('./alert-prioritization.service');
      
      // Check alert statistics
      const stats = alertPrioritizationService.getAlertStatistics();
      const responseTime = Date.now() - startTime;
      
      return {
        component: 'alertDelivery',
        healthy: true,
        responseTime,
        metadata: { totalPending: stats.totalPending, deliveryRate: stats.deliveryRate }
      };
      
    } catch (error) {
      return {
        component: 'alertDelivery',
        healthy: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkWebSocketHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Check namespaced WebSocket service availability
      const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
      const io = getNamespacedWebSocketService()?.getIO();
      
      const healthy = !!io;
      const responseTime = Date.now() - startTime;
      
      return {
        component: 'websocket',
        healthy,
        responseTime,
        error: healthy ? undefined : 'WebSocket service not available',
        metadata: { serviceAvailable: healthy }
      };
      
    } catch (error) {
      return {
        component: 'websocket',
        healthy: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private async checkDatabaseHealth(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    
    try {
      // Simple database connectivity check
      await databricksService.query('SELECT 1 as health_check');
      const responseTime = Date.now() - startTime;
      
      return {
        component: 'database',
        healthy: true,
        responseTime,
        metadata: { connectionActive: true }
      };
      
    } catch (error) {
      return {
        component: 'database',
        healthy: false,
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // ============================================================================
  // Private Methods - Metrics Processing
  // ============================================================================

  private processHealthCheckResult(result: HealthCheckResult): void {
    const component = (this.healthMetrics.components as any)[result.component];
    if (!component) return;

    // Update component health
    component.status = this.determineComponentStatus(result);
    component.lastCheck = new Date();
    component.avgResponseTime = this.updateAverage(component.avgResponseTime, result.responseTime);
    
    if (!result.healthy) {
      component.lastError = result.error;
      component.errorRate = Math.min(1, component.errorRate + 0.1);
    } else {
      component.errorRate = Math.max(0, component.errorRate - 0.05);
    }

    // Store in history
    this.storeHealthHistory(result);
  }

  private determineComponentStatus(result: HealthCheckResult): ComponentHealth['status'] {
    if (!result.healthy) return 'critical';
    if (result.responseTime > this.config.alertThresholds.responseTime) return 'degraded';
    return 'healthy';
  }

  private updateComponentMetrics(component: string, success: boolean, duration: number, error?: string): void {
    const comp = (this.healthMetrics.components as any)[component];
    if (!comp) return;

    comp.avgResponseTime = this.updateAverage(comp.avgResponseTime, duration);
    comp.lastCheck = new Date();

    if (success) {
      comp.errorRate = Math.max(0, comp.errorRate - 0.01);
      comp.uptime = Math.min(1, comp.uptime + 0.001);
    } else {
      comp.errorRate = Math.min(1, comp.errorRate + 0.05);
      comp.uptime = Math.max(0, comp.uptime - 0.01);
      comp.lastError = error;
    }

    comp.status = this.calculateComponentStatus(comp);
  }

  private updatePipelineMetrics(type: 'success' | 'failure', duration: number): void {
    const pipeline = this.healthMetrics.pipeline;
    
    // Update latency
    pipeline.endToEndLatency.current = duration;
    pipeline.endToEndLatency.average = this.updateAverage(pipeline.endToEndLatency.average, duration);
    pipeline.endToEndLatency.min = Math.min(pipeline.endToEndLatency.min, duration);
    pipeline.endToEndLatency.max = Math.max(pipeline.endToEndLatency.max, duration);

    // Update success rate
    const currentSuccess = type === 'success' ? 1 : 0;
    pipeline.successRate.current = currentSuccess;
    pipeline.successRate.average = this.updateAverage(pipeline.successRate.average, currentSuccess);
  }

  private calculateOverallHealth(): void {
    const components = Object.values(this.healthMetrics.components);
    const scores = components.map(c => this.getComponentScore(c));
    const overallScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    
    this.healthMetrics.overall.score = overallScore;
    this.healthMetrics.overall.status = this.determineOverallStatus(overallScore);
    this.healthMetrics.overall.lastUpdated = new Date();
  }

  private getComponentScore(component: ComponentHealth): number {
    const weights = {
      uptime: 0.4,
      responseTime: 0.3,
      errorRate: 0.3
    };

    const uptimeScore = component.uptime;
    const responseScore = Math.max(0, 1 - (component.avgResponseTime / this.config.alertThresholds.responseTime));
    const errorScore = Math.max(0, 1 - (component.errorRate / this.config.alertThresholds.errorRate));

    return (
      uptimeScore * weights.uptime +
      responseScore * weights.responseTime +
      errorScore * weights.errorRate
    );
  }

  private determineOverallStatus(score: number): SystemHealthMetrics['overall']['status'] {
    if (score >= 0.9) return 'healthy';
    if (score >= 0.7) return 'degraded';
    if (score >= 0.5) return 'critical';
    return 'unavailable';
  }

  private calculateComponentStatus(component: ComponentHealth): ComponentHealth['status'] {
    if (component.uptime < 0.5 || component.errorRate > 0.5) return 'critical';
    if (component.uptime < this.config.alertThresholds.uptime || component.errorRate > this.config.alertThresholds.errorRate) return 'degraded';
    return 'healthy';
  }

  // ============================================================================
  // Private Methods - Alerting
  // ============================================================================

  private checkForAlerts(component: string, error: string): void {
    const comp = (this.healthMetrics.components as any)[component];
    if (!comp) return;

    // Check for critical conditions
    if (comp.errorRate > this.config.alertThresholds.errorRate * 2) {
      this.createAlert('critical', component, `High error rate detected: ${(comp.errorRate * 100).toFixed(1)}%`, { error });
    } else if (comp.avgResponseTime > this.config.alertThresholds.responseTime * 2) {
      this.createAlert('warning', component, `High response time detected: ${comp.avgResponseTime}ms`);
    } else if (comp.uptime < this.config.alertThresholds.uptime) {
      this.createAlert('warning', component, `Low uptime detected: ${(comp.uptime * 100).toFixed(1)}%`);
    }
  }

  private createAlert(level: 'warning' | 'critical', component: string, message: string, details?: any): void {
    const alert: SystemAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      level,
      component,
      message,
      timestamp: new Date(),
      resolved: false,
      details
    };

    this.healthMetrics.alerts.push(alert);
    
    // Keep only recent alerts
    this.healthMetrics.alerts = this.healthMetrics.alerts.slice(-50);
    
    // Emit alert event
    this.emit('alert', alert);
    
    logger.warn(`🚨 System alert (${level}): ${component} - ${message}`);
    
    // Log alert
    this.auditLog({
      eventType: 'system_alert_created',
      alertId: alert.id,
      level,
      component,
      message
    });
  }

  private getRecentAlerts(timeframe: string): SystemAlert[] {
    const now = Date.now();
    const timeframeMs = {
      hour: 3600000,
      day: 86400000,
      week: 604800000
    }[timeframe] || 3600000;

    return this.healthMetrics.alerts.filter(
      alert => now - alert.timestamp.getTime() < timeframeMs
    );
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  private initializeHealthMetrics(): SystemHealthMetrics {
    const defaultComponent = (): ComponentHealth => ({
      status: 'healthy',
      uptime: 1.0,
      avgResponseTime: 0,
      errorRate: 0,
      lastCheck: new Date()
    });

    return {
      overall: {
        status: 'healthy',
        score: 1.0,
        lastUpdated: new Date()
      },
      components: {
        aiAnalysis: defaultComponent(),
        promptGeneration: defaultComponent(),
        alertDelivery: defaultComponent(),
        websocket: defaultComponent(),
        database: defaultComponent()
      },
      pipeline: {
        endToEndLatency: { current: 0, average: 0, min: 0, max: 0, trend: 'stable' },
        successRate: { current: 1, average: 1, min: 1, max: 1, trend: 'stable' },
        throughput: { current: 0, average: 0, min: 0, max: 0, trend: 'stable' }
      },
      alerts: []
    };
  }

  private startHealthMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.performHealthCheck().catch(error => {
        logger.error('❌ Scheduled health check failed:', error);
      });
    }, this.config.checkIntervalMs);
    (this.monitoringInterval as any).unref?.();
  }

  private storeHealthHistory(result: HealthCheckResult): void {
    if (!this.healthHistory.has(result.component)) {
      this.healthHistory.set(result.component, []);
    }

    const history = this.healthHistory.get(result.component)!;
    history.push(result);

    // Keep only recent history
    const cutoff = Date.now() - this.config.historyRetentionMs;
    this.healthHistory.set(
      result.component,
      history.filter(h => h.responseTime > cutoff)
    );
  }

  private updateAverage(currentAvg: number, newValue: number, weight: number = 0.1): number {
    return currentAvg * (1 - weight) + newValue * weight;
  }

  private async auditLog(data: {
    eventType: string;
    alertId?: string;
    level?: string;
    component?: string;
    message?: string;
    resolution?: string;
  }): Promise<void> {
    try {
      const { auditLogPort } = await import('../utils/audit.port.instance');
      auditLogPort.enqueue({
        actorId: 'system',
        actorType: 'system',
        eventType: data.eventType,
        eventCategory: 'compliance',
        resourceType: 'system_health',
        resourceId: data.alertId || 'health_monitor',
        schoolId: 'system',
        description: data.message || `health monitoring event: ${data.eventType}`,
        dataAccessed: 'system_health_metrics'
      }).catch(() => {});
    } catch (error) {
      logger.warn('⚠️ Audit logging failed in health monitor:', error);
    }
  }

  public shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    logger.debug('🛑 Guidance System Health Monitor shutdown completed');
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const guidanceSystemHealthService = new GuidanceSystemHealthService();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  guidanceSystemHealthService.shutdown();
});

process.on('SIGINT', () => {
  guidanceSystemHealthService.shutdown();
});