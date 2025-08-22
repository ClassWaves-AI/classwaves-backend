/**
 * Analytics Operations Structured Logger
 * 
 * Provides structured logging for analytics write operations with sampling
 * and performance monitoring capabilities.
 */

interface AnalyticsLogEntry {
  timestamp: string;
  operation: string;
  table: string;
  sessionId?: string;
  teacherId?: string;
  recordCount?: number;
  duration: number;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
  sampleRate?: number;
}

interface PerformanceMetrics {
  avgDuration: number;
  maxDuration: number;
  minDuration: number;
  totalOperations: number;
  successRate: number;
  errorRate: number;
  operationsPerMinute: number;
}

class AnalyticsLogger {
  private logEntries: AnalyticsLogEntry[] = [];
  private performanceMetrics: Map<string, PerformanceMetrics> = new Map();
  private readonly MAX_LOG_ENTRIES = 10000;
  private readonly DEFAULT_SAMPLE_RATE = 0.1; // Log 10% of operations by default

  /**
   * Log an analytics write operation with optional sampling
   */
  logOperation(
    operation: string,
    table: string,
    startTime: number,
    success: boolean,
    options: {
      sessionId?: string;
      teacherId?: string;
      recordCount?: number;
      error?: string;
      metadata?: Record<string, any>;
      sampleRate?: number;
      forceLog?: boolean; // Always log regardless of sampling
    } = {}
  ): void {
    const duration = Date.now() - startTime;
    const sampleRate = options.sampleRate ?? this.DEFAULT_SAMPLE_RATE;
    
    // Apply sampling unless forced to log
    if (!options.forceLog && Math.random() > sampleRate) {
      // Still update performance metrics even if not logging details
      this.updatePerformanceMetrics(operation, duration, success);
      return;
    }

    const logEntry: AnalyticsLogEntry = {
      timestamp: new Date().toISOString(),
      operation,
      table,
      sessionId: options.sessionId,
      teacherId: options.teacherId,
      recordCount: options.recordCount,
      duration,
      success,
      error: options.error,
      metadata: options.metadata,
      sampleRate
    };

    // Add to log entries with rotation
    this.logEntries.push(logEntry);
    if (this.logEntries.length > this.MAX_LOG_ENTRIES) {
      this.logEntries.shift(); // Remove oldest entry
    }

    // Update performance metrics
    this.updatePerformanceMetrics(operation, duration, success);

    // Output structured log
    if (success) {
      console.log('📊 Analytics operation completed:', {
        operation,
        table,
        duration: `${duration}ms`,
        sessionId: options.sessionId,
        recordCount: options.recordCount,
        metadata: options.metadata
      });
    } else {
      console.error('❌ Analytics operation failed:', {
        operation,
        table,
        duration: `${duration}ms`,
        error: options.error,
        sessionId: options.sessionId,
        metadata: options.metadata
      });
    }

    // Log performance warnings
    if (duration > 5000) { // Warn if operation takes > 5 seconds
      console.warn('⚠️ Slow analytics operation detected:', {
        operation,
        table,
        duration: `${duration}ms`,
        sessionId: options.sessionId,
        threshold: '5000ms'
      });
    }
  }

  /**
   * Update performance metrics for an operation
   */
  private updatePerformanceMetrics(operation: string, duration: number, success: boolean): void {
    const key = operation;
    const existing = this.performanceMetrics.get(key);

    if (existing) {
      const newTotal = existing.totalOperations + 1;
      const newSuccessCount = success ? 
        Math.round(existing.successRate * existing.totalOperations) + 1 :
        Math.round(existing.successRate * existing.totalOperations);

      this.performanceMetrics.set(key, {
        avgDuration: (existing.avgDuration * existing.totalOperations + duration) / newTotal,
        maxDuration: Math.max(existing.maxDuration, duration),
        minDuration: Math.min(existing.minDuration, duration),
        totalOperations: newTotal,
        successRate: newSuccessCount / newTotal,
        errorRate: (newTotal - newSuccessCount) / newTotal,
        operationsPerMinute: this.calculateOperationsPerMinute(key)
      });
    } else {
      this.performanceMetrics.set(key, {
        avgDuration: duration,
        maxDuration: duration,
        minDuration: duration,
        totalOperations: 1,
        successRate: success ? 1 : 0,
        errorRate: success ? 0 : 1,
        operationsPerMinute: 0 // Will be calculated over time
      });
    }
  }

  /**
   * Calculate operations per minute for a given operation type
   */
  private calculateOperationsPerMinute(operation: string): number {
    const oneMinuteAgo = Date.now() - 60000;
    const recentEntries = this.logEntries.filter(
      entry => entry.operation === operation && 
               new Date(entry.timestamp).getTime() > oneMinuteAgo
    );
    return recentEntries.length;
  }

  /**
   * Get performance metrics for all operations or a specific operation
   */
  getPerformanceMetrics(operation?: string): Map<string, PerformanceMetrics> | PerformanceMetrics | null {
    if (operation) {
      return this.performanceMetrics.get(operation) || null;
    }
    return new Map(this.performanceMetrics);
  }

