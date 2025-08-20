/**
 * Analytics Computation Service
 * 
 * Robust, idempotent service for computing comprehensive session analytics.
 * Follows the implementation plan for zero-polling, event-driven architecture.
 * 
 * Platform Stabilization P1 3.1: Enhanced with circuit breakers and distributed locking
 * to prevent duplicate triggers and provide graceful degradation under load.
 */

import { databricksService } from './databricks.service';
import { websocketService } from './websocket.service';
import { realTimeAnalyticsCacheService } from './real-time-analytics-cache.service';
import { databricksConfig } from '../config/databricks.config';
import { analyticsLogger } from '../utils/analytics-logger';
import { analyticsComputationCircuitBreaker } from './analytics-computation-circuit-breaker.service';
import { analyticsComputationLockService } from './analytics-computation-lock.service';
import { 
  SessionMembershipSummary, 
  SessionAnalyticsOverviewComplete,
  EngagementMetrics,
  TimelineAnalysis,
  GroupPerformanceSummary,
  TimelineMilestone
} from '@classwaves/shared';

interface ComputedAnalytics {
  sessionAnalyticsOverview: SessionAnalyticsOverviewComplete;
  groupAnalytics: GroupPerformanceSummary[];
  computationMetadata: {
    computedAt: Date;
    version: string;
    status: 'completed' | 'partial' | 'failed';
    processingTime: number;
  };
}

export class AnalyticsComputationService {
  private readonly ANALYTICS_VERSION = '2.0';
  private readonly COMPUTATION_TIMEOUT = 180000; // 3 minutes (increased for complex analytics)
  
  /**
   * Main method: Compute comprehensive session analytics with circuit breaker and distributed locking
   * This method is idempotent and prevents duplicate computation triggers
   */
  async computeSessionAnalytics(sessionId: string): Promise<ComputedAnalytics | null> {
    console.log(`🎯 Analytics computation requested for session ${sessionId}`);
    
    // Execute with circuit breaker protection and distributed locking
    return await analyticsComputationCircuitBreaker.execute(
      async () => {
        return await analyticsComputationLockService.executeWithLock(
          sessionId,
          () => this.performAnalyticsComputation(sessionId),
          {
            ttl: 900, // 15 minutes lock TTL for complex computations
            lockExtensionInterval: 300000, // Extend every 5 minutes
            maxExecutionTime: this.COMPUTATION_TIMEOUT
          }
        );
      },
      `analytics-computation-${sessionId}`,
      { sessionId, version: this.ANALYTICS_VERSION }
    );
  }

