/**
 * Analytics Computation Service
 * 
 * Robust, idempotent service for computing comprehensive session analytics.
 * Follows the implementation plan for zero-polling, event-driven architecture.
 */

import { DatabricksService } from './databricks.service';
import { websocketService } from './websocket.service';
import { v4 as uuidv4 } from 'uuid';

// Types for analytics computation
export interface SessionAnalyticsOverview {
  sessionId: string;
  totalStudents: number;
  activeStudents: number;
  participationRate: number;
  overallEngagement: number;
  groupCount: number;
  averageGroupSize: number;
  sessionDuration: number;
  plannedGroups: number;
  actualGroups: number;
  readyGroupsAtStart: number;
  readyGroupsAt5m: number;
  readyGroupsAt10m: number;
  memberAdherence: number;
}

export interface GroupAnalytics {
  groupId: string;
  memberCount: number;
  engagementScore: number;
  participationRate: number;
  readyTime: number;
}

export interface ComputedAnalytics {
  sessionAnalyticsOverview: SessionAnalyticsOverview;
  groupAnalytics: GroupAnalytics[];
  computationMetadata: {
    computationId: string;
    computedAt: Date;
    version: string;
    status: string;
    processingTime: number;
  };
}

export class AnalyticsComputationService {
  private readonly ANALYTICS_VERSION = '2.0';

  constructor(
    private databricksService: DatabricksService
  ) {}

  /**
   * Compute comprehensive analytics for a session
   */
  async computeSessionAnalytics(sessionId: string): Promise<ComputedAnalytics> {
    const computationId = uuidv4();
    const startTime = Date.now();

    try {
      console.log(`🧮 Starting analytics computation for session ${sessionId}`);
      
      // Mark computation as in progress
      await this.markComputationInProgress(sessionId, computationId);

      // Fetch session data
      const sessionData = await this.fetchSessionData(sessionId);
      if (!sessionData) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Compute analytics
      const sessionAnalyticsOverview = await this.computeSessionOverview(sessionId, sessionData);
      const groupAnalytics = await this.computeGroupPerformance(sessionId, sessionData);

      const computationMetadata = {
        computationId,
        computedAt: new Date(),
        version: this.ANALYTICS_VERSION,
        status: 'completed',
        processingTime: Date.now() - startTime
      };

      const computedAnalytics: ComputedAnalytics = {
        sessionAnalyticsOverview,
        groupAnalytics,
        computationMetadata
      };

      // Persist analytics to database
      await this.persistAnalytics(sessionId, computedAnalytics);

      console.log(`✅ Analytics computation completed for session ${sessionId} in ${computationMetadata.processingTime}ms`);
      
      return computedAnalytics;

    } catch (error) {
      console.error(`❌ Analytics computation failed for session ${sessionId}:`, error);
      
      // Mark computation as failed
      await this.markComputationFailed(sessionId, computationId, error);
      
      throw error;
    }
  }

  /**
   * Compute session overview analytics
   */
  private async computeSessionOverview(sessionId: string, sessionData: any): Promise<SessionAnalyticsOverview> {
    // Get group information
    const groups = await this.databricksService.query(`
      SELECT * FROM student_groups WHERE session_id = ?
    `, [sessionId]);

    // Get participant information
    const participants = await this.databricksService.query(`
      SELECT * FROM participants WHERE session_id = ?
    `, [sessionId]);

    // Get planned vs actual data from cache
    const plannedVsActual = await this.databricksService.queryOne(`
      SELECT 
        planned_groups, actual_groups, 
        ready_groups_at_start, ready_groups_at_5m, ready_groups_at_10m,
        avg_participation_rate, total_students, active_students
      FROM session_analytics_cache 
      WHERE session_id = ?
    `, [sessionId]);

    const totalStudents = plannedVsActual?.total_students || participants.length;
    const activeStudents = plannedVsActual?.active_students || participants.filter(p => p.is_active).length;
    const participationRate = plannedVsActual?.avg_participation_rate || (activeStudents / totalStudents);

    return {
      sessionId,
      totalStudents,
      activeStudents,
      participationRate: Math.round(participationRate * 100),
      overallEngagement: Math.round((participationRate * 100)),
      groupCount: groups.length,
      averageGroupSize: groups.length > 0 ? Math.round(totalStudents / groups.length) : 0,
      sessionDuration: sessionData.duration_minutes || 0,
      plannedGroups: plannedVsActual?.planned_groups || 0,
      actualGroups: plannedVsActual?.actual_groups || groups.length,
      readyGroupsAtStart: plannedVsActual?.ready_groups_at_start || 0,
      readyGroupsAt5m: plannedVsActual?.ready_groups_at_5m || 0,
      readyGroupsAt10m: plannedVsActual?.ready_groups_at_10m || 0,
      memberAdherence: plannedVsActual?.actual_groups > 0 ? 
        Math.round((plannedVsActual.actual_groups / plannedVsActual.planned_groups) * 100) : 0
    };
  }

