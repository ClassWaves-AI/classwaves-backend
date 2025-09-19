/**
 * Analytics Logger Unit Tests
 * 
 * Tests the structured logging functionality for analytics operations
 */

import { analyticsLogger, logAnalyticsOperation } from '../../../utils/analytics-logger';

describe('Analytics Logger', () => {
  beforeEach(() => {
    // Clear logs and metrics before each test
    analyticsLogger.cleanup(new Date(0));
  });

  describe('Basic Logging', () => {
    test('should log successful operations', () => {
      const startTime = Date.now() - 100;
      
      analyticsLogger.logOperation('test_operation', 'test_table', startTime, true, {
        sessionId: 'session-123',
        teacherId: 'teacher-456',
        recordCount: 1,
        forceLog: true // Force logging regardless of sampling
      });

      const logs = analyticsLogger.getRecentLogs({ limit: 1 });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        operation: 'test_operation',
        table: 'test_table',
        sessionId: 'session-123',
        teacherId: 'teacher-456',
        recordCount: 1,
        success: true
      });
      expect(logs[0].duration).toBeGreaterThan(50);
    });

    test('should log failed operations with error details', () => {
      const startTime = Date.now() - 200;
      
      analyticsLogger.logOperation('failed_operation', 'test_table', startTime, false, {
        sessionId: 'session-789',
        error: 'Database connection failed',
        metadata: { errorCode: 'CONN_FAILED' },
        forceLog: true
      });

      const logs = analyticsLogger.getRecentLogs({ limit: 1 });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        operation: 'failed_operation',
        table: 'test_table',
        sessionId: 'session-789',
        success: false,
        error: 'Database connection failed',
        metadata: { errorCode: 'CONN_FAILED' }
      });
    });

    test('should apply sampling correctly', () => {
      const startTime = Date.now();
      
      // With 0% sample rate, nothing should be logged
      analyticsLogger.logOperation('sampled_operation', 'test_table', startTime, true, {
        sampleRate: 0.0
      });

      let logs = analyticsLogger.getRecentLogs();
      expect(logs).toHaveLength(0);

      // With 100% sample rate, everything should be logged
      analyticsLogger.logOperation('sampled_operation', 'test_table', startTime, true, {
        sampleRate: 1.0
      });

      logs = analyticsLogger.getRecentLogs();
      expect(logs).toHaveLength(1);
    });
  });

  describe('Performance Metrics', () => {
    test('should track performance metrics correctly', () => {
      const operation = 'performance_test';
      const startTime = Date.now() - 150;
      
      // Log a successful operation
      analyticsLogger.logOperation(operation, 'test_table', startTime, true, {
        forceLog: true
      });

      // Log a failed operation
      analyticsLogger.logOperation(operation, 'test_table', Date.now() - 300, false, {
        error: 'Test error',
        forceLog: true
      });

      const metrics = analyticsLogger.getPerformanceMetrics(operation) as any;
      expect(metrics).toBeDefined();
      expect(metrics.totalOperations).toBe(2);
      expect(metrics.successRate).toBe(0.5);
      expect(metrics.errorRate).toBe(0.5);
      expect(metrics.avgDuration).toBeGreaterThan(0);
    });

    test('should generate comprehensive performance report', () => {
      // Add some test operations
      ['op1', 'op2', 'op3'].forEach(op => {
        analyticsLogger.logOperation(op, 'test_table', Date.now() - 100, true, {
          forceLog: true
        });
      });

      const report = analyticsLogger.generatePerformanceReport();
      
      expect(report.summary.totalOperations).toBe(3);
      expect(report.summary.overallSuccessRate).toBe(1.0);
      expect(report.operationBreakdown).toHaveProperty('op1');
      expect(report.operationBreakdown).toHaveProperty('op2');
      expect(report.operationBreakdown).toHaveProperty('op3');
      expect(Array.isArray(report.recommendations)).toBe(true);
    });

    test('should provide recommendations based on metrics', () => {
      // Create a scenario with poor performance
      analyticsLogger.logOperation('slow_operation', 'test_table', Date.now() - 6000, true, {
        forceLog: true
      });
      analyticsLogger.logOperation('failed_operation', 'test_table', Date.now() - 1000, false, {
        error: 'Test failure',
        forceLog: true
      });

      const report = analyticsLogger.generatePerformanceReport();
      
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations.some(r => r.includes('slow'))).toBe(true);
    });
  });

  describe('Log Filtering and Retrieval', () => {
    beforeEach(() => {
      // Add test data
      const operations = [
        { operation: 'session_create', table: 'sessions', sessionId: 'session-1' },
        { operation: 'analytics_write', table: 'analytics', sessionId: 'session-1' },
        { operation: 'session_create', table: 'sessions', sessionId: 'session-2' },
        { operation: 'audit_log', table: 'audit_logs', sessionId: 'session-1' }
      ];

      operations.forEach(op => {
        analyticsLogger.logOperation(op.operation, op.table, Date.now() - 1000, true, {
          sessionId: op.sessionId,
          forceLog: true
        });
      });
    });

    test('should filter logs by operation', () => {
      const logs = analyticsLogger.getRecentLogs({ operation: 'session_create' });
      expect(logs).toHaveLength(2);
      expect(logs.every(log => log.operation === 'session_create')).toBe(true);
    });

    test('should filter logs by table', () => {
      const logs = analyticsLogger.getRecentLogs({ table: 'sessions' });
      expect(logs).toHaveLength(2);
      expect(logs.every(log => log.table === 'sessions')).toBe(true);
    });

    test('should filter logs by sessionId', () => {
      const logs = analyticsLogger.getRecentLogs({ sessionId: 'session-1' });
      expect(logs).toHaveLength(3);
      expect(logs.every(log => log.sessionId === 'session-1')).toBe(true);
    });

    test('should apply limit correctly', () => {
      const logs = analyticsLogger.getRecentLogs({ limit: 2 });
      expect(logs).toHaveLength(2);
    });
  });

  describe('Wrapper Function', () => {
    test('should wrap successful operations', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      const result = await logAnalyticsOperation(
        'wrapped_test',
        'test_table',
        mockOperation,
        {
          sessionId: 'session-123',
          forceLog: true
        }
      );

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);

      const logs = analyticsLogger.getRecentLogs({ limit: 1 });
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(true);
      expect(logs[0].operation).toBe('wrapped_test');
    });

    test('should wrap failed operations and re-throw errors', async () => {
      const mockError = new Error('Test error');
      const mockOperation = jest.fn().mockRejectedValue(mockError);
      
      await expect(
        logAnalyticsOperation('wrapped_fail_test', 'test_table', mockOperation, {
          sessionId: 'session-456',
          forceLog: true
        })
      ).rejects.toThrow('Test error');

      const logs = analyticsLogger.getRecentLogs({ limit: 1 });
      expect(logs).toHaveLength(1);
      expect(logs[0].success).toBe(false);
      expect(logs[0].error).toBe('Test error');
    });
  });

  describe('Cleanup and Memory Management', () => {
    test('should clean up old entries', () => {
      // Add old entries
      const oldTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      analyticsLogger.logOperation('old_operation', 'test_table', oldTime, true, {
        forceLog: true
      });

      // Add recent entry
      analyticsLogger.logOperation('recent_operation', 'test_table', Date.now() - 1000, true, {
        forceLog: true
      });

      expect(analyticsLogger.getRecentLogs().length).toBe(2);

      // Cleanup entries older than 24 hours
      analyticsLogger.cleanup(new Date(Date.now() - 24 * 60 * 60 * 1000));

      const remainingLogs = analyticsLogger.getRecentLogs();
      expect(remainingLogs.length).toBe(1);
      expect(remainingLogs[0].operation).toBe('recent_operation');
    });

    test('should update sample rate', () => {
      expect(() => analyticsLogger.setSampleRate(0.5)).not.toThrow();
      expect(() => analyticsLogger.setSampleRate(-0.1)).toThrow();
      expect(() => analyticsLogger.setSampleRate(1.1)).toThrow();
    });
  });
});
