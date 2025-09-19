/**
 * Service Manager for ClassWaves Backend
 * Manages initialization and health of all services
 */

import { redisService } from './redis.service';
import { databricksService } from './databricks.service';
import { emailService } from './email.service';
import { logger } from '../utils/logger';

interface ServiceStatus {
  name: string;
  status: 'healthy' | 'unhealthy' | 'initializing';
  lastCheck: Date;
  error?: string;
  connectedTime?: Date;
}

class ServiceManager {
  private services: Map<string, ServiceStatus> = new Map();

  /**
   * Initialize all services
   */
  async initializeServices(): Promise<boolean> {
    logger.debug('🚀 Initializing ClassWaves services...');
    
    let allHealthy = true;

    // Initialize Redis
    try {
      this.updateServiceStatus('redis', 'initializing');
      if (!redisService.isConnected()) {
        // Redis connection handled automatically by ioredis
      }
      this.updateServiceStatus('redis', 'healthy', undefined, new Date());
      logger.debug('✅ Redis service initialized');
    } catch (error) {
      logger.error('❌ Redis service initialization failed:', error);
      this.updateServiceStatus('redis', 'unhealthy', error instanceof Error ? error.message : String(error));
      allHealthy = false;
    }

    // Initialize Databricks (skip in test environment unless explicitly enabled)
    if ((process.env.NODE_ENV !== 'test' || process.env.DATABRICKS_ENABLED === 'true') && process.env.DATABRICKS_ENABLED !== 'false') {
      try {
        this.updateServiceStatus('databricks', 'initializing');
        await databricksService.connect();
        this.updateServiceStatus('databricks', 'healthy', undefined, new Date());
        logger.debug('✅ Databricks service initialized');
      } catch (error) {
        logger.error('❌ Databricks service initialization failed:', error);
        this.updateServiceStatus('databricks', 'unhealthy', error instanceof Error ? error.message : String(error));
        allHealthy = false;
      }
    } else {
      if (process.env.NODE_ENV === 'test' && process.env.DATABRICKS_ENABLED === 'true') {
        this.updateServiceStatus('databricks', 'unhealthy', 'Failed to initialize in test mode');
        logger.debug('❌ Databricks service failed to initialize in test mode');
      } else {
        this.updateServiceStatus('databricks', 'healthy', 'Skipped in test environment');
        logger.debug('⚠️ Databricks service skipped (test environment)');
      }
    }

    // Initialize Email Service
    try {
      this.updateServiceStatus('email', 'initializing');
      await emailService.initialize();
      this.updateServiceStatus('email', 'healthy', undefined, new Date());
      logger.debug('✅ Email service initialized');
    } catch (error) {
      logger.error('❌ Email service initialization failed:', error);
      this.updateServiceStatus('email', 'unhealthy', error instanceof Error ? error.message : String(error));
      
      // Allow degraded mode for development
      if (process.env.NODE_ENV !== 'production') {
        logger.warn('⚠️ Running without email service in development mode');
      } else {
        allHealthy = false;
      }
    }

    if (allHealthy) {
      logger.debug('🎉 All services initialized successfully');
    } else {
      logger.warn('⚠️ Some services failed to initialize - check logs above');
    }

    return allHealthy;
  }

  /**
   * Get current status of all services
   */
  getServiceStatus(): ServiceStatus[] {
    return Array.from(this.services.values());
  }

  /**
   * Get specific service status
   */
  getStatus(serviceName: string): ServiceStatus | undefined {
    return this.services.get(serviceName);
  }

  /**
   * Update service status
   */
  private updateServiceStatus(
    name: string, 
    status: 'healthy' | 'unhealthy' | 'initializing',
    error?: string,
    connectedTime?: Date
  ): void {
    this.services.set(name, {
      name,
      status,
      lastCheck: new Date(),
      error,
      connectedTime
    });
  }

  /**
   * Health check for all services
   */
  async performHealthCheck(): Promise<{ healthy: boolean; details: ServiceStatus[] }> {
    logger.debug('🔍 Performing service health check...');

    // Check Redis
    try {
      const isRedisHealthy = redisService.isConnected();
      this.updateServiceStatus('redis', isRedisHealthy ? 'healthy' : 'unhealthy');
    } catch (error) {
      this.updateServiceStatus('redis', 'unhealthy', error instanceof Error ? error.message : String(error));
    }

    // Check Databricks (simple query)
    try {
      await databricksService.query('SELECT 1 as health_check');
      this.updateServiceStatus('databricks', 'healthy');
    } catch (error) {
      this.updateServiceStatus('databricks', 'unhealthy', error instanceof Error ? error.message : String(error));
    }

    // Check Email service
    try {
      const emailHealth = await emailService.getHealthStatus();
      this.updateServiceStatus('email', emailHealth.status === 'degraded' ? 'unhealthy' : emailHealth.status, JSON.stringify(emailHealth.details));
    } catch (error) {
      this.updateServiceStatus('email', 'unhealthy', error instanceof Error ? error.message : String(error));
    }

    const statuses = this.getServiceStatus();
    const healthy = statuses.every(s => s.status === 'healthy');

    logger.debug(`🏥 Health check complete. Overall status: ${healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    
    return { healthy, details: statuses };
  }

  /**
   * Graceful shutdown of all services
   */
  async shutdown(): Promise<void> {
    logger.debug('🛑 Shutting down services...');

    try {
      await redisService.disconnect();
      logger.debug('✅ Redis disconnected');
    } catch (error) {
      logger.error('❌ Redis disconnect failed:', error);
    }

    try {
      await databricksService.disconnect();
      logger.debug('✅ Databricks disconnected');
    } catch (error) {
      logger.error('❌ Databricks disconnect failed:', error);
    }

    logger.debug('🏁 Service shutdown complete');
  }

  /**
   * Get email service instance
   */
  getEmailService() {
    return emailService;
  }

  /**
   * Get Redis service instance
   */
  getRedisService(): any {
    return redisService;
  }

  /**
   * Get Databricks service instance
   */
  getDatabricksService(): any {
    return databricksService;
  }

  /**
   * Check if all critical services are healthy
   */
  isHealthy(): boolean {
    const statuses = this.getServiceStatus();
    return statuses.every(s => s.status === 'healthy');
  }
}

// Export singleton instance
export const serviceManager = new ServiceManager();