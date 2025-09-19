import { logger } from '../utils/logger';
/**
 * RetryService - Phase 3 Implementation
 * 
 * Provides intelligent retry logic with:
 * - Exponential backoff with jitter
 * - Smart error classification (retryable vs non-retryable)
 * - Specialized retry strategies for different service types
 * - Comprehensive logging and metrics
 */

export interface RetryOptions {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  exponentialBase: number;
  jitter: boolean;
  retryCondition?: (error: any) => boolean;
  timeoutMs?: number;
}

export interface RetryContext {
  operation: string;
  attempt: number;
  maxRetries: number;
  delay: number;
  error?: Error;
}

export class RetryService {
  private static readonly DEFAULT_OPTIONS: RetryOptions = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    exponentialBase: 2,
    jitter: true,
    timeoutMs: 30000
  };

  private static metrics = {
    totalAttempts: 0,
    successfulRetries: 0,
    failedRetries: 0,
    operationCounts: new Map<string, number>()
  };

  /**
   * RELIABILITY 1: Intelligent retry with exponential backoff and jitter
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    const config = { ...this.DEFAULT_OPTIONS, ...options };
    let lastError: Error;
    const startTime = performance.now();

    logger.debug(`🔄 Starting retry operation: ${operationName} (max retries: ${config.maxRetries})`);

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      const context: RetryContext = {
        operation: operationName,
        attempt,
        maxRetries: config.maxRetries,
        delay: 0
      };

      try {
        this.metrics.totalAttempts++;
        this.updateOperationCount(operationName);

        // Add timeout wrapper if specified
        let result: T;
        if (config.timeoutMs) {
          result = await this.withTimeout(operation, config.timeoutMs, operationName);
        } else {
          result = await operation();
        }

        const totalTime = performance.now() - startTime;
        
        if (attempt > 0) {
          this.metrics.successfulRetries++;
          logger.debug(`✅ Retry operation succeeded: ${operationName} after ${attempt} retries (${totalTime.toFixed(2)}ms)`);
        } else {
          logger.debug(`✅ Operation succeeded on first attempt: ${operationName} (${totalTime.toFixed(2)}ms)`);
        }

        return result;

      } catch (error) {
        lastError = error as Error;
        context.error = lastError;

        if (attempt === config.maxRetries) {
          this.metrics.failedRetries++;
          const totalTime = performance.now() - startTime;
          logger.error(`❌ Operation failed after ${config.maxRetries + 1} attempts: ${operationName} (${totalTime.toFixed(2)}ms)`, error);
          throw error;
        }

        // RELIABILITY 2: Smart retry decision
        if (config.retryCondition && !config.retryCondition(error)) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.debug(`⏭️ Error not retryable (custom condition), failing immediately: ${operationName}`, errorMessage);
          throw error;
        }

        if (!this.isRetryableError(error)) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          logger.debug(`⏭️ Non-retryable error, failing immediately: ${operationName}`, errorMessage);
          throw error;
        }

        const delay = this.calculateDelay(attempt, config);
        context.delay = delay;

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.warn(`⚠️ Retrying operation "${operationName}" in ${delay}ms (attempt ${attempt + 1}/${config.maxRetries + 1})`, {
          error: errorMessage,
          attempt: attempt + 1,
          delay
        });

        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  /**
   * RELIABILITY 3: Add timeout wrapper to operations
   */
  private static async withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`Operation "${operationName}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      (t as any).unref?.();
    });

    return Promise.race([operation(), timeoutPromise]);
  }

  /**
   * RELIABILITY 4: Intelligent error classification
   */
  private static isRetryableError(error: any): boolean {
    // Network errors - always retryable
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') return true;
    if (error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH') return true;

    // HTTP errors
    if (error.status || error.response?.status) {
      const status = error.status || error.response?.status;
      
      // Server errors (5xx) - retryable
      if (status >= 500 && status < 600) return true;
      
      // Rate limiting (429) - retryable
      if (status === 429) return true;
      
      // Request timeout (408) - retryable
      if (status === 408) return true;
      
      // Service unavailable (503) - retryable
      if (status === 503) return true;
      
      // Bad gateway (502, 504) - retryable
      if (status === 502 || status === 504) return true;
      
      // Client errors (4xx except special cases) - not retryable
      if (status >= 400 && status < 500) {
        // Don't retry authentication/authorization errors
        if (status === 401 || status === 403) return false;
        // Don't retry validation errors
        if (status === 400 || status === 422) return false;
        // Don't retry not found errors
        if (status === 404) return false;
        // Other 4xx might be retryable
        return true;
      }
    }

    // Message-based detection
    const message = error.message?.toLowerCase() || '';
    
    // Timeout errors - retryable
    if (message.includes('timeout')) return true;
    if (message.includes('timed out')) return true;
    
    // Network/connection errors - retryable
    if (message.includes('network')) return true;
    if (message.includes('connection')) return true;
    if (message.includes('socket')) return true;
    if (message.includes('reset')) return true;
    
    // Database errors - retryable
    if (message.includes('database connection')) return true;
    if (message.includes('connection pool')) return true;
    if (message.includes('deadlock')) return true;
    if (message.includes('lock timeout')) return true;
    
    // Redis errors - retryable
    if (message.includes('redis connection')) return true;
    if (message.includes('redis timeout')) return true;
    
    // Service-specific errors
    if (message.includes('service unavailable')) return true;
    if (message.includes('temporarily unavailable')) return true;
    if (message.includes('rate limit')) return true;
    
    // Google OAuth specific
    if (message.includes('google')) {
      // Authentication errors are not retryable
      if (message.includes('invalid') || message.includes('unauthorized')) return false;
      // Other Google errors might be retryable
      return true;
    }

    // Circuit breaker errors - not immediately retryable
    if (message.includes('circuit breaker is open')) return false;
    if (message.includes('circuit breaker')) return false;

    // Validation/input errors - not retryable
    if (message.includes('validation')) return false;
    if (message.includes('invalid input')) return false;
    if (message.includes('malformed')) return false;

    // Default to not retryable for unknown errors
    return false;
  }

  /**
   * RELIABILITY 5: Exponential backoff with jitter
   */
  private static calculateDelay(attempt: number, options: RetryOptions): number {
    const exponentialDelay = options.baseDelay * Math.pow(options.exponentialBase, attempt);
    const delayWithCap = Math.min(exponentialDelay, options.maxDelay);

    if (options.jitter) {
      // Add random jitter to prevent thundering herd
      const jitterRange = delayWithCap * 0.1;
      const jitter = (Math.random() * 2 - 1) * jitterRange;
      return Math.max(0, delayWithCap + jitter);
    }

    return delayWithCap;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * RELIABILITY 6: Specialized retry for database operations
   */
  static async retryDatabaseOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return this.withRetry(operation, `Database:${operationName}`, {
      maxRetries: 3,
      baseDelay: 500,
      maxDelay: 5000,
      timeoutMs: 30000,
      retryCondition: (error) => {
        // Don't retry authentication errors or validation errors
        if (error.status === 401 || error.status === 403) return false;
        if (error.message?.includes('validation')) return false;
        if (error.message?.includes('unauthorized')) return false;
        
        // Do retry connection and timeout errors
        if (error.message?.includes('connection')) return true;
        if (error.message?.includes('timeout')) return true;
        if (error.message?.includes('deadlock')) return true;
        
        return true;
      }
    });
  }

  /**
   * RELIABILITY 7: Specialized retry for external API calls
   */
  static async retryExternalAPI<T>(
    operation: () => Promise<T>,
    apiName: string
  ): Promise<T> {
    return this.withRetry(operation, `ExternalAPI:${apiName}`, {
      maxRetries: 2, // Fewer retries for external APIs
      baseDelay: 1000,
      maxDelay: 8000,
      timeoutMs: 15000,
      retryCondition: (error) => {
        // Don't retry client errors (4xx) except rate limiting
        const status = error.status || error.response?.status;
        if (status >= 400 && status < 500 && status !== 429) return false;
        
        // Don't retry authentication failures
        if (error.message?.includes('authentication') || error.message?.includes('unauthorized')) return false;
        
        return true;
      }
    });
  }

  /**
   * RELIABILITY 8: Specialized retry for Redis operations
   */
  static async retryRedisOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return this.withRetry(operation, `Redis:${operationName}`, {
      maxRetries: 2, // Quick retries for Redis
      baseDelay: 200,
      maxDelay: 1000,
      timeoutMs: 5000,
      retryCondition: (error) => {
        // Retry connection and timeout errors
        if (error.message?.includes('connection')) return true;
        if (error.message?.includes('timeout')) return true;
        if (error.message?.includes('redis')) return true;
        
        // Don't retry command errors (malformed commands, etc.)
        if (error.message?.includes('wrong number of arguments')) return false;
        if (error.message?.includes('unknown command')) return false;
        
        return true;
      }
    });
  }

  /**
   * RELIABILITY 9: Specialized retry for Google OAuth
   */
  static async retryGoogleOAuth<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    return this.withRetry(operation, `GoogleOAuth:${operationName}`, {
      maxRetries: 2,
      baseDelay: 1000,
      maxDelay: 5000,
      timeoutMs: 10000,
      retryCondition: (error) => {
        // Don't retry authentication/authorization errors
        if (error.message?.includes('invalid')) return false;
        if (error.message?.includes('unauthorized')) return false;
        if (error.message?.includes('forbidden')) return false;
        if (error.status === 401 || error.status === 403) return false;
        
        // Retry network and timeout errors
        if (error.message?.includes('timeout')) return true;
        if (error.message?.includes('network')) return true;
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
        
        return true;
      }
    });
  }

  /**
   * RELIABILITY 10: Retry with custom circuit breaker integration
   */
  static async retryWithCircuitBreaker<T>(
    operation: () => Promise<T>,
    circuitBreaker: any,
    operationName: string,
    options: Partial<RetryOptions> = {}
  ): Promise<T> {
    return this.withRetry(async () => {
      if (circuitBreaker.opened) {
        throw new Error(`Circuit breaker is open for ${operationName}`);
      }
      return await operation();
    }, operationName, {
      ...options,
      retryCondition: (error) => {
        // Don't retry if circuit breaker is open
        if (error.message?.includes('circuit breaker is open')) return false;
        
        // Use custom condition if provided, otherwise use default logic
        if (options.retryCondition) {
          return options.retryCondition(error);
        }
        
        return this.isRetryableError(error);
      }
    });
  }

  /**
   * RELIABILITY 11: Metrics and monitoring
   */
  private static updateOperationCount(operationName: string): void {
    const count = this.metrics.operationCounts.get(operationName) || 0;
    this.metrics.operationCounts.set(operationName, count + 1);
  }

  static getMetrics(): {
    totalAttempts: number;
    successfulRetries: number;
    failedRetries: number;
    successRate: number;
    retryRate: number;
    operationBreakdown: Array<{ operation: string; count: number }>;
  } {
    const totalRetries = this.metrics.successfulRetries + this.metrics.failedRetries;
    const successRate = totalRetries > 0 ? (this.metrics.successfulRetries / totalRetries) * 100 : 100;
    const retryRate = this.metrics.totalAttempts > 0 ? (totalRetries / this.metrics.totalAttempts) * 100 : 0;

    const operationBreakdown = Array.from(this.metrics.operationCounts.entries())
      .map(([operation, count]) => ({ operation, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalAttempts: this.metrics.totalAttempts,
      successfulRetries: this.metrics.successfulRetries,
      failedRetries: this.metrics.failedRetries,
      successRate: Number(successRate.toFixed(2)),
      retryRate: Number(retryRate.toFixed(2)),
      operationBreakdown
    };
  }

  /**
   * RELIABILITY 12: Reset metrics (useful for testing or periodic resets)
   */
  static resetMetrics(): void {
    this.metrics = {
      totalAttempts: 0,
      successfulRetries: 0,
      failedRetries: 0,
      operationCounts: new Map<string, number>()
    };
  }

  /**
   * RELIABILITY 13: Batch retry operations
   */
  static async retryBatch<T>(
    operations: Array<{ operation: () => Promise<T>; name: string; options?: Partial<RetryOptions> }>,
    concurrency: number = 5
  ): Promise<Array<{ success: boolean; result?: T; error?: Error; name: string }>> {
    logger.debug(`🔄 Starting batch retry operations: ${operations.length} operations, concurrency: ${concurrency}`);

    const results: Array<{ success: boolean; result?: T; error?: Error; name: string }> = [];
    
    // Process operations in batches to control concurrency
    for (let i = 0; i < operations.length; i += concurrency) {
      const batch = operations.slice(i, i + concurrency);
      
      const batchResults = await Promise.allSettled(
        batch.map(async ({ operation, name, options }) => {
          try {
            const result = await this.withRetry(operation, name, options);
            return { success: true, result, name };
          } catch (error) {
            return { success: false, error: error as Error, name };
          }
        })
      );

      results.push(...batchResults.map(result => 
        result.status === 'fulfilled' ? result.value : 
        { success: false, error: result.reason, name: 'unknown' }
      ));
    }

    const successCount = results.filter(r => r.success).length;
    logger.debug(`✅ Batch retry operations completed: ${successCount}/${operations.length} successful`);

    return results;
  }

  /**
   * RELIABILITY 14: Health check for retry service
   */
  static getHealthStatus(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    metrics: ReturnType<typeof RetryService.getMetrics>;
    recommendations: string[];
  } {
    const metrics = this.getMetrics();
    const recommendations: string[] = [];
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Analyze retry patterns for health
    if (metrics.retryRate > 50) {
      status = 'degraded';
      recommendations.push('High retry rate detected - investigate underlying service issues');
    }

    if (metrics.successRate < 80) {
      status = 'unhealthy';
      recommendations.push('Low retry success rate - services may be consistently failing');
    }

    if (metrics.totalAttempts === 0) {
      recommendations.push('No retry operations recorded - system may not be under load');
    }

    // Check for problematic operations
    const topFailingOperations = metrics.operationBreakdown
      .filter(op => op.count > 10)
      .slice(0, 3);

    if (topFailingOperations.length > 0) {
      recommendations.push(`High retry operations: ${topFailingOperations.map(op => op.operation).join(', ')}`);
    }

    return {
      status,
      metrics,
      recommendations
    };
  }
}