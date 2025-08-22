/**
 * Real-time Analytics Cache Service
 * 
 * Provides Redis-based caching for real-time session analytics to eliminate
 * expensive Databricks queries for frequently accessed session metrics.
 */

import { redisService } from './redis.service';
import { databricksService } from './databricks.service';
import { databricksConfig } from '../config/databricks.config';
import { analyticsLogger } from '../utils/analytics-logger';

interface SessionMetricsCache {
  sessionId: string;
  activeGroups: number;
  readyGroups: number;
  totalParticipants: number;
  averageEngagement: number;
  averageParticipation: number;
  alertsActive: string[];
  lastUpdate: string;
  calculatedAt: string;
}

interface GroupMetricsCache {
  groupId: string;
  sessionId: string;
  isReady: boolean;
  participantCount: number;
  engagementScore: number;
  leaderReady: boolean;
  lastActivity: string;
}

export class RealTimeAnalyticsCacheService {
  private readonly CACHE_TTL = 300; // 5 minutes
  private readonly SESSION_PREFIX = 'analytics:session:';
  private readonly GROUP_PREFIX = 'analytics:group:';
  private readonly TEACHER_PREFIX = 'analytics:teacher:';

  /**
   * Get cached session metrics with fallback to Databricks
   */
  async getSessionMetrics(sessionId: string): Promise<SessionMetricsCache | null> {
    const startTime = Date.now();
    
    try {
      // Try Redis cache first
      const cacheKey = `${this.SESSION_PREFIX}${sessionId}`;
      const cachedData = await redisService.get(cacheKey);
      
      if (cachedData) {
        const metrics = JSON.parse(cachedData) as SessionMetricsCache;
        
        analyticsLogger.logOperation(
          'session_metrics_cache_hit',
          'redis_cache',
          startTime,
          true,
          {
            sessionId,
            metadata: {
              cacheAge: Date.now() - new Date(metrics.lastUpdate).getTime(),
              source: 'redis'
            }
          }
        );
        
        return metrics;
      }

      // Cache miss - fetch from Databricks and cache
      const metrics = await this.fetchAndCacheSessionMetrics(sessionId);
      
      analyticsLogger.logOperation(
        'session_metrics_cache_miss',
        'databricks_query',
        startTime,
        true,
        {
          sessionId,
          metadata: {
            source: 'databricks_fallback',
            cached: metrics !== null
          }
        }
      );
      
      return metrics;
      
    } catch (error) {
      analyticsLogger.logOperation(
        'session_metrics_cache_error',
        'redis_cache',
        startTime,
        false,
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        }
      );
      
      console.error('Failed to get session metrics from cache:', error);
      return null;
    }
  }

  /**
   * Update session metrics in cache (called by WebSocket events)
   */
  async updateSessionMetrics(sessionId: string, updates: Partial<SessionMetricsCache>): Promise<void> {
    const startTime = Date.now();
    
    try {
      const cacheKey = `${this.SESSION_PREFIX}${sessionId}`;
      
      // Get current cached data
      const currentData = await redisService.get(cacheKey);
      let metrics: SessionMetricsCache;
      
      if (currentData) {
        metrics = { ...JSON.parse(currentData), ...updates };
      } else {
        // Create new cache entry
        metrics = {
          sessionId,
          activeGroups: updates.activeGroups || 0,
          readyGroups: updates.readyGroups || 0,
          totalParticipants: updates.totalParticipants || 0,
          averageEngagement: updates.averageEngagement || 0,
          averageParticipation: updates.averageParticipation || 0,
          alertsActive: updates.alertsActive || [],
          lastUpdate: new Date().toISOString(),
          calculatedAt: new Date().toISOString()
        };
      }

      metrics.lastUpdate = new Date().toISOString();
      
      // Update cache
      await redisService.set(cacheKey, JSON.stringify(metrics), this.CACHE_TTL);
      
      analyticsLogger.logOperation(
        'session_metrics_cache_update',
        'redis_cache',
        startTime,
        true,
        {
          sessionId,
          metadata: {
            fieldsUpdated: Object.keys(updates),
            cacheSize: JSON.stringify(metrics).length
          }
        }
      );
      
    } catch (error) {
      analyticsLogger.logOperation(
        'session_metrics_cache_update_failed',
        'redis_cache',
        startTime,
        false,
        {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        }
      );
      
      console.error('Failed to update session metrics cache:', error);
    }
  }

  /**
   * Get cached group metrics
   */
  async getGroupMetrics(groupId: string): Promise<GroupMetricsCache | null> {
    const startTime = Date.now();
    
    try {
      const cacheKey = `${this.GROUP_PREFIX}${groupId}`;
      const cachedData = await redisService.get(cacheKey);
      
      if (cachedData) {
        const metrics = JSON.parse(cachedData) as GroupMetricsCache;
        
        analyticsLogger.logOperation(
          'group_metrics_cache_hit',
          'redis_cache',
          startTime,
          true,
          {
            metadata: { groupId, source: 'redis' }
          }
        );
        
        return metrics;
      }

      // Cache miss - could fetch from Databricks but for real-time data,
      // we prefer to build cache from WebSocket events
      return null;
      
    } catch (error) {
      console.error('Failed to get group metrics from cache:', error);
      return null;
    }
  }

  /**
   * Update group metrics in cache (called by WebSocket events)
   */
  async updateGroupMetrics(groupId: string, sessionId: string, updates: Partial<GroupMetricsCache>): Promise<void> {
    const startTime = Date.now();
    
    try {
      const cacheKey = `${this.GROUP_PREFIX}${groupId}`;
      
      // Get current cached data
      const currentData = await redisService.get(cacheKey);
      let metrics: GroupMetricsCache;
      
      if (currentData) {
        metrics = { ...JSON.parse(currentData), ...updates };
      } else {
        // Create new cache entry
        metrics = {
          groupId,
          sessionId,
          isReady: updates.isReady || false,
          participantCount: updates.participantCount || 0,
          engagementScore: updates.engagementScore || 0,
          leaderReady: updates.leaderReady || false,
          lastActivity: updates.lastActivity || new Date().toISOString()
        };
      }

      metrics.lastActivity = new Date().toISOString();
      
      // Update cache
      await redisService.set(cacheKey, JSON.stringify(metrics), this.CACHE_TTL);
      
      // Also update session-level aggregates
      await this.updateSessionAggregatesFromGroup(sessionId, groupId, metrics);
      
      analyticsLogger.logOperation(
        'group_metrics_cache_update',
        'redis_cache',
        startTime,
        true,
        {
          metadata: {
            groupId,
            sessionId,
            fieldsUpdated: Object.keys(updates)
          }
        }
      );
      
    } catch (error) {
      console.error('Failed to update group metrics cache:', error);
    }
  }

  /**
   * Get teacher's real-time dashboard metrics
   */
  async getTeacherDashboardMetrics(teacherId: string): Promise<{
    activeSessions: number;
    totalActiveStudents: number;
    averageEngagement: number;
    alertsCount: number;
    sessionsData: SessionMetricsCache[];
  }> {
    const startTime = Date.now();
    
    try {
      const cacheKey = `${this.TEACHER_PREFIX}${teacherId}:dashboard`;
      const cachedData = await redisService.get(cacheKey);
      
      if (cachedData) {
        const metrics = JSON.parse(cachedData);
        
        analyticsLogger.logOperation(
          'teacher_dashboard_cache_hit',
          'redis_cache',
          startTime,
          true,
          {
            teacherId,
            metadata: { source: 'redis' }
          }
        );
        
        return metrics;
      }

      // Cache miss - build from individual session caches
      const activeSessions = await this.getActiveSessionsForTeacher(teacherId);
      const sessionsData: SessionMetricsCache[] = [];
      let totalActiveStudents = 0;
      let totalEngagement = 0;
      let alertsCount = 0;

      for (const sessionId of activeSessions) {
        const sessionMetrics = await this.getSessionMetrics(sessionId);
        if (sessionMetrics) {
          sessionsData.push(sessionMetrics);
          totalActiveStudents += sessionMetrics.totalParticipants;
          totalEngagement += sessionMetrics.averageEngagement;
          alertsCount += sessionMetrics.alertsActive.length;
        }
      }

      const dashboardMetrics = {
        activeSessions: activeSessions.length,
        totalActiveStudents,
        averageEngagement: activeSessions.length > 0 ? totalEngagement / activeSessions.length : 0,
        alertsCount,
        sessionsData
      };

      // Cache for 1 minute (shorter TTL for dashboard)
      await redisService.set(cacheKey, JSON.stringify(dashboardMetrics), 60);
      
      analyticsLogger.logOperation(
        'teacher_dashboard_cache_miss',
        'redis_cache',
        startTime,
        true,
        {
          teacherId,
          metadata: {
            source: 'aggregated',
            activeSessions: activeSessions.length,
            cached: true
          }
        }
      );

      return dashboardMetrics;
      
    } catch (error) {
      console.error('Failed to get teacher dashboard metrics:', error);
      
      // Return empty metrics on error
      return {
        activeSessions: 0,
        totalActiveStudents: 0,
        averageEngagement: 0,
        alertsCount: 0,
        sessionsData: []
      };
    }
  }

  /**
   * Invalidate cache when session ends
   */
  async invalidateSessionCache(sessionId: string): Promise<void> {
    const startTime = Date.now();
    
    try {
      const cacheKey = `${this.SESSION_PREFIX}${sessionId}`;
      
      // Check if cache entry exists before deletion
      const existingData = await redisService.get(cacheKey);
      
      if (existingData) {
        // Log cache invalidation with context
        analyticsLogger.logOperation(
          'session_cache_invalidated',
          'redis_cache',
          startTime,
          true,
          {
            sessionId,
            recordCount: 1,
            metadata: {
              cacheKey,
              invalidationReason: 'session_completed',
              cacheSize: existingData.length
            }
          }
        );
        
        // Remove the cache entry completely
        await redisService.del(cacheKey);
        console.log(`🗑️ Invalidated cache for completed session ${sessionId}`);
      } else {
        console.log(`ℹ️ No cache found for session ${sessionId} (already invalidated)`);
      }
    } catch (error) {
      analyticsLogger.logOperation(
        'session_cache_invalidation_failed',
        'redis_cache',
        startTime,
        false,
        {
          sessionId,
          recordCount: 0,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            cacheKey: `${this.SESSION_PREFIX}${sessionId}`,
            errorType: error instanceof Error ? error.constructor.name : typeof error
          }
        }
      );
      
      console.error('Failed to invalidate session cache:', error);
    }
  }

  /**
   * Background sync job to update Databricks with Redis cache data
   */
  async syncCacheToDatabriks(): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log('🔄 Starting cache sync to Databricks...');
      
      // Get all active session cache keys from Redis
      const sessionKeys = await this.getActiveSessionCacheKeys();
      let syncedCount = 0;
      let failedCount = 0;
      const failedSessions: string[] = [];
      
      console.log(`📊 Found ${sessionKeys.length} active session caches to sync`);
      
      for (const key of sessionKeys) {
        try {
          const cachedData = await redisService.get(key);
          if (cachedData) {
            const metrics = JSON.parse(cachedData) as SessionMetricsCache;
            
            // Log individual session sync attempt
            analyticsLogger.logOperation(
              'session_cache_sync_attempt',
              'session_analytics',
              Date.now(),
              true,
              {
                sessionId: metrics.sessionId,
                recordCount: 1,
                metadata: {
                  cacheKey: key,
                  cacheAge: Date.now() - new Date(metrics.lastUpdate).getTime(),
                  metricsFields: Object.keys(metrics)
                }
              }
            );
            
            // Update session_analytics table with real-time data
            await databricksService.upsert(
              'session_analytics',
              { session_id: metrics.sessionId, analysis_type: 'real_time' },
              {
                total_participants: metrics.totalParticipants,
                active_participants: metrics.activeGroups,
                overall_engagement_score: metrics.averageEngagement,
                participation_rate: metrics.averageParticipation,
                analysis_timestamp: new Date(metrics.lastUpdate),
                calculation_timestamp: new Date()
              }
            );
            
            // Log successful individual session sync
            analyticsLogger.logOperation(
              'session_cache_sync_success',
              'session_analytics',
              Date.now(),
              true,
              {
                sessionId: metrics.sessionId,
                recordCount: 1,
                metadata: {
                  cacheKey: key,
                  participants: metrics.totalParticipants,
                  activeGroups: metrics.activeGroups,
                  engagementScore: metrics.averageEngagement
                }
              }
            );
            
            syncedCount++;
            console.log(`✅ Synced session ${metrics.sessionId} (${metrics.totalParticipants} participants)`);
          }
        } catch (error) {
          failedCount++;
          const sessionId = key.replace(this.SESSION_PREFIX, '');
          failedSessions.push(sessionId);
          
          // Log individual session sync failure
          analyticsLogger.logOperation(
            'session_cache_sync_failed',
            'session_analytics',
            Date.now(),
            false,
            {
              sessionId,
              recordCount: 0,
              error: error instanceof Error ? error.message : String(error),
              metadata: {
                cacheKey: key,
                errorType: error instanceof Error ? error.constructor.name : typeof error
              }
            }
          );
          
          console.error(`❌ Failed to sync session cache ${key}:`, error);
        }
      }
      
      // Log overall batch sync completion with proper context
      analyticsLogger.logOperation(
        'cache_sync_to_databricks',
        'session_analytics',
        startTime,
        true,
        {
          sessionId: 'batch_sync', // Indicates this is a batch operation
          recordCount: syncedCount, // Number of records actually synced
          metadata: {
            sessionsSynced: syncedCount,
            totalSessions: sessionKeys.length,
            failedSessions: failedCount,
            failedSessionIds: failedSessions,
            syncType: 'background_batch',
            cacheKeysProcessed: sessionKeys.length,
            successRate: sessionKeys.length > 0 ? (syncedCount / sessionKeys.length) * 100 : 0
          },
          forceLog: true
        }
      );
      
      console.log(`✅ Cache sync completed: ${syncedCount}/${sessionKeys.length} sessions synced`);
      if (failedCount > 0) {
        console.warn(`⚠️ ${failedCount} sessions failed to sync:`, failedSessions);
      }
      
    } catch (error) {
      analyticsLogger.logOperation(
        'cache_sync_to_databricks_failed',
        'session_analytics',
        startTime,
        false,
        {
          sessionId: 'batch_sync',
          recordCount: 0,
          error: error instanceof Error ? error.message : String(error),
          metadata: {
            errorType: error instanceof Error ? error.constructor.name : typeof error,
            syncType: 'background_batch'
          },
          forceLog: true
        }
      );
      
      console.error('❌ Cache sync to Databricks failed:', error);
    }
  }

  // Private helper methods

  private async fetchAndCacheSessionMetrics(sessionId: string): Promise<SessionMetricsCache | null> {
    try {
      // Fetch from existing session_analytics_cache table in users schema
      const analytics = await databricksService.queryOne(`
        SELECT 
          session_overall_score,
          participation_rate,
          total_participants, 
          avg_engagement_score,
          actual_groups,
          cached_at
        FROM ${databricksConfig.catalog}.users.session_analytics_cache
        WHERE session_id = ?
        LIMIT 1
      `, [sessionId]);

      if (!analytics) {
        return null;
      }

      const metrics: SessionMetricsCache = {
        sessionId,
        activeGroups: analytics.actual_groups || 0,
        readyGroups: 0, // Would need to query groups separately
        totalParticipants: analytics.total_participants || 0,
        averageEngagement: analytics.avg_engagement_score || 0,
        averageParticipation: analytics.participation_rate || 0,
        alertsActive: [], // Will be populated by real-time events
        lastUpdate: new Date().toISOString(),
        calculatedAt: analytics.cached_at || new Date().toISOString()
      };

      // Cache the fetched data
      const cacheKey = `${this.SESSION_PREFIX}${sessionId}`;
      await redisService.set(cacheKey, JSON.stringify(metrics), this.CACHE_TTL);

      return metrics;
      
    } catch (error) {
      console.error('Failed to fetch session metrics from Databricks:', error);
      return null;
    }
  }

  private async updateSessionAggregatesFromGroup(
    sessionId: string, 
    groupId: string, 
    groupMetrics: GroupMetricsCache
  ): Promise<void> {
    try {
      // For demo purposes, we'll simulate group data
      // In production, you'd track group keys or implement pattern matching
      const groupKeys: string[] = []; // Simplified for demo
      const sessionGroups: GroupMetricsCache[] = [];
      
      for (const key of groupKeys) {
        const groupData = await redisService.get(key);
        if (groupData) {
          const group = JSON.parse(groupData) as GroupMetricsCache;
          if (group.sessionId === sessionId) {
            sessionGroups.push(group);
          }
        }
      }

      // Calculate session-level aggregates
      const readyGroups = sessionGroups.filter(g => g.isReady).length;
      const totalParticipants = sessionGroups.reduce((sum, g) => sum + g.participantCount, 0);
      const averageEngagement = sessionGroups.length > 0 
        ? sessionGroups.reduce((sum, g) => sum + g.engagementScore, 0) / sessionGroups.length 
        : 0;

      // Update session cache
      await this.updateSessionMetrics(sessionId, {
        activeGroups: sessionGroups.length,
        readyGroups,
        totalParticipants,
        averageEngagement
      });
      
    } catch (error) {
      console.error('Failed to update session aggregates:', error);
    }
  }

  private async getActiveSessionsForTeacher(teacherId: string): Promise<string[]> {
    try {
      // Query for active sessions - this is a lightweight query
      const sessions = await databricksService.query(`
        SELECT id 
        FROM classroom_sessions 
        WHERE teacher_id = ? AND status = 'active'
      `, [teacherId]);

      return sessions.map(s => s.id);
      
    } catch (error) {
      console.error('Failed to get active sessions for teacher:', error);
      return [];
    }
  }

  /**
   * Get all active session cache keys from Redis
   */
  private async getActiveSessionCacheKeys(): Promise<string[]> {
    try {
      // Scan Redis for all session cache keys
      const keys = await redisService.keys(`${this.SESSION_PREFIX}*`);
      
      if (!keys || keys.length === 0) {
        console.log('ℹ️ No active session caches found in Redis');
        return [];
      }
      
      console.log(`🔍 Found ${keys.length} potential session cache keys`);
      
      // Filter out expired or invalid keys
      const validKeys: string[] = [];
      let expiredCount = 0;
      let corruptedCount = 0;
      
      for (const key of keys) {
        try {
          const cachedData = await redisService.get(key);
          if (cachedData) {
            const metrics = JSON.parse(cachedData) as SessionMetricsCache;
            
            // Check if cache entry is still valid (not too old)
            const cacheAge = Date.now() - new Date(metrics.lastUpdate).getTime();
            const maxAge = this.CACHE_TTL * 1000; // Convert to milliseconds
            
            if (cacheAge < maxAge && metrics.sessionId) {
              validKeys.push(key);
            } else {
              // Remove expired cache entries
              await redisService.del(key);
              expiredCount++;
              console.log(`🗑️ Removed expired cache entry: ${key} (age: ${Math.round(cacheAge / 1000)}s)`);
            }
          }
        } catch (parseError) {
          // Remove corrupted cache entries
          await redisService.del(key);
          corruptedCount++;
          console.warn(`🗑️ Removed corrupted cache entry: ${key} (parse error: ${parseError instanceof Error ? parseError.message : String(parseError)})`);
        }
      }
      
      console.log(`📊 Cache cleanup: ${validKeys.length} valid, ${expiredCount} expired, ${corruptedCount} corrupted`);
      return validKeys;
    } catch (error) {
      console.error('Failed to get active session cache keys:', error);
      return [];
    }
  }

  /**
   * Manual trigger for cache sync (useful for testing and admin operations)
   */
  async triggerManualCacheSync(): Promise<{
    success: boolean;
    sessionsProcessed: number;
    sessionsSynced: number;
    failedSessions: number;
    duration: number;
  }> {
    const startTime = Date.now();
    
    try {
      console.log('🚀 Manual cache sync triggered...');
      
      await this.syncCacheToDatabriks();
      
      const duration = Date.now() - startTime;
      
      // Get final stats from the last sync operation
      const sessionKeys = await this.getActiveSessionCacheKeys();
      
      return {
        success: true,
        sessionsProcessed: sessionKeys.length,
        sessionsSynced: sessionKeys.length, // Assuming all were synced successfully
        failedSessions: 0,
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      
      console.error('❌ Manual cache sync failed:', error);
      
      return {
        success: false,
        sessionsProcessed: 0,
        sessionsSynced: 0,
        failedSessions: 0,
        duration
      };
    }
  }
}

// Export singleton instance
export const realTimeAnalyticsCacheService = new RealTimeAnalyticsCacheService();

// Schedule background sync job (every 5 minutes)
setInterval(() => {
  realTimeAnalyticsCacheService.syncCacheToDatabriks().catch(error => {
    console.error('Scheduled cache sync failed:', error);
  });
}, 5 * 60 * 1000);