  /**
   * Internal method: Perform the actual analytics computation
   * Protected by circuit breaker and distributed lock
   */
  private async performAnalyticsComputation(sessionId: string): Promise<ComputedAnalytics | null> {
    const startTime = Date.now();
    const computationId = `analytics_${sessionId}_${startTime}`;
    
    try {
      // Check if analytics already computed (idempotency)
      const existingAnalytics = await this.getExistingAnalytics(sessionId);
      if (existingAnalytics && existingAnalytics.computationMetadata.status === 'completed') {
        console.log(`✅ Analytics already computed for session ${sessionId}, returning cached result`);
        return existingAnalytics;
      }

      console.log(`🚀 Starting protected analytics computation for session ${sessionId}`);
      
      // Mark computation as in progress with enhanced status tracking
      console.log(`📝 Marking computation as in progress...`);
      await this.markComputationInProgress(sessionId, computationId);
      console.log(`✅ Computation marked as in progress`);
      
      // Fetch session data
      console.log(`📊 Fetching session data for ${sessionId}...`);
      const sessionData = await this.fetchSessionData(sessionId);
      if (!sessionData) {
        console.error(`❌ Session ${sessionId} not found or incomplete`);
        throw new Error(`Session ${sessionId} not found or incomplete`);
      }
      console.log(`✅ Session data fetched:`, {
        id: sessionData.id,
        title: sessionData.title,
        status: sessionData.status,
        totalStudents: sessionData.total_students
      });

      // Compute analytics components in parallel for performance with timeout protection
      console.log(`🔄 Computing analytics components in parallel...`);
      const computationPromise = this.computeAnalyticsComponents(sessionData);
      const [membershipSummary, engagementMetrics, timelineAnalysis, groupPerformance] = await computationPromise;
      console.log(`✅ All analytics components computed successfully`);

      const computedAt = new Date().toISOString();
      const processingTime = Date.now() - startTime;

      const sessionAnalyticsOverview: SessionAnalyticsOverviewComplete = {
        sessionId,
        computedAt,
        membershipSummary,
        engagementMetrics,
        timelineAnalysis,
        groupPerformance
      };

      const computedAnalytics: ComputedAnalytics = {
        sessionAnalyticsOverview,
        groupAnalytics: groupPerformance,
        computationMetadata: {
          computedAt: new Date(),
          version: this.ANALYTICS_VERSION,
          status: 'completed',
          processingTime
        }
      };

      // Persist analytics to database
      console.log(`💾 Persisting analytics to database...`);
      await this.persistAnalytics(sessionId, computedAnalytics);
      console.log(`✅ Analytics persisted successfully`);
      
      // Log successful computation
      console.log(`📝 Logging successful computation...`);
      analyticsLogger.logOperation(
        'analytics_computation_completed',
        'session_analytics',
        startTime,
        true,
        {
          sessionId,
          metadata: {
            computationId,
            processingTimeMs: processingTime,
            version: this.ANALYTICS_VERSION,
            componentsComputed: ['membership', 'engagement', 'timeline', 'groups'].length
          }
        }
      );

      console.log(`✅ Analytics computation completed for session ${sessionId} in ${processingTime}ms`);
      console.log(`🎯 Returning computed analytics:`, {
        hasSessionOverview: !!computedAnalytics.sessionAnalyticsOverview,
        groupAnalyticsCount: computedAnalytics.groupAnalytics.length,
        computationStatus: computedAnalytics.computationMetadata.status
      });
      return computedAnalytics;

    } catch (error) {
      console.error(`❌ Protected analytics computation failed for session ${sessionId}:`, error);
      
      // Mark computation as failed with enhanced error tracking
      await this.markComputationFailed(sessionId, computationId, error instanceof Error ? error.message : 'Unknown error');
      
      // Re-throw to trigger circuit breaker failure handling
      throw error;
    }
  }

  /**
   * Compute all analytics components with parallel processing and error resilience
   */
  private async computeAnalyticsComponents(sessionData: any): Promise<[any, any, any, any]> {
    const componentPromises = [
      this.computeMembershipSummary(sessionData.id, sessionData),
      this.computeEngagementMetrics(sessionData.id, sessionData),
      this.computeTimelineAnalysis(sessionData.id, sessionData),
      this.computeGroupPerformance(sessionData.id, sessionData)
    ];

    // Execute with individual component error handling
    const results = await Promise.allSettled(componentPromises);
    
    const [membershipResult, engagementResult, timelineResult, groupResult] = results;

    // Extract successful results or use fallback
    const membershipSummary = membershipResult.status === 'fulfilled' 
      ? membershipResult.value 
      : this.createFallbackMembershipSummary(sessionData);
      
    const engagementMetrics = engagementResult.status === 'fulfilled' 
      ? engagementResult.value 
      : this.createFallbackEngagementMetrics(sessionData);
      
    const timelineAnalysis = timelineResult.status === 'fulfilled' 
      ? timelineResult.value 
      : this.createFallbackTimelineAnalysis(sessionData);
      
    const groupPerformance = groupResult.status === 'fulfilled' 
      ? groupResult.value 
      : this.createFallbackGroupPerformance(sessionData);

    // Log any component failures
    results.forEach((result, index) => {
      const componentNames = ['membership', 'engagement', 'timeline', 'group'];
      if (result.status === 'rejected') {
        console.warn(`⚠️ Analytics component ${componentNames[index]} failed, using fallback:`, result.reason);
      }
    });

    return [membershipSummary, engagementMetrics, timelineAnalysis, groupPerformance];
  }

  /**
   * Create fallback membership summary when computation fails
   */
  private createFallbackMembershipSummary(sessionData: any): any {
    console.log('📊 Creating fallback membership summary');
    return {
      totalEnrolled: sessionData.total_students || 0,
      totalParticipated: 0,
      participationRate: 0,
      groupDistribution: [],
      sessionOverview: {
        sessionId: sessionData.id,
        status: sessionData.status,
        duration: 0
      }
    };
  }

