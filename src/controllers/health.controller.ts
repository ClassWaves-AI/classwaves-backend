/**
 * Health Monitoring Controller
 * 
 * REST endpoints for monitoring system health:
 * - GET /api/v1/health - Overall system health
 * - GET /api/v1/health/websocket - WebSocket namespace health
 * - GET /api/v1/health/guidance - Teacher guidance system health
 * - GET /api/v1/health/components - Individual component health
 * - GET /api/v1/health/alerts - Active system alerts
 */

import { Request, Response } from 'express';
import { getCompositionRoot } from '../app/composition-root';
import { redisService } from '../services/redis.service';
import { errorLoggingMiddleware } from '../middleware/error-logging.middleware';
import { getNamespacedWebSocketService } from '../services/websocket';
import { cacheHealthMonitor } from '../services/cache-health-monitor.service';

interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  lastCheck: string;
  details?: any;
}

interface SystemHealth {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  services: {
    redis: ServiceHealth;
    databricks: ServiceHealth;
    database: ServiceHealth;
    cache?: ServiceHealth;
  };
  errors: {
    total: number;
    recent: number;
    byEndpoint: Record<string, number>;
    byType: Record<string, number>;
  };
  recommendations: string[];
}

class HealthController {
  private static instance: HealthController;
  private lastHealthCheck: SystemHealth | null = null;
  private healthCheckInterval: NodeJS.Timeout | null = null;

  static getInstance(): HealthController {
    if (!HealthController.instance) {
      HealthController.instance = new HealthController();
    }
    return HealthController.instance;
  }

