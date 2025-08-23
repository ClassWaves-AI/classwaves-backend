import { Request, Response, NextFunction } from 'express';
import { databricksService } from '../services/databricks.service';
import { redisService } from '../services/redis.service';

interface ErrorLogContext {
  timestamp: string;
  requestId: string;
  endpoint: string;
  method: string;
  userId?: string;
  sessionId?: string;
  schoolId?: string;
  requestBody?: any;
  queryParams?: any;
  headers?: any;
  error: {
    message: string;
    stack: string;
    code?: string;
    details?: any;
  };
  systemStatus: {
    redis: boolean;
    databricks: boolean;
    memory: NodeJS.MemoryUsage;
    uptime: number;
  };
  databaseQueries?: string[];
  responseTime?: number;
}

class ErrorLoggingMiddleware {
  private static instance: ErrorLoggingMiddleware;
  private errorLogs: ErrorLogContext[] = [];
  private maxLogs = 1000;

  static getInstance(): ErrorLoggingMiddleware {
    if (!ErrorLoggingMiddleware.instance) {
      ErrorLoggingMiddleware.instance = new ErrorLoggingMiddleware();
    }
    return ErrorLoggingMiddleware.instance;
  }

  private async checkSystemHealth(): Promise<{ redis: boolean; databricks: boolean }> {
    const health = { redis: false, databricks: false };

    try {
      // Check Redis
      await redisService.ping();
      health.redis = true;
    } catch (error) {
      console.warn('⚠️ Redis health check failed:', error);
    }

    try {
      // Check Databricks
      await databricksService.query('SELECT 1 as health_check');
      health.databricks = true;
    } catch (error) {
      console.warn('⚠️ Databricks health check failed:', error);
    }

    return health;
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private sanitizeData(data: any): any {
    if (!data) return data;
    
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];
    const sanitized = { ...data };
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  async logError(
    error: Error,
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      const systemHealth = await this.checkSystemHealth();
      
      const errorContext: ErrorLogContext = {
        timestamp: new Date().toISOString(),
        requestId: this.generateRequestId(),
        endpoint: req.path,
        method: req.method,
        userId: (req as any).user?.id,
        sessionId: req.params.sessionId || (req.query.sessionId as string),
        schoolId: (req as any).user?.school_id,
        requestBody: this.sanitizeData(req.body),
        queryParams: this.sanitizeData(req.query),
        headers: this.sanitizeData(req.headers),
        error: {
          message: error.message,
          stack: error.stack || '',
          code: (error as any).code,
          details: (error as any).details || {}
        },
        systemStatus: {
          redis: systemHealth.redis,
          databricks: systemHealth.databricks,
          memory: process.memoryUsage(),
          uptime: process.uptime()
        },
        responseTime: Date.now() - startTime
      };

      // Add to in-memory logs
      this.errorLogs.push(errorContext);
      if (this.errorLogs.length > this.maxLogs) {
        this.errorLogs.shift();
      }

      // Log to console with structured format
      console.error('🚨 ERROR LOG:', JSON.stringify(errorContext, null, 2));

      // Log to file for persistence
      this.persistErrorLog(errorContext);

    } catch (loggingError) {
      console.error('⚠️ Error logging failed:', loggingError);
    }

    next(error);
  }

  private async persistErrorLog(errorContext: ErrorLogContext): Promise<void> {
    try {
      // Store in Redis for real-time monitoring
      await redisService.set(
        `error_log:${errorContext.requestId}`,
        JSON.stringify(errorContext),
        86400 // 24 hours
      );

      // Store in database for long-term analysis
      await databricksService.upsert(
        'operational.system_events',
        { 
          id: errorContext.requestId,
          event_type: 'api_error',
          severity: 'error',
          component: 'teacher_guidance_api',
          message: errorContext.error.message,
          error_details: JSON.stringify(errorContext),
          session_id: errorContext.sessionId,
          user_id: errorContext.userId,
          school_id: errorContext.schoolId,
          created_at: new Date()
        },
        { id: errorContext.requestId }
      );

    } catch (persistError) {
      console.warn('⚠️ Failed to persist error log:', persistError);
    }
  }

  getErrorLogs(): ErrorLogContext[] {
    return [...this.errorLogs];
  }

  getErrorSummary(): {
    totalErrors: number;
    errorsByEndpoint: Record<string, number>;
    errorsByType: Record<string, number>;
    recentErrors: ErrorLogContext[];
  } {
    const summary = {
      totalErrors: this.errorLogs.length,
      errorsByEndpoint: {} as Record<string, number>,
      errorsByType: {} as Record<string, number>,
      recentErrors: this.errorLogs.slice(-10)
    };

    this.errorLogs.forEach(log => {
      // Count by endpoint
      summary.errorsByEndpoint[log.endpoint] = (summary.errorsByEndpoint[log.endpoint] || 0) + 1;
      
      // Count by error type
      const errorType = log.error.code || 'unknown';
      summary.errorsByType[errorType] = (summary.errorsByType[errorType] || 0) + 1;
    });

    return summary;
  }

  clearLogs(): void {
    this.errorLogs = [];
  }
}

export const errorLoggingMiddleware = ErrorLoggingMiddleware.getInstance();
export const errorLoggingHandler = (error: Error, req: Request, res: Response, next: NextFunction) => {
  errorLoggingMiddleware.logError(error, req, res, next);
};
