/**
 * Analytics Computation Service
 * 
 * Robust, idempotent service for computing comprehensive session analytics.
 * Follows the implementation plan for zero-polling, event-driven architecture.
 */

import { databricksService } from './databricks.service';
import { websocketService } from './websocket.service';
import { realTimeAnalyticsCacheService } from './real-time-analytics-cache.service';
import { analyticsLogger } from '../utils/analytics-logger';
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
  private readonly COMPUTATION_TIMEOUT = 30000; // 30 seconds
  
  /**
   * Main method: Compute comprehensive session analytics
   * This method is idempotent - safe to call multiple times
   */
  async computeSessionAnalytics(sessionId: string): Promise<ComputedAnalytics | null> {
    const startTime = Date.now();
    const computationId = `analytics_${sessionId}_${startTime}`;
    
    try {
      // Check if analytics already computed (idempotency)
      const existingAnalytics = await this.getExistingAnalytics(sessionId);
      if (existingAnalytics && existingAnalytics.computationMetadata.status === 'completed') {
        console.log(`✅ Analytics already computed for session ${sessionId}, returning cached result`);
        return existingAnalytics;
      }

      console.log(`🚀 Starting analytics computation for session ${sessionId}`);
      
      // Mark computation as in progress
      await this.markComputationInProgress(sessionId, computationId);
      
      // Fetch session data
      const sessionData = await this.fetchSessionData(sessionId);
      if (!sessionData) {
        throw new Error(`Session ${sessionId} not found or incomplete`);
      }

      // Compute analytics components in parallel for performance
      const [membershipSummary, engagementMetrics, timelineAnalysis, groupPerformance] = await Promise.all([
        this.computeMembershipSummary(sessionId, sessionData),
        this.computeEngagementMetrics(sessionId, sessionData),
        this.computeTimelineAnalysis(sessionId, sessionData),
        this.computeGroupPerformance(sessionId, sessionData)
      ]);

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
      await this.persistAnalytics(sessionId, computedAnalytics);
      
      // Log successful computation
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
      return computedAnalytics;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
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
      await this.markComputationFailed(sessionId, computationId, error);
      
      console.error(`❌ Analytics computation failed for session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Compute session membership summary
   */
  private async computeMembershipSummary(sessionId: string, sessionData: any): Promise<SessionMembershipSummary> {
    const groups = await databricksService.query(`
      SELECT 
        sg.id,
        sg.name,
        sg.leader_id,
        sgm.user_id,
        sgm.joined_at,
        sg.expected_member_count
      FROM session_groups sg
      LEFT JOIN session_group_members sgm ON sg.id = sgm.group_id
      WHERE sg.session_id = ?
      ORDER BY sg.name, sgm.joined_at
    `, [sessionId]);

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
        COUNT(DISTINCT sgm.user_id) as total_participants,
        COUNT(DISTINCT sg.id) as active_groups,
        AVG(COALESCE(ga.engagement_score, 0)) as avg_engagement,
        AVG(COALESCE(ga.participation_rate, 0)) as participation_rate
      FROM session_groups sg
      LEFT JOIN session_group_members sgm ON sg.id = sgm.group_id
      LEFT JOIN group_analytics ga ON sg.id = ga.group_id
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
      SELECT event_type, event_data, created_at
      FROM session_events
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
          description: `Group ${event.event_data?.groupName || 'Unknown'} marked as ready`
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
        COUNT(sgm.user_id) as member_count,
        AVG(COALESCE(ga.engagement_score, 0)) as engagement_score,
        AVG(COALESCE(ga.participation_rate, 0)) as participation_rate,
        MIN(sgm.joined_at) as first_member_joined
      FROM session_groups sg
      LEFT JOIN session_group_members sgm ON sg.id = sgm.group_id  
      LEFT JOIN group_analytics ga ON sg.id = ga.group_id
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

    // Store in session_analytics table
    await databricksService.upsert(
      'session_analytics',
      { session_id: sessionId, analysis_type: 'final_summary' },
      {
        session_id: sessionId,
        analysis_type: 'final_summary',
        analytics_data: JSON.stringify(sessionAnalyticsOverview),
        computation_metadata: JSON.stringify(computationMetadata),
        computed_at: computationMetadata.computedAt,
        version: computationMetadata.version,
        status: computationMetadata.status,
        processing_time_ms: computationMetadata.processingTime
      }
    );

    // Store group analytics separately for querying
    for (const groupAnalytics of computedAnalytics.groupAnalytics) {
      await databricksService.upsert(
        'group_analytics',
        { group_id: groupAnalytics.groupId, analysis_type: 'final_summary' },
        {
          group_id: groupAnalytics.groupId,
          session_id: sessionId,
          analysis_type: 'final_summary',
          member_count: groupAnalytics.memberCount,
          engagement_score: groupAnalytics.engagementScore,
          participation_rate: groupAnalytics.participationRate,
          computed_at: computationMetadata.computedAt
        }
      );
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
      SELECT * FROM classroom_sessions WHERE id = ?
    `, [sessionId]);
  }

  private async getExistingAnalytics(sessionId: string): Promise<ComputedAnalytics | null> {
    const existing = await databricksService.queryOne(`
      SELECT analytics_data, computation_metadata
      FROM session_analytics 
      WHERE session_id = ? AND analysis_type = 'final_summary'
      ORDER BY computed_at DESC LIMIT 1
    `, [sessionId]);

    if (existing && existing.analytics_data) {
      return {
        sessionAnalyticsOverview: JSON.parse(existing.analytics_data),
        groupAnalytics: [], // Would need to fetch separately if needed
        computationMetadata: JSON.parse(existing.computation_metadata || '{}')
      };
    }

    return null;
  }

  private async markComputationInProgress(sessionId: string, computationId: string): Promise<void> {
    await databricksService.upsert(
      'session_analytics',
      { session_id: sessionId, analysis_type: 'final_summary' },
      {
        session_id: sessionId,
        analysis_type: 'final_summary',
        status: 'in_progress',
        computation_id: computationId,
        started_at: new Date()
      }
    );
  }

  private async markComputationFailed(sessionId: string, computationId: string, error: any): Promise<void> {
    await databricksService.upsert(
      'session_analytics',
      { session_id: sessionId, analysis_type: 'final_summary' },
      {
        session_id: sessionId,
        analysis_type: 'final_summary', 
        status: 'failed',
        computation_id: computationId,
        error_message: error instanceof Error ? error.message : String(error),
        failed_at: new Date()
      }
    );
  }
}

// Export singleton instance
export const analyticsComputationService = new AnalyticsComputationService();