  private async checkRedisHealth(): Promise<ServiceHealth> {
    const startTime = Date.now();
    try {
      await redisService.ping();
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          connection: 'active',
          memory: 'available',
          keys: 'available'
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  private async checkDatabricksHealth(): Promise<ServiceHealth> {
    const startTime = Date.now();
    try {
      const result = await getCompositionRoot().getHealthRepository().getServerTime();
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          connection: 'active',
          serverTime: (result as any)?.server_time,
          warehouse: 'connected'
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  private async checkDatabaseHealth(): Promise<ServiceHealth> {
    const startTime = Date.now();
    try {
      // Check if critical tables exist and are accessible
      const criticalTables = [
        'classwaves.analytics.session_analytics',
        'classwaves.analytics.session_metrics',
        'classwaves.sessions.classroom_sessions',
        'classwaves.users.teachers'
      ];

      const healthRepo = getCompositionRoot().getHealthRepository();
      const tableChecks = await Promise.allSettled(
        criticalTables.map(async (table) => {
          const count = await healthRepo.countFromTable(table);
          return { table, accessible: true, count };
        })
      );

      const responseTime = Date.now() - startTime;
      const failedTables = tableChecks.filter(result => result.status === 'rejected');
      
      return {
        status: failedTables.length === 0 ? 'healthy' : 'degraded',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          tables: tableChecks.map((result, index) => ({
            table: criticalTables[index],
            status: result.status === 'fulfilled' ? 'accessible' : 'inaccessible',
            details: result.status === 'fulfilled' ? result.value : result.reason
          }))
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  private generateRecommendations(health: SystemHealth): string[] {
    const recommendations: string[] = [];

    if (health.services.redis.status !== 'healthy') {
      recommendations.push('Redis connection issues detected. Check Redis service and configuration.');
    }

    if (health.services.databricks.status !== 'healthy') {
      recommendations.push('Databricks connection issues detected. Verify credentials and network connectivity.');
    }

    if (health.services.database.status !== 'healthy') {
      recommendations.push('Database accessibility issues detected. Check table permissions and schema consistency.');
    }

    if (health.errors.total > 100) {
      recommendations.push('High error rate detected. Review recent error logs for patterns.');
    }

    if (health.memory.heapUsed > 500 * 1024 * 1024) { // 500MB
      recommendations.push('High memory usage detected. Consider memory optimization or restart.');
    }

    if (health.uptime > 86400) { // 24 hours
      recommendations.push('Server has been running for over 24 hours. Consider scheduled restart for stability.');
    }

    return recommendations;
  }

  async getSystemHealth(): Promise<SystemHealth> {
    const [redisHealth, databricksHealth, databaseHealth, cacheMonitor] = await Promise.all([
      this.checkRedisHealth(),
      this.checkDatabricksHealth(),
      this.checkDatabaseHealth(),
      cacheHealthMonitor.checkHealth(),
    ]);

    const errorSummary = errorLoggingMiddleware.getErrorSummary();
    
    // Determine overall health
    const cacheStatus = cacheMonitor.overall === 'critical' ? 'unhealthy' : cacheMonitor.overall === 'degraded' ? 'degraded' : 'healthy';
    const serviceStatuses = [redisHealth.status, databricksHealth.status, databaseHealth.status, cacheStatus];
    const overall = serviceStatuses.every(s => s === 'healthy') ? 'healthy' 
                   : serviceStatuses.some(s => s === 'unhealthy') ? 'unhealthy' 
                   : 'degraded';

    const health: SystemHealth = {
      overall,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      services: {
        redis: redisHealth,
        databricks: databricksHealth,
        database: databaseHealth,
        cache: {
          status: cacheStatus,
          responseTime: cacheMonitor.redis.latency >= 0 ? cacheMonitor.redis.latency : 0,
          lastCheck: new Date().toISOString(),
          details: cacheMonitor,
        },
      },
      errors: {
        total: errorSummary.totalErrors,
        recent: errorSummary.recentErrors.length,
        byEndpoint: errorSummary.errorsByEndpoint,
        byType: errorSummary.errorsByType
      },
      recommendations: []
    };

    health.recommendations = this.generateRecommendations(health);
    this.lastHealthCheck = health;

    return health;
  }

  async getHealthCheck(req: Request, res: Response): Promise<Response> {
    try {
      const health = await this.getSystemHealth();
      
      const statusCode = health.overall === 'healthy' ? 200 : 
                        health.overall === 'degraded' ? 200 : 503;

      return res.status(statusCode).json({
        success: true,
        data: health
      });
    } catch (error) {
      console.error('Health check failed:', error);
      return res.status(503).json({
        success: false,
        error: {
          code: 'HEALTH_CHECK_FAILED',
          message: 'Failed to perform health check',
          details: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  async getErrorSummary(req: Request, res: Response): Promise<Response> {
    try {
      const errorSummary = errorLoggingMiddleware.getErrorSummary();
      
      return res.json({
        success: true,
        data: errorSummary
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'ERROR_SUMMARY_FAILED',
          message: 'Failed to get error summary',
          details: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  async clearErrorLogs(req: Request, res: Response): Promise<Response> {
    try {
      errorLoggingMiddleware.clearLogs();
      
      return res.json({
        success: true,
        message: 'Error logs cleared successfully'
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: {
          code: 'CLEAR_LOGS_FAILED',
          message: 'Failed to clear error logs',
          details: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  async getWebSocketHealth(req: Request, res: Response): Promise<Response> {
    try {
      const startTime = Date.now();
      
      // Get WebSocket service instance
      const wsService = getNamespacedWebSocketService();
      if (!wsService) {
        return res.status(503).json({
          success: false,
          error: {
            code: 'WEBSOCKET_SERVICE_UNAVAILABLE',
            message: 'WebSocket service is not initialized',
            timestamp: new Date().toISOString()
          }
        });
      }

      // Get namespace information
      const io = wsService.getIO();
      const sessionsService = wsService.getSessionsService();
      const guidanceService = wsService.getGuidanceService();

      // Check Redis connection status
      const redisConnected = redisService.isConnected();
      const redisAdapter = redisConnected ? 'enabled' : 'degraded';

      // Get namespace statistics
      const sessionsNamespace = io.of('/sessions');
      const guidanceNamespace = io.of('/guidance');

      const sessionsStats = {
        status: 'healthy' as const,
        namespace: '/sessions',
        purpose: 'Session management and real-time updates',
        connectedUsers: sessionsNamespace.sockets.size,
        connectedSockets: sessionsNamespace.sockets.size,
        rooms: Array.from(sessionsNamespace.adapter.rooms.keys())
      };

      const guidanceStats = {
        status: 'healthy' as const,
        namespace: '/guidance',
        purpose: 'Teacher guidance and AI insights',
        connectedUsers: guidanceNamespace.sockets.size,
        connectedSockets: guidanceNamespace.sockets.size,
        rooms: Array.from(guidanceNamespace.adapter.rooms.keys())
      };

      // Calculate overall status
      const overallStatus = redisConnected ? 'healthy' : 'degraded';

      // Performance metrics (simplified for now)
      const performance = {
        totalConnections: sessionsNamespace.sockets.size + guidanceNamespace.sockets.size,
        totalReconnections: 0, // Would need to track this in the service
        averageResponseTime: Math.max(1, Date.now() - startTime), // Ensure minimum of 1ms
        messageThroughput: 0, // Would need to track this in the service
        errorRate: 0 // Would need to track this in the service
      };

      const healthData = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        namespaces: {
          sessions: sessionsStats,
          guidance: guidanceStats
        },
        redis: {
          connected: redisConnected,
          adapter: redisAdapter,
          details: {
            connection: redisConnected ? 'active' : 'disconnected',
            adapter: redisAdapter
          }
        },
        performance
      };

      const statusCode = overallStatus === 'healthy' ? 200 : 200; // Always return 200 for health endpoints

      return res.status(statusCode).json({
        success: true,
        data: healthData
      });

    } catch (error) {
      console.error('WebSocket health check failed:', error);
      return res.status(503).json({
        success: false,
        error: {
          code: 'WEBSOCKET_HEALTH_CHECK_FAILED',
          message: 'Failed to perform WebSocket health check',
          details: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString()
        }
      });
    }
  }

  startPeriodicHealthCheck(intervalMs: number = 300000): void { // 5 minutes default
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.getSystemHealth();
        
        if (health.overall !== 'healthy') {
          console.warn('⚠️ System health degraded:', {
            overall: health.overall,
            recommendations: health.recommendations,
            errors: health.errors.total
          });
        }
      } catch (error) {
        console.error('❌ Periodic health check failed:', error);
      }
    }, intervalMs);
  }

  stopPeriodicHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }
}

export const healthController = HealthController.getInstance();