  /**
   * Get recent log entries with optional filtering
   */
  getRecentLogs(options: {
    operation?: string;
    table?: string;
    sessionId?: string;
    limit?: number;
    since?: Date;
  } = {}): AnalyticsLogEntry[] {
    let filtered = this.logEntries;

    if (options.operation) {
      filtered = filtered.filter(entry => entry.operation === options.operation);
    }
    if (options.table) {
      filtered = filtered.filter(entry => entry.table === options.table);
    }
    if (options.sessionId) {
      filtered = filtered.filter(entry => entry.sessionId === options.sessionId);
    }
    if (options.since) {
      filtered = filtered.filter(entry => new Date(entry.timestamp) >= options.since!);
    }

    // Sort by timestamp (newest first) and apply limit
    filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    if (options.limit) {
      filtered = filtered.slice(0, options.limit);
    }

    return filtered;
  }

  /**
   * Generate a performance report for monitoring
   */
  generatePerformanceReport(): {
    summary: {
      totalOperations: number;
      overallSuccessRate: number;
      averageDuration: number;
      slowOperations: number;
    };
    operationBreakdown: Record<string, PerformanceMetrics>;
    recentErrors: AnalyticsLogEntry[];
    recommendations: string[];
  } {
    const allMetrics = Array.from(this.performanceMetrics.values());
    const totalOps = allMetrics.reduce((sum, m) => sum + m.totalOperations, 0);
    const totalSuccessOps = allMetrics.reduce((sum, m) => sum + (m.successRate * m.totalOperations), 0);
    const avgDuration = allMetrics.reduce((sum, m) => sum + (m.avgDuration * m.totalOperations), 0) / totalOps;
    const slowOps = allMetrics.reduce((sum, m) => sum + (m.avgDuration > 3000 ? m.totalOperations : 0), 0);

    const operationBreakdown: Record<string, PerformanceMetrics> = {};
    for (const [operation, metrics] of Array.from(this.performanceMetrics.entries())) {
      operationBreakdown[operation] = metrics;
    }

    const recentErrors = this.getRecentLogs({ limit: 10 }).filter(entry => !entry.success);

    const recommendations: string[] = [];
    
    // Generate recommendations based on metrics
    if (totalOps > 0 && totalSuccessOps / totalOps < 0.95) {
      recommendations.push('Analytics success rate is below 95% - investigate database connectivity and error patterns');
    }
    if (avgDuration > 2000) {
      recommendations.push('Average analytics operation duration is > 2s - consider optimizing queries or adding indexes');
    }
    if (slowOps / totalOps > 0.1) {
      recommendations.push('More than 10% of operations are slow (>3s) - investigate database performance');
    }
    for (const [operation, metrics] of Array.from(this.performanceMetrics.entries())) {
      if (metrics.operationsPerMinute > 100) {
        recommendations.push(`High frequency detected for ${operation}: ${metrics.operationsPerMinute}/min - consider batching`);
      }
    }

    return {
      summary: {
        totalOperations: totalOps,
        overallSuccessRate: totalOps > 0 ? totalSuccessOps / totalOps : 0,
        averageDuration: avgDuration || 0,
        slowOperations: slowOps
      },
      operationBreakdown,
      recentErrors,
      recommendations
    };
  }

  /**
   * Clear old log entries and reset metrics (for memory management)
   */
  cleanup(olderThan: Date = new Date(Date.now() - 24 * 60 * 60 * 1000)): void {
    const beforeCount = this.logEntries.length;
    this.logEntries = this.logEntries.filter(entry => new Date(entry.timestamp) >= olderThan);
    const afterCount = this.logEntries.length;

    if (beforeCount !== afterCount) {
      console.log(`🧹 Analytics logger cleanup: removed ${beforeCount - afterCount} old entries`);
    }
  }

  /**
   * Set the default sample rate for analytics logging
   */
  setSampleRate(rate: number): void {
    if (rate < 0 || rate > 1) {
      throw new Error('Sample rate must be between 0 and 1');
    }
    (this as any).DEFAULT_SAMPLE_RATE = rate;
    console.log(`📊 Analytics logging sample rate set to ${rate * 100}%`);
  }
}

// Export singleton instance
export const analyticsLogger = new AnalyticsLogger();

// Utility function for wrapping analytics operations with logging
export async function logAnalyticsOperation<T>(
  operation: string,
  table: string,
  operationFn: () => Promise<T>,
  options: {
    sessionId?: string;
    teacherId?: string;
    recordCount?: number;
    metadata?: Record<string, any>;
    sampleRate?: number;
    forceLog?: boolean;
  } = {}
): Promise<T> {
  const startTime = Date.now();
  
  try {
    const result = await operationFn();
    
    analyticsLogger.logOperation(operation, table, startTime, true, {
      ...options,
      metadata: {
        ...options.metadata,
        resultType: typeof result
      }
    });
    
    return result;
  } catch (error) {
    analyticsLogger.logOperation(operation, table, startTime, false, {
      ...options,
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        ...options.metadata,
        errorType: error instanceof Error ? error.constructor.name : typeof error
      }
    });
    
    throw error; // Re-throw the error
  }
}

// Periodic cleanup - run every hour
setInterval(() => {
  analyticsLogger.cleanup();
}, 60 * 60 * 1000);

// Export for debugging in development
if (process.env.NODE_ENV === 'development') {
  (global as any).analyticsLogger = analyticsLogger;
}
