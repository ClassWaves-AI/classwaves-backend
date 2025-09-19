/**
 * Analytics Computation Circuit Breaker Service
 * 
 * Platform Stabilization P1 3.1: Implements circuit breakers for analytics computation
 * to prevent cascading failures and provide graceful degradation under load.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

interface CircuitBreakerConfig {
  failureThreshold: number;
  timeout: number; // Reset timeout in ms
  monitoringWindow: number; // Window for failure rate calculation in ms
  minimumRequests: number; // Minimum requests before opening circuit
}

interface CircuitBreakerMetrics {
  requestCount: number;
  successCount: number;
  failureCount: number;
  consecutiveFailures: number;
  lastFailureTime: number;
  lastSuccessTime: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  stateChangedAt: number;
}

export class AnalyticsComputationCircuitBreaker extends EventEmitter {
  private metrics: CircuitBreakerMetrics = {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    consecutiveFailures: 0,
    lastFailureTime: 0,
    lastSuccessTime: 0,
    state: 'CLOSED',
    stateChangedAt: Date.now()
  };

  private readonly config: CircuitBreakerConfig;
  private readonly serviceName: string;

  constructor(serviceName: string, config?: Partial<CircuitBreakerConfig>) {
    super();
    
    this.serviceName = serviceName;
    this.config = {
      failureThreshold: config?.failureThreshold || 5,
      timeout: config?.timeout || 60000, // 1 minute
      monitoringWindow: config?.monitoringWindow || 600000, // 10 minutes
      minimumRequests: config?.minimumRequests || 10
    };

    logger.debug(`🔧 Analytics Circuit Breaker initialized for ${serviceName}`, this.config);
  }

  /**
   * Execute operation with circuit breaker protection
   */
  async execute<T>(
    operation: () => Promise<T>, 
    operationId: string,
    metadata?: Record<string, any>
  ): Promise<T> {
    const startTime = Date.now();
    
    // Check if circuit should be opened or reset
    this.updateStateIfNeeded();
    
    if (this.metrics.state === 'OPEN') {
      const error = new Error(`Analytics circuit breaker is OPEN for ${this.serviceName}. Service temporarily unavailable due to repeated failures.`);
      this.recordFailure(operationId, startTime, error, metadata);
      throw error;
    }

    this.metrics.requestCount++;
    logger.debug(`⚡ Circuit Breaker: Executing ${operationId} (state: ${this.metrics.state}, attempt: ${this.metrics.requestCount})`);

    try {
      const result = await Promise.race([
        operation(),
        this.createTimeoutPromise(operationId)
      ]);

      this.recordSuccess(operationId, startTime, metadata);
      return result as T;

    } catch (error) {
      this.recordFailure(operationId, startTime, error as Error, metadata);
      throw error;
    }
  }

  /**
   * Create timeout promise for operation timeout protection
   */
  private createTimeoutPromise<T>(operationId: string): Promise<T> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Analytics operation timeout: ${operationId} exceeded ${this.config.timeout}ms`));
      }, this.config.timeout);
    });
  }

  /**
   * Record successful operation execution
   */
  private recordSuccess(operationId: string, startTime: number, metadata?: Record<string, any>): void {
    const duration = Date.now() - startTime;
    
    this.metrics.successCount++;
    this.metrics.consecutiveFailures = 0;
    this.metrics.lastSuccessTime = Date.now();

    // If we're in HALF_OPEN state and operation succeeded, close the circuit
    if (this.metrics.state === 'HALF_OPEN') {
      this.transitionTo('CLOSED', 'Successful operation in HALF_OPEN state');
    }

    logger.debug(`✅ Circuit Breaker Success: ${operationId} completed in ${duration}ms`);
    
    this.emit('success', {
      serviceName: this.serviceName,
      operationId,
      duration,
      metadata,
      state: this.metrics.state
    });
  }

  /**
   * Record failed operation execution
   */
  private recordFailure(operationId: string, startTime: number, error: Error, metadata?: Record<string, any>): void {
    const duration = Date.now() - startTime;
    
    this.metrics.failureCount++;
    this.metrics.consecutiveFailures++;
    this.metrics.lastFailureTime = Date.now();

    logger.error(`❌ Circuit Breaker Failure: ${operationId} failed after ${duration}ms`, {
      error: error.message,
      consecutiveFailures: this.metrics.consecutiveFailures,
      state: this.metrics.state,
      metadata
    });

    // Check if we should open the circuit
    if (this.shouldOpenCircuit()) {
      this.transitionTo('OPEN', `Failure threshold reached: ${this.metrics.consecutiveFailures} consecutive failures`);
    }

    this.emit('failure', {
      serviceName: this.serviceName,
      operationId,
      duration,
      error: error.message,
      consecutiveFailures: this.metrics.consecutiveFailures,
      metadata,
      state: this.metrics.state
    });
  }

  /**
   * Check if circuit should be opened based on failure threshold
   */
  private shouldOpenCircuit(): boolean {
    // Only consider opening if we have minimum requests
    if (this.metrics.requestCount < this.config.minimumRequests) {
      return false;
    }

    // Open if consecutive failures exceed threshold
    if (this.metrics.consecutiveFailures >= this.config.failureThreshold) {
      return true;
    }

    // Calculate failure rate in monitoring window
    const windowStart = Date.now() - this.config.monitoringWindow;
    if (this.metrics.lastFailureTime > windowStart) {
      const recentFailureRate = this.metrics.failureCount / this.metrics.requestCount;
      return recentFailureRate >= (this.config.failureThreshold / this.config.minimumRequests);
    }

    return false;
  }

  /**
   * Update circuit state based on timeout and current conditions
   */
  private updateStateIfNeeded(): void {
    const now = Date.now();
    
    if (this.metrics.state === 'OPEN') {
      const timeSinceStateChange = now - this.metrics.stateChangedAt;
      
      if (timeSinceStateChange >= this.config.timeout) {
        this.transitionTo('HALF_OPEN', 'Timeout period elapsed, allowing test requests');
      }
    }
  }

  /**
   * Transition circuit breaker to new state
   */
  private transitionTo(newState: CircuitBreakerMetrics['state'], reason: string): void {
    const oldState = this.metrics.state;
    this.metrics.state = newState;
    this.metrics.stateChangedAt = Date.now();

    logger.debug(`🔄 Circuit Breaker State Transition: ${this.serviceName} ${oldState} → ${newState} (${reason})`);

    // Reset metrics on state transitions
    if (newState === 'CLOSED') {
      this.metrics.consecutiveFailures = 0;
      this.metrics.requestCount = 0;
      this.metrics.successCount = 0;
      this.metrics.failureCount = 0;
    }

    this.emit('stateChange', {
      serviceName: this.serviceName,
      oldState,
      newState,
      reason,
      timestamp: this.metrics.stateChangedAt,
      metrics: { ...this.metrics }
    });
  }

  /**
   * Get current circuit breaker status and metrics
   */
  getStatus(): {
    serviceName: string;
    state: string;
    metrics: CircuitBreakerMetrics;
    config: CircuitBreakerConfig;
    healthStatus: 'healthy' | 'degraded' | 'unhealthy';
  } {
    let healthStatus: 'healthy' | 'degraded' | 'unhealthy';
    
    if (this.metrics.state === 'CLOSED') {
      healthStatus = this.metrics.consecutiveFailures > 0 ? 'degraded' : 'healthy';
    } else if (this.metrics.state === 'HALF_OPEN') {
      healthStatus = 'degraded';
    } else {
      healthStatus = 'unhealthy';
    }

    return {
      serviceName: this.serviceName,
      state: this.metrics.state,
      metrics: { ...this.metrics },
      config: { ...this.config },
      healthStatus
    };
  }

  /**
   * Manually reset circuit breaker (for admin/debugging purposes)
   */
  reset(reason: string = 'Manual reset'): void {
    logger.debug(`🔧 Circuit Breaker Manual Reset: ${this.serviceName} (${reason})`);
    
    this.metrics = {
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      lastFailureTime: 0,
      lastSuccessTime: 0,
      state: 'CLOSED',
      stateChangedAt: Date.now()
    };

    this.emit('reset', {
      serviceName: this.serviceName,
      reason,
      timestamp: Date.now()
    });
  }
}

/**
 * Global circuit breaker instance for analytics computation
 */
export const analyticsComputationCircuitBreaker = new AnalyticsComputationCircuitBreaker(
  'analytics-computation',
  {
    failureThreshold: 5,
    timeout: 120000, // 2 minutes for analytics operations
    monitoringWindow: 900000, // 15 minutes monitoring window
    minimumRequests: 3 // Lower threshold for analytics operations
  }
);

// Set up monitoring and health reporting
analyticsComputationCircuitBreaker.on('stateChange', (event) => {
  if (event.newState === 'OPEN') {
    logger.error(`🚨 ANALYTICS CIRCUIT BREAKER OPENED: ${event.reason}`);
    // In production, this would trigger alerts/notifications
  } else if (event.newState === 'CLOSED' && event.oldState === 'OPEN') {
    logger.debug(`🎉 ANALYTICS CIRCUIT BREAKER RECOVERED: Service operational again`);
  }
});

analyticsComputationCircuitBreaker.on('failure', (event) => {
  if (event.consecutiveFailures >= 3) {
    logger.warn(`⚠️ ANALYTICS SERVICE DEGRADED: ${event.consecutiveFailures} consecutive failures for ${event.serviceName}`);
  }
});