  /**
   * Compute group performance analytics
   */
  private async computeGroupPerformance(sessionId: string, sessionData: any): Promise<GroupAnalytics[]> {
    const groups = await this.databricksService.query(`
      SELECT 
        g.*,
        COUNT(p.id) as member_count,
        AVG(CASE WHEN p.is_active THEN 1 ELSE 0 END) as engagement_rate
      FROM student_groups g
      LEFT JOIN participants p ON g.id = p.group_id
      WHERE g.session_id = ?
      GROUP BY g.id, g.name, g.created_at
    `, [sessionId]);

    return groups.map(group => ({
      groupId: group.id,
      memberCount: group.member_count || 0,
      engagementScore: Math.round((group.engagement_rate || 0) * 100),
      participationRate: Math.round((group.engagement_rate || 0) * 100),
      readyTime: group.first_member_joined
    }));
  }

  /**
   * Persist computed analytics to database
   */
  private async persistAnalytics(sessionId: string, computedAnalytics: ComputedAnalytics): Promise<void> {
    const { sessionAnalyticsOverview, computationMetadata } = computedAnalytics;

    // Store in session_metrics table with the correct schema
    await this.databricksService.upsert(
      'session_metrics',  // ✅ Use correct table name
      { session_id: sessionId },
      {
        session_id: sessionId,
        calculation_timestamp: new Date(),
        total_students: sessionAnalyticsOverview.totalStudents,
        active_students: sessionAnalyticsOverview.activeStudents,
        participation_rate: sessionAnalyticsOverview.participationRate / 100, // Convert back to decimal
        average_speaking_time_seconds: 0, // Will be calculated from transcriptions if available
        speaking_time_std_dev: 0,
        overall_engagement_score: sessionAnalyticsOverview.overallEngagement,
        attention_score: sessionAnalyticsOverview.overallEngagement,
        interaction_score: sessionAnalyticsOverview.participationRate,
        collaboration_score: sessionAnalyticsOverview.overallEngagement,
        on_topic_percentage: 85, // Default value, will be calculated from AI analysis
        academic_vocabulary_usage: 70, // Default value, will be calculated from AI analysis
        question_asking_rate: 0, // Will be calculated from transcriptions
        group_formation_time_seconds: 0, // Will be calculated from session events
        average_group_size: sessionAnalyticsOverview.averageGroupSize,
        group_stability_score: 80, // Default value, will be calculated from group dynamics
        average_connection_quality: 90, // Default value, will be calculated from technical metrics
        technical_issues_count: 0, // Will be calculated from error logs
        created_at: new Date()
      }
    );

    // Update session_analytics_cache with computed values
    await this.databricksService.upsert(
      'session_analytics_cache',
      { session_id: sessionId },
      {
        session_id: sessionId,
        actual_groups: sessionAnalyticsOverview.actualGroups,
        ready_groups_at_start: sessionAnalyticsOverview.readyGroupsAtStart,
        ready_groups_at_5m: sessionAnalyticsOverview.readyGroupsAt5m,
        ready_groups_at_10m: sessionAnalyticsOverview.readyGroupsAt10m,
        avg_participation_rate: sessionAnalyticsOverview.participationRate / 100,
        avg_engagement_score: sessionAnalyticsOverview.overallEngagement,
        last_updated: new Date()
      }
    );

    // Store group analytics in group_metrics table
    for (const groupAnalytics of computedAnalytics.groupAnalytics) {
      await this.databricksService.upsert(
        'group_metrics',
        { group_id: groupAnalytics.groupId, session_id: sessionId },
        {
          group_id: groupAnalytics.groupId,
          session_id: sessionId,
          calculation_timestamp: new Date(),
          participation_equality_index: 0.8, // Default value, will be calculated from speaking patterns
          dominant_speaker_percentage: 0, // Will be calculated from transcriptions
          silent_members_count: groupAnalytics.memberCount - Math.ceil(groupAnalytics.memberCount * (groupAnalytics.participationRate / 100)),
          turn_taking_score: groupAnalytics.engagementScore,
          interruption_rate: 0, // Will be calculated from transcriptions
          supportive_interactions_count: 0, // Will be calculated from transcriptions
          topic_coherence_score: 75, // Default value, will be calculated from AI analysis
          vocabulary_diversity_score: 70, // Default value, will be calculated from AI analysis
          academic_discourse_score: groupAnalytics.engagementScore,
          average_sentiment_score: 0.7, // Default value, will be calculated from AI analysis
          emotional_support_instances: 0, // Will be calculated from AI analysis
          conflict_instances: 0, // Will be calculated from AI analysis
          created_at: new Date()
        }
      );
    }
  }