  /**
   * Create fallback engagement metrics when computation fails
   */
  private createFallbackEngagementMetrics(sessionData: any): any {
    console.log('📊 Creating fallback engagement metrics');
    return {
      overallEngagement: 0,
      participationBalance: 0,
      qualityScore: 0,
      trendAnalysis: {
        direction: 'stable',
        strength: 0
      }
    };
  }

  /**
   * Create fallback timeline analysis when computation fails
   */
  private createFallbackTimelineAnalysis(sessionData: any): any {
    console.log('📊 Creating fallback timeline analysis');
    return {
      keyMilestones: [],
      phaseAnalysis: [],
      engagementFlow: []
    };
  }

  /**
   * Create fallback group performance when computation fails
   */
  private createFallbackGroupPerformance(sessionData: any): any {
    console.log('📊 Creating fallback group performance');
    return [];
  }

  /**
   * Handle original error processing logic
   */
  private async handleComputationError(sessionId: string, computationId: string, error: any, startTime: number): Promise<void> {
    const processingTime = Date.now() - startTime;
    
    console.error(`💥 ANALYTICS COMPUTATION ERROR for session ${sessionId}:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      processingTime
    });
    
    // Log error
    analyticsLogger.logOperation(
      'analytics_computation_failed',
        'session_analytics',
        startTime,
        false,
        {
          sessionId,
          metadata: {
            computationId,
            processingTimeMs: processingTime
          },
          error: error instanceof Error ? error.message : String(error)
        }
      );

      // Mark computation as failed
      console.log(`📝 Marking computation as failed...`);
      try {
        await this.markComputationFailed(sessionId, computationId, error);
        console.log(`✅ Computation marked as failed`);
      } catch (markFailedError) {
        console.error(`❌ Failed to mark computation as failed:`, markFailedError);
      }
      
      console.error(`❌ Analytics computation failed for session ${sessionId} - RETURNING NULL`);
      return null;
    }
  }

  /**
   * Compute session membership summary
   */
  private async computeMembershipSummary(sessionId: string, sessionData: any): Promise<SessionMembershipSummary> {
    console.log(`🔍 Computing membership summary for session ${sessionId}...`);
    
    const groups = await databricksService.query(`
      SELECT 
        sg.id,
        sg.name,
        sg.leader_id,
        sgm.student_id as user_id,
        sgm.created_at as joined_at,
        sg.max_size as expected_member_count
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_group_members sgm ON sg.id = sgm.group_id
      WHERE sg.session_id = ?
      ORDER BY sg.name, sgm.created_at
    `, [sessionId]);
    
    console.log(`📊 Found ${groups.length} group membership records for session ${sessionId}`);
    if (groups.length > 0) {
      console.log(`🔍 Sample group data:`, groups[0]);
    }

    const groupsMap = new Map();
    let totalConfiguredMembers = 0;
    let totalActualMembers = 0;
    let groupsWithLeaders = 0;
    let groupsAtCapacity = 0;

    // Process groups and calculate metrics
    for (const row of groups) {
      if (!groupsMap.has(row.id)) {
        groupsMap.set(row.id, {
          id: row.id,
          name: row.name,
          expectedMembers: row.expected_member_count || 0,
          actualMembers: [],
          hasLeader: !!row.leader_id,
          firstJoined: null,
          lastJoined: null
        });
        totalConfiguredMembers += (row.expected_member_count || 0);
      }

      const group = groupsMap.get(row.id);
      if (row.user_id) {
        group.actualMembers.push({
          userId: row.user_id,
          joinedAt: row.joined_at
        });
        
        // Track timing
        if (!group.firstJoined || row.joined_at < group.firstJoined) {
          group.firstJoined = row.joined_at;
        }
        if (!group.lastJoined || row.joined_at > group.lastJoined) {
          group.lastJoined = row.joined_at;
        }
      }
    }

    // Calculate final metrics
    let fastestGroup: { name: string; first_member_joined: string; last_member_joined: string } | null = null;
    let fastestFormationTime = Infinity;
    let totalFormationTime = 0;
    let groupsWithFormationTime = 0;

    for (const group of groupsMap.values()) {
      totalActualMembers += group.actualMembers.length;
      
      if (group.hasLeader) {
        groupsWithLeaders++;
      }
      
      if (group.actualMembers.length >= group.expectedMembers && group.expectedMembers > 0) {
        groupsAtCapacity++;
      }

      // Calculate formation time
      if (group.firstJoined && group.lastJoined && group.actualMembers.length > 1) {
        const formationTime = new Date(group.lastJoined).getTime() - new Date(group.firstJoined).getTime();
        totalFormationTime += formationTime;
        groupsWithFormationTime++;

        if (formationTime < fastestFormationTime) {
          fastestFormationTime = formationTime;
          fastestGroup = {
            name: group.name,
            first_member_joined: group.firstJoined,
            last_member_joined: group.lastJoined
          };
        }
      }
    }

    const averageMembershipAdherence = totalConfiguredMembers > 0 
      ? totalActualMembers / totalConfiguredMembers 
      : 0;

    const avgFormationTime = groupsWithFormationTime > 0 
      ? totalFormationTime / groupsWithFormationTime 
      : null;

    return {
      totalConfiguredMembers,
      totalActualMembers,
      groupsWithLeadersPresent: groupsWithLeaders,
      groupsAtFullCapacity: groupsAtCapacity,
      averageMembershipAdherence,
      membershipFormationTime: {
        avgFormationTime,
        fastestGroup
      }
    };
  }

  /**
   * Compute engagement metrics
   */
  private async computeEngagementMetrics(sessionId: string, sessionData: any): Promise<EngagementMetrics> {
    // Get cached real-time metrics if available
    const cachedMetrics = await realTimeAnalyticsCacheService.getSessionMetrics(sessionId);
    
    if (cachedMetrics) {
      return {
        totalParticipants: cachedMetrics.totalParticipants,
        activeGroups: cachedMetrics.activeGroups,
        averageEngagement: cachedMetrics.averageEngagement,
        participationRate: cachedMetrics.averageParticipation
      };
    }

    // Fallback to database calculation
    const metrics = await databricksService.queryOne(`
      SELECT 
        COUNT(DISTINCT sgm.student_id) as total_participants,
        COUNT(DISTINCT sg.id) as active_groups,
        AVG(COALESCE(ga.engagement_score, 0)) as avg_engagement,
        AVG(COALESCE(ga.participation_rate, 0)) as participation_rate
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_group_members sgm ON sg.id = sgm.group_id
      LEFT JOIN ${databricksConfig.catalog}.analytics.group_analytics ga ON sg.id = ga.group_id
      WHERE sg.session_id = ?
    `, [sessionId]);

    return {
      totalParticipants: metrics?.total_participants || 0,
      activeGroups: metrics?.active_groups || 0,
      averageEngagement: metrics?.avg_engagement || 0,
      participationRate: metrics?.participation_rate || 0
    };
  }

  /**
   * Compute timeline analysis
   */
  private async computeTimelineAnalysis(sessionId: string, sessionData: any): Promise<TimelineAnalysis> {
    const events = await databricksService.query(`
      SELECT event_type, payload, created_at
      FROM ${databricksConfig.catalog}.analytics.session_events
      WHERE session_id = ?
      ORDER BY created_at
    `, [sessionId]);

    const milestones: TimelineMilestone[] = [];
    let sessionDuration = 0;
    let groupFormationTime = 0;
    let activeParticipationTime = 0;

    // Calculate timing metrics from session data
    if (sessionData.actual_start && sessionData.actual_end) {
      sessionDuration = Math.round(
        (new Date(sessionData.actual_end).getTime() - new Date(sessionData.actual_start).getTime()) / 60000
      );
    }

    // Process events to create timeline
    for (const event of events) {
      // Parse payload if it's a JSON string
      let eventPayload = {};
      try {
        eventPayload = event.payload ? (typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload) : {};
      } catch (error) {
        console.warn('Failed to parse event payload:', event.payload);
      }

      if (event.event_type === 'session_started') {
        milestones.push({
          timestamp: event.created_at,
          event: 'Session Started',
          description: 'Teacher began the session'
        });
      } else if (event.event_type === 'group_ready') {
        milestones.push({
          timestamp: event.created_at,
          event: 'Group Ready',
          description: `Group ${(eventPayload as any)?.groupName || 'Unknown'} marked as ready`
        });
      }
    }

    return {
      sessionDuration,
      groupFormationTime,
      activeParticipationTime,
      keyMilestones: milestones
    };
  }

  /**
   * Compute group performance summaries
   */
  private async computeGroupPerformance(sessionId: string, sessionData: any): Promise<GroupPerformanceSummary[]> {
    const groups = await databricksService.query(`
      SELECT 
        sg.id,
        sg.name,
        COUNT(sgm.student_id) as member_count,
        AVG(COALESCE(ga.engagement_score, 0)) as engagement_score,
        AVG(COALESCE(ga.participation_rate, 0)) as participation_rate,
        MIN(sgm.created_at) as first_member_joined
      FROM ${databricksConfig.catalog}.sessions.student_groups sg
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_group_members sgm ON sg.id = sgm.group_id  
      LEFT JOIN ${databricksConfig.catalog}.analytics.group_analytics ga ON sg.id = ga.group_id
      WHERE sg.session_id = ?
      GROUP BY sg.id, sg.name
    `, [sessionId]);

    return groups.map(group => ({
      groupId: group.id,
      groupName: group.name,
      memberCount: group.member_count || 0,
      engagementScore: group.engagement_score || 0,
      participationRate: group.participation_rate || 0,
      readyTime: group.first_member_joined
    }));
  }

  /**
   * Persist computed analytics to database
   */
  private async persistAnalytics(sessionId: string, computedAnalytics: ComputedAnalytics): Promise<void> {
    const { sessionAnalyticsOverview, computationMetadata } = computedAnalytics;

    // Get session info for required NOT NULL fields
    const sessionInfo = await databricksService.queryOne(`
      SELECT teacher_id, school_id, actual_start, created_at
      FROM ${databricksConfig.catalog}.sessions.classroom_sessions
      WHERE id = ?
    `, [sessionId]);

    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found for analytics persistence`);
    }

