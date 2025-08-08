/**
 * Service Manager - Enterprise Service Lifecycle Management
 * 
 * Implements industry-standard dependency injection and service initialization
 * following the patterns from our rebuild documentation.
 */

import { redisService } from './redis.service';
import { databricksService } from './databricks.service';
import { initializeRateLimiters } from '../middleware/rate-limit.middleware';

interface ServiceStatus {
  name: string;
  status: 'pending' | 'connecting' | 'connected' | 'failed';
  error?: Error;
  startTime?: Date;
  connectedTime?: Date;
}

class ServiceManager {
  private services: Map<string, ServiceStatus> = new Map();
  private initialized = false;

  /**
   * Initialize all services in proper dependency order
   * Following enterprise service lifecycle patterns
   */
  async initializeServices(): Promise<boolean> {
    if (this.initialized) {
      console.log('⚠️  Services already initialized');
      return true;
    }

    console.log('🔄 Initializing services...');

    try {
      // Phase 1: Core Infrastructure Services
      await this.initializeDatabase();
      await this.initializeCache();
      
      // Phase 2: Application Services (depend on infrastructure)
      await this.initializeRateLimiters();
      
      // Phase 3: Real-time Services (depend on cache and database)
      // WebSocket service will be initialized separately in server.ts

      this.initialized = true;
      console.log('✅ All services initialized successfully');
      this.logServiceStatus();
      
      return true;
    } catch (error) {
      console.error('❌ Service initialization failed:', error);
      this.logServiceStatus();
      return false;
    }
  }

  /**
   * Initialize Databricks database service
   */
  private async initializeDatabase(): Promise<void> {
    const serviceName = 'databricks';
    this.updateServiceStatus(serviceName, 'connecting');

    try {
      await databricksService.connect();
      this.updateServiceStatus(serviceName, 'connected');
      console.log('✅ Database service initialized');
    } catch (error) {
      this.updateServiceStatus(serviceName, 'failed', error as Error);
      throw new Error(`Database initialization failed: ${error}`);
    }
  }

  /**
   * Initialize Redis cache service with connection validation
   */
  private async initializeCache(): Promise<void> {
    const serviceName = 'redis';
    this.updateServiceStatus(serviceName, 'connecting');

    try {
      console.log('🔄 Connecting to Redis...');
      const redisConnected = await redisService.waitForConnection(10000);
      
      if (!redisConnected) {
        throw new Error('Redis connection timeout after 10 seconds');
      }

      // Verify connection with ping
      const pingSuccess = await redisService.ping();
      if (!pingSuccess) {
        throw new Error('Redis ping test failed');
      }

      this.updateServiceStatus(serviceName, 'connected');
      console.log('✅ Redis cache service initialized');
    } catch (error) {
      this.updateServiceStatus(serviceName, 'failed', error as Error);
      console.error('❌ Redis connection failed - sessions will use in-memory fallback');
      console.error('   Please ensure Redis is running:');
      console.error('   docker-compose up -d redis');
      
      // Don't throw - allow graceful degradation for development
      // throw new Error(`Cache initialization failed: ${error}`);
    }
  }

  /**
   * Initialize rate limiters with Redis dependency
   */
  private async initializeRateLimiters(): Promise<void> {
    const serviceName = 'rateLimiters';
    this.updateServiceStatus(serviceName, 'connecting');

    try {
      await initializeRateLimiters();
      this.updateServiceStatus(serviceName, 'connected');
      console.log('✅ Rate limiters initialized');
    } catch (error) {
      this.updateServiceStatus(serviceName, 'failed', error as Error);
      console.warn('⚠️  Rate limiters failed to initialize, using memory fallback');
      // Don't throw - rate limiters have built-in fallback
    }
  }

  /**
   * Update service status tracking
   */
  private updateServiceStatus(
    name: string, 
    status: ServiceStatus['status'], 
    error?: Error
  ): void {
    const existing = this.services.get(name);
    const now = new Date();

    this.services.set(name, {
      name,
      status,
      error,
      startTime: existing?.startTime || now,
      connectedTime: status === 'connected' ? now : existing?.connectedTime
    });
  }

  /**
   * Get current service statuses
   */
  getServiceStatus(): ServiceStatus[] {
    return Array.from(this.services.values());
  }

  /**
   * Check if all critical services are healthy
   */
  isHealthy(): boolean {
    const statuses = this.getServiceStatus();
    const criticalServices = ['databricks']; // Redis is optional for graceful degradation
    
    return criticalServices.every(serviceName => {
      const service = statuses.find(s => s.name === serviceName);
      return service?.status === 'connected';
    });
  }

  /**
   * Log service initialization summary
   */
  private logServiceStatus(): void {
    console.log('\n📊 Service Status Summary:');
    this.getServiceStatus().forEach(service => {
      const icon = service.status === 'connected' ? '✅' : 
                  service.status === 'failed' ? '❌' : '🔄';
      const duration = service.connectedTime && service.startTime ? 
        `(${service.connectedTime.getTime() - service.startTime.getTime()}ms)` : '';
      
      console.log(`   ${icon} ${service.name}: ${service.status} ${duration}`);
      if (service.error) {
        console.log(`      Error: ${service.error.message}`);
      }
    });
    console.log('');
  }

  /**
   * Graceful shutdown of all services
   */
  async shutdown(): Promise<void> {
    console.log('🔄 Shutting down services...');
    
    try {
      // Close Redis connection
      if (redisService.isConnected()) {
        await redisService.disconnect();
        console.log('✅ Redis disconnected');
      }

      // Databricks service cleanup if needed
      // Add other service cleanups here

      this.initialized = false;
      console.log('✅ All services shut down successfully');
    } catch (error) {
      console.error('❌ Error during service shutdown:', error);
    }
  }
}

// Export singleton instance
export const serviceManager = new ServiceManager();

// Export for health checks
export { ServiceStatus };