  /**
   * Emit analytics:finalized event after successful computation
   */
  async emitAnalyticsFinalized(sessionId: string): Promise<void> {
    try {
      websocketService.emitToSession(sessionId, 'analytics:finalized', {
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
    return await this.databricksService.queryOne(`
      SELECT * FROM classroom_sessions WHERE id = ?
    `, [sessionId]);
  }

  private async getExistingAnalytics(sessionId: string): Promise<ComputedAnalytics | null> {
    const existing = await this.databricksService.queryOne(`
      SELECT 
        total_students, active_students, participation_rate,
        overall_engagement_score, created_at
      FROM session_metrics 
      WHERE session_id = ?
      ORDER BY created_at DESC LIMIT 1
    `, [sessionId]);

    if (existing) {
      return {
        sessionAnalyticsOverview: {
          sessionId,
          totalStudents: existing.total_students || 0,
          activeStudents: existing.active_students || 0,
          participationRate: Math.round((existing.participation_rate || 0) * 100),
          overallEngagement: existing.overall_engagement_score || 0,
          groupCount: 0, // Would need to fetch separately if needed
          averageGroupSize: 0,
          sessionDuration: 0,
          plannedGroups: 0,
          actualGroups: 0,
          readyGroupsAtStart: 0,
          readyGroupsAt5m: 0,
          readyGroupsAt10m: 0,
          memberAdherence: 0
        },
        groupAnalytics: [], // Would need to fetch separately if needed
        computationMetadata: {
          computationId: 'legacy',
          computedAt: existing.created_at,
          version: '1.0',
          status: 'completed',
          processingTime: 0
        }
      };
    }

    return null;
  }

  private async markComputationInProgress(sessionId: string, computationId: string): Promise<void> {
    // Store computation status in session_metrics table
    await this.databricksService.upsert(
      'session_metrics',
      { session_id: sessionId },
      {
        session_id: sessionId,
        calculation_timestamp: new Date(),
        total_students: 0, // Will be updated when computation completes
        active_students: 0,
        participation_rate: 0,
        overall_engagement_score: 0,
        created_at: new Date()
      }
    );
  }

  private async markComputationFailed(sessionId: string, computationId: string, error: any): Promise<void> {
    // Update session_metrics to indicate failure
    await this.databricksService.upsert(
      'session_metrics',
      { session_id: sessionId },
      {
        session_id: sessionId,
        calculation_timestamp: new Date(),
        total_students: 0,
        active_students: 0,
        participation_rate: 0,
        overall_engagement_score: 0,
        technical_issues_count: 1, // Indicate there was an issue
        created_at: new Date()
      }
    );
  }
}

// Export singleton instance
export const analyticsComputationService = new AnalyticsComputationService(
  new DatabricksService()
);