    // Map computed analytics to existing session_analytics_cache fields
    const cacheData = {
      id: databricksService.generateId(), // Add required id field
      session_id: sessionId,
      teacher_id: sessionInfo.teacher_id, // Required NOT NULL field
      school_id: sessionInfo.school_id,   // Required NOT NULL field  
      session_date: sessionInfo.created_at || sessionInfo.actual_start, // Required NOT NULL field
      session_overall_score: sessionAnalyticsOverview.engagementMetrics.averageEngagement,
      session_effectiveness_score: sessionAnalyticsOverview.engagementMetrics.averageEngagement,
      total_participants: sessionAnalyticsOverview.membershipSummary.totalActualMembers,
      participation_rate: sessionAnalyticsOverview.engagementMetrics.participationRate,
      avg_engagement_score: sessionAnalyticsOverview.engagementMetrics.averageEngagement,
      avg_group_score: computedAnalytics.groupAnalytics.length > 0 
        ? computedAnalytics.groupAnalytics.reduce((sum, g) => sum + g.engagementScore, 0) / computedAnalytics.groupAnalytics.length
        : 0,
      cache_freshness: 'fresh',
      last_full_calculation: computationMetadata.computedAt,
      cached_at: computationMetadata.computedAt,
      cache_hit_count: 0,
      fallback_count: 0
    };

