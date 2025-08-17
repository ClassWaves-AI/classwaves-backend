/**
 * Analytics Computation Service
 * 
 * Robust, idempotent service for computing comprehensive session analytics.
 * Follows the implementation plan for zero-polling, event-driven architecture.
 */

import { DatabricksService } from './databricks.service';
import { websocketService } from './websocket.service';
import { RetryService } from './retry.service';
import { v4 as uuidv4 } from 'uuid';

// Error types for analytics computation
export enum AnalyticsErrorType {
  TIMEOUT = 'TIMEOUT',
  DATABASE_CONNECTION = 'DATABASE_CONNECTION', 
  DATA_CORRUPTION = 'DATA_CORRUPTION',
  COMPUTATION_FAILED = 'COMPUTATION_FAILED',
  WEBSOCKET_FAILED = 'WEBSOCKET_FAILED',
  PARTIAL_FAILURE = 'PARTIAL_FAILURE'
}

export class AnalyticsComputationError extends Error {
  constructor(
    public type: AnalyticsErrorType,
    message: string,
    public sessionId?: string,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'AnalyticsComputationError';
  }
}

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
    errors?: string[];
  };
}

export class AnalyticsComputationService {
  private readonly ANALYTICS_VERSION = '2.0';
  
  // Configuration for robust error handling
  private readonly config = {
    timeout: {
      computation: 30000, // 30 seconds max for entire computation
      database: 10000,    // 10 seconds max per database query
      websocket: 5000     // 5 seconds max for WebSocket emission
    },
    circuitBreaker: {
      failureThreshold: 5,     // Open circuit after 5 failures
      resetTimeout: 60000,     // Try to close circuit after 1 minute
      monitoringWindow: 300000 // 5 minute monitoring window
    },
    retry: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 5000
    }
  };

  // Circuit breaker state
  private circuitBreaker = {
    state: 'CLOSED' as 'CLOSED' | 'OPEN' | 'HALF_OPEN',
    failures: 0,
    lastFailureTime: 0,
    successCount: 0
  };

  constructor(
    private databricksService: DatabricksService
  ) {}

  /**
   * Circuit breaker implementation
   */
  private checkCircuitBreaker(): void {
    const now = Date.now();
    
    // Reset failure count if monitoring window has passed
    if (now - this.circuitBreaker.lastFailureTime > this.config.circuitBreaker.monitoringWindow) {
      this.circuitBreaker.failures = 0;
    }

    // Check if circuit should be opened
    if (this.circuitBreaker.state === 'CLOSED' && 
        this.circuitBreaker.failures >= this.config.circuitBreaker.failureThreshold) {
      this.circuitBreaker.state = 'OPEN';
      console.warn(`🔴 Analytics circuit breaker OPENED after ${this.circuitBreaker.failures} failures`);
    }

    // Check if circuit should move to half-open
    if (this.circuitBreaker.state === 'OPEN' && 
        now - this.circuitBreaker.lastFailureTime > this.config.circuitBreaker.resetTimeout) {
      this.circuitBreaker.state = 'HALF_OPEN';
      this.circuitBreaker.successCount = 0;
      console.log(`🟡 Analytics circuit breaker moved to HALF_OPEN`);
    }

    // Throw error if circuit is open
    if (this.circuitBreaker.state === 'OPEN') {
      throw new AnalyticsComputationError(
        AnalyticsErrorType.DATABASE_CONNECTION,
        'Analytics service temporarily unavailable due to repeated failures. Please try again later.',
        undefined,
        new Error('Circuit breaker is OPEN')
      );
    }
  }

  private recordSuccess(): void {
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      this.circuitBreaker.successCount++;
      if (this.circuitBreaker.successCount >= 2) {
        this.circuitBreaker.state = 'CLOSED';
        this.circuitBreaker.failures = 0;
        console.log(`🟢 Analytics circuit breaker CLOSED after successful operations`);
      }
    }
  }

  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();
    
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      this.circuitBreaker.state = 'OPEN';
      console.warn(`🔴 Analytics circuit breaker reopened during half-open state`);
    }
  }

  /**
   * Compute comprehensive analytics for a session
   */
  async computeSessionAnalytics(sessionId: string): Promise<ComputedAnalytics> {
    const startTime = Date.now();
    const computationId = `analytics_${sessionId}_${Date.now()}`;

    // Check circuit breaker before starting
    this.checkCircuitBreaker();

    // Set up timeout for entire computation
    const computationTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new AnalyticsComputationError(
          AnalyticsErrorType.TIMEOUT,
          `Analytics computation timed out after ${this.config.timeout.computation}ms`,
          sessionId
        ));
      }, this.config.timeout.computation);
    });

    try {
      const result = await Promise.race([
        this.executeComputationWithFallbacks(sessionId, computationId, startTime),
        computationTimeout
      ]);

      // Record success for circuit breaker
      this.recordSuccess();
      
      return result;

    } catch (error) {
      // Record failure for circuit breaker
      this.recordFailure();
      
      // Classify and handle the error
      const classifiedError = this.classifyError(error, sessionId);
      
      console.error(`❌ Analytics computation failed for session ${sessionId}:`, {
        errorType: classifiedError.type,
        message: classifiedError.message,
        originalError: error instanceof Error ? error.message : String(error)
      });
      
      // Mark computation as failed
      await this.markComputationFailed(sessionId, computationId, classifiedError);
      
      // Try to provide fallback analytics if possible
      const fallbackAnalytics = await this.tryFallbackAnalytics(sessionId, classifiedError);
      if (fallbackAnalytics) {
        console.log(`✅ Provided fallback analytics for session ${sessionId}`);
        return fallbackAnalytics;
      }
      
      throw classifiedError;
    }
  }

  /**
   * Execute computation with partial failure recovery
   */
  private async executeComputationWithFallbacks(
    sessionId: string, 
    computationId: string, 
    startTime: number
  ): Promise<ComputedAnalytics> {
    // Mark computation as in progress
    await this.markComputationInProgress(sessionId, computationId);

    // Check for existing analytics first
    const existingAnalytics = await this.getExistingAnalytics(sessionId);
    if (existingAnalytics) {
      return existingAnalytics;
    }

    // Fetch session data with timeout
    const sessionData = await this.executeWithTimeout(
      () => this.fetchSessionData(sessionId),
      this.config.timeout.database,
      'Fetch session data'
    );
    
    if (!sessionData) {
      throw new AnalyticsComputationError(
        AnalyticsErrorType.DATA_CORRUPTION,
        `Session ${sessionId} not found`,
        sessionId
      );
    }

    // Compute analytics with partial failure recovery
    let sessionAnalyticsOverview: SessionAnalyticsOverview;
    let groupAnalytics: GroupAnalytics[] = [];
    const errors: Error[] = [];

    try {
      // Try to compute session overview
      sessionAnalyticsOverview = await this.executeWithTimeout(
        () => this.computeSessionOverview(sessionId, sessionData),
        this.config.timeout.database,
        'Compute session overview'
      );
    } catch (error) {
      errors.push(error as Error);
      // Provide minimal session analytics as fallback
      sessionAnalyticsOverview = this.createMinimalSessionAnalytics(sessionId, sessionData);
      console.warn(`⚠️ Using minimal session analytics for ${sessionId} due to error:`, error);
    }

    try {
      // Try to compute group analytics
      groupAnalytics = await this.executeWithTimeout(
        () => this.computeGroupPerformance(sessionId, sessionData),
        this.config.timeout.database,
        'Compute group performance'
      );
    } catch (error) {
      errors.push(error as Error);
      // Continue without group analytics
      console.warn(`⚠️ Skipping group analytics for ${sessionId} due to error:`, error);
    }

    const computationMetadata = {
      computationId,
      computedAt: new Date(),
      version: this.ANALYTICS_VERSION,
      status: errors.length > 0 ? 'partial_success' : 'completed',
      processingTime: Date.now() - startTime,
      errors: errors.map(e => e.message)
    };

    const computedAnalytics: ComputedAnalytics = {
      sessionAnalyticsOverview,
      groupAnalytics,
      computationMetadata
    };

    // Persist analytics to database
    try {
      await this.executeWithTimeout(
        () => this.persistAnalytics(sessionId, computedAnalytics),
        this.config.timeout.database,
        'Persist analytics'
      );
    } catch (error) {
      console.warn(`⚠️ Failed to persist analytics for ${sessionId}, continuing with computed result:`, error);
    }

    // Emit WebSocket event (non-blocking)
    this.emitAnalyticsFinalized(sessionId).catch(error => {
      console.warn(`⚠️ Failed to emit analytics:finalized for ${sessionId}:`, error);
    });
    
    return computedAnalytics;
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
    const participationRate = plannedVsActual?.avg_participation_rate || (totalStudents > 0 ? (activeStudents / totalStudents) : 0);

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
      FROM classwaves.sessions.student_groups g
      LEFT JOIN classwaves.sessions.participants p ON g.id = p.group_id
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

    } catch (error) {
      console.error(`Failed to emit analytics:finalized for session ${sessionId}:`, error);
    }
  }

  /**
   * Execute operation with timeout
   */
  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new AnalyticsComputationError(
          AnalyticsErrorType.TIMEOUT,
          `${operationName} timed out after ${timeoutMs}ms`
        ));
      }, timeoutMs);
    });

    return Promise.race([operation(), timeout]);
  }

  /**
   * Classify errors for better handling
   */
  private classifyError(error: any, sessionId?: string): AnalyticsComputationError {
    if (error instanceof AnalyticsComputationError) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    const lowerMessage = message.toLowerCase();

    // Database connection errors
    if (lowerMessage.includes('connection') || lowerMessage.includes('timeout') || 
        lowerMessage.includes('econnreset') || lowerMessage.includes('etimedout')) {
      return new AnalyticsComputationError(
        AnalyticsErrorType.DATABASE_CONNECTION,
        'Database connection failed. Analytics service will retry automatically.',
        sessionId,
        error
      );
    }

    // Data corruption errors
    if (lowerMessage.includes('not found') || lowerMessage.includes('invalid') ||
        lowerMessage.includes('malformed') || lowerMessage.includes('corrupt')) {
      return new AnalyticsComputationError(
        AnalyticsErrorType.DATA_CORRUPTION,
        'Session data is invalid or corrupted. Please check session configuration.',
        sessionId,
        error
      );
    }

    // Timeout errors
    if (lowerMessage.includes('timeout') || lowerMessage.includes('timed out')) {
      return new AnalyticsComputationError(
        AnalyticsErrorType.TIMEOUT,
        'Analytics computation took too long. This may indicate high system load.',
        sessionId,
        error
      );
    }

    // Default to computation failed
    return new AnalyticsComputationError(
      AnalyticsErrorType.COMPUTATION_FAILED,
      'Analytics computation failed due to an unexpected error.',
      sessionId,
      error
    );
  }

  /**
   * Create minimal session analytics when full computation fails
   */
  private createMinimalSessionAnalytics(sessionId: string, sessionData: any): SessionAnalyticsOverview {
    return {
      sessionId,
      totalStudents: 0,
      activeStudents: 0,
      participationRate: 0,
      overallEngagement: 0,
      groupCount: 0,
      averageGroupSize: 0,
      sessionDuration: sessionData?.duration_minutes || 0,
      plannedGroups: 0,
      actualGroups: 0,
      readyGroupsAtStart: 0,
      readyGroupsAt5m: 0,
      readyGroupsAt10m: 0,
      memberAdherence: 0
    };
  }

  /**
   * Try to provide fallback analytics from cached data
   */
  private async tryFallbackAnalytics(
    sessionId: string, 
    error: AnalyticsComputationError
  ): Promise<ComputedAnalytics | null> {
    try {
      // Only provide fallback for certain error types
      if (error.type === AnalyticsErrorType.DATABASE_CONNECTION || 
          error.type === AnalyticsErrorType.TIMEOUT) {
        
        // Try to get cached analytics
        const cachedAnalytics = await this.databricksService.queryOne(`
          SELECT * FROM session_analytics_cache 
          WHERE session_id = ? 
          ORDER BY last_updated DESC 
          LIMIT 1
        `, [sessionId]);

        if (cachedAnalytics) {
          console.log(`📦 Using cached analytics for session ${sessionId}`);
          
          return {
            sessionAnalyticsOverview: {
              sessionId,
              totalStudents: cachedAnalytics.total_students || 0,
              activeStudents: cachedAnalytics.active_students || 0,
              participationRate: Math.round((cachedAnalytics.avg_participation_rate || 0) * 100),
              overallEngagement: Math.round((cachedAnalytics.avg_participation_rate || 0) * 100),
              groupCount: cachedAnalytics.actual_groups || 0,
              averageGroupSize: cachedAnalytics.avg_group_size || 0,
              sessionDuration: cachedAnalytics.session_duration || 0,
              plannedGroups: cachedAnalytics.planned_groups || 0,
              actualGroups: cachedAnalytics.actual_groups || 0,
              readyGroupsAtStart: cachedAnalytics.ready_groups_at_start || 0,
              readyGroupsAt5m: cachedAnalytics.ready_groups_at_5m || 0,
              readyGroupsAt10m: cachedAnalytics.ready_groups_at_10m || 0,
              memberAdherence: cachedAnalytics.member_adherence || 0
            },
            groupAnalytics: [], // No group analytics in fallback
            computationMetadata: {
              computationId: `fallback_${sessionId}_${Date.now()}`,
              computedAt: new Date(),
              version: this.ANALYTICS_VERSION,
              status: 'fallback_from_cache',
              processingTime: 0
            }
          };
        }
      }
    } catch (fallbackError) {
      console.warn(`⚠️ Fallback analytics also failed for ${sessionId}:`, fallbackError);
    }

    return null;
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
