/**
 * Real-Time Analytics Cache Service Unit Tests
 * 
 * Tests the cache synchronization and logging functionality
 */

import { RealTimeAnalyticsCacheService } from '../../../services/real-time-analytics-cache.service';
import { redisService } from '../../../services/redis.service';
import { databricksService } from '../../../services/databricks.service';
import { analyticsLogger } from '../../../utils/analytics-logger';

// Mock dependencies
jest.mock('../../../services/redis.service');
jest.mock('../../../services/databricks.service');
jest.mock('../../../utils/analytics-logger');

const mockRedisService = redisService as jest.Mocked<typeof redisService>;
const mockDatabricksService = databricksService as jest.Mocked<typeof databricksService>;
const mockAnalyticsLogger = analyticsLogger as jest.Mocked<typeof analyticsLogger>;

describe('RealTimeAnalyticsCacheService', () => {
  let service: RealTimeAnalyticsCacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RealTimeAnalyticsCacheService();
  });

  describe('syncCacheToDatabriks', () => {
    it('should sync active session caches and log with proper context', async () => {
      // Mock the private getActiveSessionCacheKeys method
      const mockGetKeys = jest.spyOn(service as any, 'getActiveSessionCacheKeys')
        .mockResolvedValue([
          'analytics:session:session-123',
          'analytics:session:session-456'
        ]);
      
      // Mock Redis get to return valid session data
      mockRedisService.get
        .mockResolvedValueOnce(JSON.stringify({
          sessionId: 'session-123',
          totalParticipants: 25,
          activeGroups: 5,
          averageEngagement: 0.85,
          averageParticipation: 0.92,
          lastUpdate: new Date().toISOString()
        }))
        .mockResolvedValueOnce(JSON.stringify({
          sessionId: 'session-456',
          totalParticipants: 30,
          activeGroups: 6,
          averageEngagement: 0.78,
          averageParticipation: 0.88,
          lastUpdate: new Date().toISOString()
        }));
      
      // Mock Databricks upsert
      mockDatabricksService.upsert.mockResolvedValue(undefined);
      
      // Mock Redis del for cleanup
      mockRedisService.del.mockResolvedValue(1);
      
      await service.syncCacheToDatabriks();
      
      // Verify the private method was called
      expect(mockGetKeys).toHaveBeenCalled();
      
      // Verify individual session sync logging
      expect(mockAnalyticsLogger.logOperation).toHaveBeenCalledWith(
        'session_cache_sync_attempt',
        'session_analytics',
        expect.any(Number),
        true,
        expect.objectContaining({
          sessionId: 'session-123',
          recordCount: 1,
          metadata: expect.objectContaining({
            cacheKey: 'analytics:session:session-123'
          })
        })
      );
      
      // Verify successful sync logging
      expect(mockAnalyticsLogger.logOperation).toHaveBeenCalledWith(
        'session_cache_sync_success',
        'session_analytics',
        expect.any(Number),
        true,
        expect.objectContaining({
          sessionId: 'session-123',
          recordCount: 1,
          metadata: expect.objectContaining({
            participants: 25,
            activeGroups: 5
          })
        })
      );
      
      // Verify batch completion logging with proper context
      expect(mockAnalyticsLogger.logOperation).toHaveBeenCalledWith(
        'cache_sync_to_databricks',
        'session_analytics',
        expect.any(Number),
        true,
        expect.objectContaining({
          sessionId: 'batch_sync',
          recordCount: 2,
          metadata: expect.objectContaining({
            sessionsSynced: 2,
            totalSessions: 2,
            failedSessions: 0,
            successRate: 100
          })
        })
      );
      
      // Verify Databricks upsert was called for both sessions
      expect(mockDatabricksService.upsert).toHaveBeenCalledTimes(2);
      
      // Clean up
      mockGetKeys.mockRestore();
    });

    it('should handle failed session syncs and log errors with context', async () => {
      // Mock the private getActiveSessionCacheKeys method
      const mockGetKeys = jest.spyOn(service as any, 'getActiveSessionCacheKeys')
        .mockResolvedValue(['analytics:session:session-123']);
      
      // Mock Redis get to return valid session data
      mockRedisService.get.mockResolvedValue(JSON.stringify({
        sessionId: 'session-123',
        totalParticipants: 25,
        activeGroups: 5,
        averageEngagement: 0.85,
        averageParticipation: 0.92,
        lastUpdate: new Date().toISOString()
      }));
      
      // Mock Databricks upsert to fail
      mockDatabricksService.upsert.mockRejectedValue(new Error('Database connection failed'));
      
      await service.syncCacheToDatabriks();
      
      // Verify error logging with proper context
      expect(mockAnalyticsLogger.logOperation).toHaveBeenCalledWith(
        'session_cache_sync_failed',
        'session_analytics',
        expect.any(Number),
        false,
        expect.objectContaining({
          sessionId: 'session-123',
          recordCount: 0,
          error: 'Database connection failed',
          metadata: expect.objectContaining({
            cacheKey: 'analytics:session:session-123',
            errorType: 'Error'
          })
        })
      );
      
      // Verify batch completion logging shows failed sessions
      expect(mockAnalyticsLogger.logOperation).toHaveBeenCalledWith(
        'cache_sync_to_databricks',
        'session_analytics',
        expect.any(Number),
        true,
        expect.objectContaining({
          sessionId: 'batch_sync',
          recordCount: 0,
          metadata: expect.objectContaining({
            sessionsSynced: 0,
            totalSessions: 1,
            failedSessions: 1,
            failedSessionIds: ['session-123'],
            successRate: 0
          })
        })
      );
      
      // Clean up
      mockGetKeys.mockRestore();
    });

    it('should handle no active sessions gracefully', async () => {
      // Mock the private getActiveSessionCacheKeys method
      const mockGetKeys = jest.spyOn(service as any, 'getActiveSessionCacheKeys')
        .mockResolvedValue([]);
      
      await service.syncCacheToDatabriks();
      
      // Verify batch completion logging for empty sync
      expect(mockAnalyticsLogger.logOperation).toHaveBeenCalledWith(
        'cache_sync_to_databricks',
        'session_analytics',
        expect.any(Number),
        true,
        expect.objectContaining({
          sessionId: 'batch_sync',
          recordCount: 0,
          metadata: expect.objectContaining({
            sessionsSynced: 0,
            totalSessions: 0,
            failedSessions: 0,
            successRate: 0
          })
        })
      );
      
      // Clean up
      mockGetKeys.mockRestore();
    });
  });

  describe('invalidateSessionCache', () => {
    it('should properly invalidate session cache and log operation', async () => {
      const sessionId = 'session-123';
      const cacheKey = `analytics:session:${sessionId}`;
      
      // Mock Redis to return existing cache data
      mockRedisService.get.mockResolvedValue(JSON.stringify({
        sessionId,
        totalParticipants: 25,
        activeGroups: 5
      }));
      
      // Mock Redis del
      mockRedisService.del.mockResolvedValue(1);
      
      await service.invalidateSessionCache(sessionId);
      
      // Verify cache invalidation logging
      expect(mockAnalyticsLogger.logOperation).toHaveBeenCalledWith(
        'session_cache_invalidated',
        'redis_cache',
        expect.any(Number),
        true,
        expect.objectContaining({
          sessionId,
          recordCount: 1,
          metadata: expect.objectContaining({
            cacheKey,
            invalidationReason: 'session_completed'
          })
        })
      );
      
      // Verify Redis del was called
      expect(mockRedisService.del).toHaveBeenCalledWith(cacheKey);
    });

    it('should handle non-existent cache gracefully', async () => {
      const sessionId = 'session-123';
      
      // Mock Redis to return no data
      mockRedisService.get.mockResolvedValue(null);
      
      await service.invalidateSessionCache(sessionId);
      
      // Verify no logging for non-existent cache
      expect(mockAnalyticsLogger.logOperation).not.toHaveBeenCalled();
      
      // Verify Redis del was not called
      expect(mockRedisService.del).not.toHaveBeenCalled();
    });
  });

  describe('triggerManualCacheSync', () => {
    it('should trigger manual cache sync and return results', async () => {
      // Mock the syncCacheToDatabriks method
      const mockSync = jest.spyOn(service, 'syncCacheToDatabriks').mockResolvedValue();
      
      // Mock getActiveSessionCacheKeys to return some keys
      const mockGetKeys = jest.spyOn(service as any, 'getActiveSessionCacheKeys')
        .mockResolvedValue(['key1', 'key2']);
      
      const result = await service.triggerManualCacheSync();
      
      expect(mockSync).toHaveBeenCalled();
      expect(mockGetKeys).toHaveBeenCalled();
      expect(result).toEqual({
        success: true,
        sessionsProcessed: 2,
        sessionsSynced: 2,
        failedSessions: 0,
        duration: expect.any(Number)
      });
      
      mockSync.mockRestore();
      mockGetKeys.mockRestore();
    });

    it('should handle sync failures gracefully', async () => {
      // Mock the syncCacheToDatabriks method to fail
      const mockSync = jest.spyOn(service, 'syncCacheToDatabriks')
        .mockRejectedValue(new Error('Sync failed'));
      
      const result = await service.triggerManualCacheSync();
      
      expect(result).toEqual({
        success: false,
        sessionsProcessed: 0,
        sessionsSynced: 0,
        failedSessions: 0,
        duration: expect.any(Number)
      });
      
      mockSync.mockRestore();
    });
  });
});