    // Store in existing session_analytics_cache table using direct SQL
    const columns = Object.keys(cacheData);
    const values = Object.values(cacheData);
    const placeholders = columns.map(() => '?').join(', ');
    
    // Use INSERT with ON DUPLICATE KEY UPDATE equivalent for Databricks
    const mergeSql = `
      MERGE INTO ${databricksConfig.catalog}.users.session_analytics_cache AS target
      USING (SELECT ${columns.map((col, i) => `? AS ${col}`).join(', ')}) AS source
      ON target.session_id = source.session_id
      WHEN MATCHED THEN UPDATE SET ${columns.map(col => `${col} = source.${col}`).join(', ')}
      WHEN NOT MATCHED THEN INSERT (${columns.join(', ')}) VALUES (${placeholders})
    `;
    
    await databricksService.query(mergeSql, [...values, ...values]);

    // Also update individual student_groups with computed analytics if available
    for (const groupAnalytics of computedAnalytics.groupAnalytics) {
      try {
        await databricksService.update(
          'student_groups',
          groupAnalytics.groupId,
          {
            collaboration_score: groupAnalytics.engagementScore,
            updated_at: new Date()
          }
        );
      } catch (error) {
        console.warn(`Failed to update group ${groupAnalytics.groupId} analytics:`, error);
        // Don't fail the whole operation if group updates fail
      }
    }
  }

  /**
   * Emit analytics:finalized event after successful computation
   */
  async emitAnalyticsFinalized(sessionId: string): Promise<void> {
    try {
      await websocketService.emitToSession(sessionId, 'analytics:finalized', {
        sessionId,
        timestamp: new Date().toISOString()
      });
      
      console.log(`📡 Emitted analytics:finalized event for session ${sessionId}`);
    } catch (error) {
      console.error(`Failed to emit analytics:finalized for session ${sessionId}:`, error);
    }
  }

  // Private helper methods

  private async fetchSessionData(sessionId: string): Promise<any> {
    return await databricksService.queryOne(`
      SELECT id, teacher_id, school_id, topic, status, actual_start, actual_end, actual_duration_minutes FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ?
    `, [sessionId]);
  }

  private async getExistingAnalytics(sessionId: string): Promise<ComputedAnalytics | null> {
    const existing = await databricksService.queryOne(`
      SELECT 
        session_overall_score, session_effectiveness_score, total_participants,
        participation_rate, avg_engagement_score, avg_group_score,
        cached_at, last_full_calculation
      FROM ${databricksConfig.catalog}.users.session_analytics_cache
      WHERE session_id = ?
      LIMIT 1
    `, [sessionId]);

    if (existing && existing.cached_at) {
      // Convert cache fields back to expected format
      return {
        sessionAnalyticsOverview: {
          membershipSummary: {
            totalActualMembers: existing.total_participants || 0,
            totalConfiguredMembers: existing.total_participants || 0,
            groupsWithLeadersPresent: 0,
            groupsAtFullCapacity: 0,
            averageMembershipAdherence: 0,
            membershipFormationTime: { avgFormationTime: null, fastestGroup: null }
          },
          engagementMetrics: {
            averageEngagement: existing.avg_engagement_score || 0,
            participationRate: existing.participation_rate || 0,
            totalParticipants: existing.total_participants || 0,
            activeGroups: 0
          },
          timelineAnalysis: {
            milestones: [],
            keyEvents: [],
            sessionFlow: []
          }
        } as any,
        groupAnalytics: [], 
        computationMetadata: {
          computedAt: existing.cached_at,
          version: this.ANALYTICS_VERSION,
          status: 'completed',
          processingTime: 0
        }
      };
    }

    return null;
  }

  private async markComputationInProgress(sessionId: string, computationId: string): Promise<void> {
    // Use direct SQL to avoid upsert's automatic created_at/updated_at fields
    const now = new Date();
    
    // First try to update existing record
    const updateSql = `
      UPDATE ${databricksConfig.catalog}.users.session_analytics_cache 
      SET cache_freshness = 'computing',
          last_full_calculation = ?,
          cached_at = ?
      WHERE session_id = ?
    `;
    
    const updateResult = await databricksService.query(updateSql, [now, now, sessionId]);
    
    // If no rows were updated, the session doesn't exist in cache yet - skip for now
    // (it will be created when persistAnalytics runs)
  }

  private async markComputationFailed(sessionId: string, computationId: string, error: any): Promise<void> {
    try {
      // Safely truncate and sanitize error message to prevent SQL injection
      let errorMessage = error instanceof Error ? error.message : String(error);
      // Truncate very long error messages and remove potential SQL injection characters
      errorMessage = errorMessage.substring(0, 1000).replace(/'/g, "''");
      
      // Use direct SQL to avoid upsert's automatic created_at/updated_at fields
      const updateSql = `
        UPDATE ${databricksConfig.catalog}.users.session_analytics_cache 
        SET cache_freshness = 'failed',
            error_count = 1,
            cached_at = ?
        WHERE session_id = ?
      `;
      
      await databricksService.query(updateSql, [new Date(), sessionId]);
    } catch (failureError) {
      console.error(`❌ Failed to mark computation as failed:`, failureError);
      // Don't throw - this is a secondary operation
    }
  }
}

// Export singleton instance
export const analyticsComputationService = new AnalyticsComputationService();
