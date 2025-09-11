/**
 * AI Analysis Buffering Service
 * 
 * Manages in-memory buffering of transcriptions for AI analysis with:
 * - FERPA/COPPA compliance (group-level analysis only)
 * - Zero disk storage (strictly in-memory processing)
 * - Comprehensive audit logging
 * - Automatic memory cleanup
 */

import { databricksService } from './databricks.service';
import type { Tier1Insights, Tier2Insights } from '../types/ai-analysis.types';

// Validation moved to edges (routes/controllers/websocket). This service assumes
// inputs are pre-validated and focuses on buffering and analytics logic.

// ============================================================================
// Buffer Types
// ============================================================================

interface TranscriptBuffer {
  transcripts: Array<{
    content: string;
    timestamp: Date;
    sequenceNumber: number;
  }>;
  windowStart: Date;
  lastUpdate: Date;
  lastAnalysis?: Date;
  groupId: string;
  sessionId: string;
  sequenceCounter: number;
}

interface BufferStats {
  totalBuffers: number;
  totalTranscripts: number;
  memoryUsageBytes: number;
  oldestBuffer?: Date;
  newestBuffer?: Date;
}

// ============================================================================
// Current Insights Types for Real-time Guidance
// ============================================================================

interface CurrentInsights {
  sessionId: string;
  lastUpdated: Date;
  tier1Insights: Array<{
    groupId: string;
    insights: Tier1Insights;
    bufferInfo: {
      transcriptCount: number;
      windowStart: Date;
      lastAnalysis?: Date;
    };
  }>;
  tier2Insights?: {
    insights: Tier2Insights;
    bufferInfo: {
      totalGroups: number;
      totalTranscripts: number;
      lastAnalysis?: Date;
    };
  };
  summary: {
    overallConfidence: number;
    averageTopicalCohesion: number;
    averageConceptualDensity: number;
    alertCount: number;
    keyMetrics: Record<string, number>;
    criticalAlerts: string[];
  };
  metadata: {
    dataAge: number; // milliseconds since last update
    cacheHit: boolean;
    processingTime: number;
  };
}

// ============================================================================
// AI Analysis Buffer Service
// ============================================================================

export class AIAnalysisBufferService {
  private tier1Buffers = new Map<string, TranscriptBuffer>();
  private tier2Buffers = new Map<string, TranscriptBuffer>();
  private insightsCache = new Map<string, { insights: CurrentInsights; timestamp: Date }>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  private readonly config = {
    maxBufferSize: parseInt(process.env.AI_BUFFER_MAX_SIZE || '50'),
    maxBufferAgeMs: parseInt(process.env.AI_BUFFER_MAX_AGE_MS || '60000'),
    tier1WindowMs: parseInt(process.env.AI_TIER1_WINDOW_MS || '30000'),
    tier2WindowMs: parseInt(process.env.AI_TIER2_WINDOW_MS || '180000'),
    cleanupIntervalMs: parseInt(process.env.AI_BUFFER_CLEANUP_INTERVAL_MS || '30000'),
  };

  constructor() {
    // Start automatic cleanup process (skip in test to avoid open handles)
    if (process.env.NODE_ENV !== 'test') {
      this.startCleanupProcess();
    }

    console.log('🔄 AI Analysis Buffer Service initialized', {
      maxBufferSize: this.config.maxBufferSize,
      tier1WindowMs: this.config.tier1WindowMs,
      tier2WindowMs: this.config.tier2WindowMs,
    });
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Buffer transcription for AI analysis processing
   * 
   * ✅ COMPLIANCE: Group-level analysis only (no individual student identification)
   * ✅ SECURITY: Input validation with Zod schemas
   * ✅ AUDIT: Comprehensive logging for educational data processing
   * ✅ MEMORY: In-memory only with automatic cleanup
   */
  async bufferTranscription(
    groupId: string,
    sessionId: string,
    transcription: string,
    options?: Partial<{ maxBufferSize: number; maxBufferAgeMs: number; tier1WindowMs: number; tier2WindowMs: number }>
  ): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Normalize lightweight options (no Zod in domain)
      const normalizedOptions = {
        maxBufferSize: Math.max(1, Math.min(100, options?.maxBufferSize ?? this.config.maxBufferSize)),
        maxBufferAgeMs: Math.max(1000, Math.min(300000, options?.maxBufferAgeMs ?? this.config.maxBufferAgeMs)),
        tier1WindowMs: Math.max(5000, Math.min(120000, options?.tier1WindowMs ?? this.config.tier1WindowMs)),
        tier2WindowMs: Math.max(60000, Math.min(600000, options?.tier2WindowMs ?? this.config.tier2WindowMs)),
      };

      // ✅ COMPLIANCE: Audit logging for educational data processing
      await this.auditLog({
        eventType: 'ai_analysis_buffer',
        actorId: 'system',
        targetType: 'group_transcription',
        targetId: groupId,
        educationalPurpose: 'Buffer transcripts for AI analysis to provide educational insights',
        complianceBasis: 'legitimate_educational_interest',
        sessionId,
        transcriptionLength: transcription.length
      });

      // Add to both tier buffers
      await Promise.all([
        this.addToBuffer('tier1', { groupId, sessionId, transcription, timestamp: new Date() } as any, normalizedOptions as any),
        this.addToBuffer('tier2', { groupId, sessionId, transcription, timestamp: new Date() } as any, normalizedOptions as any)
      ]);

      // ✅ MEMORY: Force garbage collection after processing
      if (global.gc) {
        global.gc();
      }

      const processingTime = Date.now() - startTime;
      console.log(`✅ Buffered transcription for group ${groupId} in ${processingTime}ms`);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Failed to buffer transcription for group ${groupId}:`, error);
      
      // ✅ COMPLIANCE: Audit log for errors
      await this.auditLog({
        eventType: 'ai_analysis_buffer_error',
        actorId: 'system',
        targetType: 'group_transcription',
        targetId: groupId,
        educationalPurpose: 'Log transcription buffering error for system monitoring',
        complianceBasis: 'system_administration',
        sessionId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }

  /**
   * Get buffered transcriptions for analysis
   * 
   * ✅ COMPLIANCE: Returns group-level data only
   * ✅ MEMORY: Does not persist data to disk
   */
  async getBufferedTranscripts(
    tier: 'tier1' | 'tier2',
    groupId: string,
    sessionId: string
  ): Promise<string[]> {
    try {
      const buffers = tier === 'tier1' ? this.tier1Buffers : this.tier2Buffers;
      const bufferKey = `${sessionId}:${groupId}`;
      const buffer = buffers.get(bufferKey);

      if (!buffer) {
        return [];
      }

      // ✅ COMPLIANCE: Audit data access
      await this.auditLog({
        eventType: 'ai_analysis_buffer_access',
        actorId: 'system',
        targetType: 'group_transcription_buffer',
        targetId: groupId,
        educationalPurpose: `Access buffered transcripts for ${tier} AI analysis`,
        complianceBasis: 'legitimate_educational_interest',
        sessionId,
        bufferSize: buffer.transcripts.length
      });

      // Return transcripts as string array
      return buffer.transcripts.map(t => t.content);

    } catch (error) {
      console.error(`❌ Failed to get buffered transcripts for group ${groupId}:`, error);
      throw error;
    }
  }

  /**
   * Get timestamp of the most recent buffered transcript for a given tier.
   * For tier1, requires groupId; for tier2, returns latest across session groups.
   */
  public getLastBufferedAt(
    tier: 'tier1' | 'tier2',
    sessionId: string,
    groupId?: string
  ): Date | null {
    try {
      if (tier === 'tier1') {
        if (!groupId) return null;
        const buf = this.tier1Buffers.get(`${sessionId}:${groupId}`);
        return buf?.lastUpdate || null;
      }
      // tier2: scan buffers for the session and return latest update
      let latest: Date | null = null;
      for (const [, buf] of Array.from(this.tier2Buffers.entries())) {
        if (buf.sessionId === sessionId) {
          if (!latest || buf.lastUpdate > latest) latest = buf.lastUpdate;
        }
      }
      return latest;
    } catch {
      return null;
    }
  }

  /**
   * Mark buffer as analyzed to optimize future processing
   */
  async markBufferAnalyzed(
    tier: 'tier1' | 'tier2',
    groupId: string,
    sessionId: string
  ): Promise<void> {
    const buffers = tier === 'tier1' ? this.tier1Buffers : this.tier2Buffers;
    const bufferKey = `${sessionId}:${groupId}`;
    const buffer = buffers.get(bufferKey);

    if (buffer) {
      buffer.lastAnalysis = new Date();
      
      // ✅ COMPLIANCE: Audit analysis completion
      await this.auditLog({
        eventType: 'ai_analysis_buffer_analyzed',
        actorId: 'system',
        targetType: 'group_transcription_buffer',
        targetId: groupId,
        educationalPurpose: `Mark ${tier} analysis completion for optimization`,
        complianceBasis: 'system_administration',
        sessionId
      });
    }
  }

  /**
   * Get current AI insights for a session
   * 
   * ✅ COMPLIANCE: Aggregates group-level insights only
   * ✅ PERFORMANCE: Implements intelligent caching with TTL
   * ✅ REAL-TIME: Provides fresh insights for guidance system
   * ✅ RELIABILITY: Graceful handling of partial data availability
   */
  async getCurrentInsights(sessionId: string, options?: {
    maxAge?: number; // minutes, default 5
    includeMetadata?: boolean;
  }): Promise<CurrentInsights> {
    const startTime = Date.now();

    try {
      // ✅ SECURITY: Input validation
      if (!sessionId || typeof sessionId !== 'string') {
        throw new Error('Invalid sessionId provided');
      }

      // ✅ COMPLIANCE: Audit logging for insights access
      await this.auditLog({
        eventType: 'ai_insights_access',
        actorId: 'system',
        targetType: 'session_insights',
        targetId: sessionId,
        educationalPurpose: 'Retrieve current AI insights for real-time teacher guidance',
        complianceBasis: 'legitimate_educational_interest',
        sessionId
      });

      const maxAge = (options?.maxAge || 5) * 60000; // Convert to milliseconds
      const now = new Date();

      // Step 1: Check cache for recent insights
      const cached = this.insightsCache.get(sessionId);
      if (cached && (now.getTime() - cached.timestamp.getTime()) < maxAge) {
        console.log(`✅ Retrieved cached insights for session ${sessionId}`);
        return {
          ...cached.insights,
          metadata: {
            ...cached.insights.metadata,
            cacheHit: true,
            processingTime: Date.now() - startTime
          }
        };
      }

      // Step 2: Build fresh insights from buffers
      const insights = await this.buildCurrentInsights(sessionId, maxAge);

      // Step 3: Cache the results
      this.insightsCache.set(sessionId, {
        insights,
        timestamp: now
      });

      const processingTime = Date.now() - startTime;
      console.log(`✅ Built fresh insights for session ${sessionId} in ${processingTime}ms`);

      return {
        ...insights,
        metadata: {
          ...insights.metadata,
          cacheHit: false,
          processingTime
        }
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Failed to get current insights for session ${sessionId}:`, error);

      // ✅ COMPLIANCE: Audit log for errors
      await this.auditLog({
        eventType: 'ai_insights_access_error',
        actorId: 'system',
        targetType: 'session_insights',
        targetId: sessionId,
        educationalPurpose: 'Log insights access error for system monitoring',
        complianceBasis: 'system_administration',
        sessionId,
        error: (error as Error).message
      });

      throw error;
    }
  }

  /**
   * Build current insights from available buffers and recent analysis
   */
  private async buildCurrentInsights(sessionId: string, maxAge: number): Promise<CurrentInsights> {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - maxAge);

    // Step 1: Gather Tier 1 insights from all groups in the session
    const tier1Insights: CurrentInsights['tier1Insights'] = [];
    let totalTopicalCohesion = 0;
    let totalConceptualDensity = 0;
    let validTier1Count = 0;
    let attempts = 0;
    let failures = 0;

    const errors: Error[] = [];
    for (const [bufferKey, buffer] of Array.from(this.tier1Buffers.entries())) {
      if (buffer.sessionId === sessionId && buffer.lastUpdate >= cutoffTime) {
        attempts++;
        try {
          // Get latest analysis from database for this group
          const latestAnalysis = await this.getLatestTier1AnalysisFromDB(buffer.groupId, sessionId);
          
          if (latestAnalysis) {
            tier1Insights.push({
              groupId: buffer.groupId,
              insights: latestAnalysis,
              bufferInfo: {
                transcriptCount: buffer.transcripts.length,
                windowStart: buffer.windowStart,
                lastAnalysis: buffer.lastAnalysis
              }
            });

            // Aggregate metrics for summary
            totalTopicalCohesion += latestAnalysis.topicalCohesion;
            totalConceptualDensity += latestAnalysis.conceptualDensity;
            validTier1Count++;
          }
        } catch (error) {
          // Gracefully degrade for partial group failures; record and continue
          console.warn(`⚠️ Failed to load Tier 1 analysis for group ${buffer.groupId}:`, (error as Error)?.message || error);
          errors.push(error as Error);
          failures++;
          continue;
        }
      }
    }

    // Step 2: Gather Tier 2 insights for the session
    let tier2Insights: CurrentInsights['tier2Insights'];
    let tier2TotalGroups = 0;
    let tier2TotalTranscripts = 0;

    try {
      attempts++;
      const latestTier2 = await this.getLatestTier2AnalysisFromDB(sessionId);
      if (latestTier2) {
        // Count groups and transcripts in tier2 buffers for this session
        for (const [, buffer] of Array.from(this.tier2Buffers.entries())) {
          if (buffer.sessionId === sessionId) {
            tier2TotalGroups++;
            tier2TotalTranscripts += buffer.transcripts.length;
          }
        }

        tier2Insights = {
          insights: latestTier2,
          bufferInfo: {
            totalGroups: tier2TotalGroups,
            totalTranscripts: tier2TotalTranscripts,
            lastAnalysis: this.getLatestTier2Analysis(sessionId)
          }
        };
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load Tier 2 analysis for session ${sessionId}:`, (error as Error)?.message || error);
      errors.push(error as Error);
      failures++;
    }

    // Step 3: Build summary metrics
    const averageTopicalCohesion = validTier1Count > 0 ? totalTopicalCohesion / validTier1Count : 0;
    const averageConceptualDensity = validTier1Count > 0 ? totalConceptualDensity / validTier1Count : 0;
    const overallConfidence = this.calculateOverallConfidence(tier1Insights, tier2Insights);
    
    // Identify critical alerts
    const criticalAlerts: string[] = [];
    let alertCount = 0;

    tier1Insights.forEach(group => {
      group.insights.insights.forEach(insight => {
        alertCount++;
        if (insight.severity === 'warning') {
          criticalAlerts.push(`Group ${group.groupId}: ${insight.message}`);
        }
      });
    });

    if (tier2Insights) {
      // Count all recommendations; mark only 'high' as critical
      alertCount += tier2Insights.insights.recommendations.length;
      tier2Insights.insights.recommendations.forEach(rec => {
        if (rec.priority === 'high') {
          criticalAlerts.push(`Session: ${rec.message}`);
        }
      });
    }

    const hasAnyInsights = tier1Insights.length > 0 || !!tier2Insights;
    const allAttemptsFailed = attempts > 0 && failures >= attempts;
    if (!hasAnyInsights && allAttemptsFailed) {
      // If every attempted DB call failed, bubble up a representative error
      throw errors[0];
    }

    return {
      sessionId,
      lastUpdated: now,
      tier1Insights,
      tier2Insights,
      summary: {
        overallConfidence,
        averageTopicalCohesion,
        averageConceptualDensity,
        alertCount,
        keyMetrics: {
          activeGroups: tier1Insights.length,
          totalTranscripts: tier1Insights.reduce((sum, g) => sum + g.bufferInfo.transcriptCount, 0),
          recentAnalyses: tier1Insights.filter(g => g.bufferInfo.lastAnalysis && 
            (now.getTime() - g.bufferInfo.lastAnalysis.getTime()) < 300000).length // 5 minutes
        },
        criticalAlerts
      },
      metadata: {
        dataAge: 0, // Will be set by caller
        cacheHit: false, // Will be set by caller
        processingTime: 0 // Will be set by caller
      }
    };
  }

  /**
   * Get latest Tier 1 analysis from database
   */
  private async getLatestTier1AnalysisFromDB(
    groupId: string, 
    sessionId: string
  ): Promise<Tier1Insights | null> {
    const query = `SELECT result_data FROM classwaves.ai_insights.analysis_results 
       WHERE analysis_type = 'tier1' 
       AND session_id = ? 
       AND get_json_object(result_data, '$.groupId') = ?
       ORDER BY analysis_timestamp DESC LIMIT 1`;

    const result = await databricksService.queryOne(query, [sessionId, groupId]);
    if (result && result.result_data) {
      return JSON.parse(result.result_data) as Tier1Insights;
    }
    return null;
  }

  /**
   * Get latest Tier 2 analysis from database
   */
  private async getLatestTier2AnalysisFromDB(
    sessionId: string
  ): Promise<Tier2Insights | null> {
    const query = `SELECT result_data FROM classwaves.ai_insights.analysis_results 
       WHERE analysis_type = 'tier2' 
       AND session_id = ? 
       ORDER BY analysis_timestamp DESC LIMIT 1`;

    const result = await databricksService.queryOne(query, [sessionId]);
    if (result && result.result_data) {
      return JSON.parse(result.result_data) as Tier2Insights;
    }
    return null;
  }

  /**
   * Get latest Tier 2 analysis timestamp for session
   */
  private getLatestTier2Analysis(sessionId: string): Date | undefined {
    for (const [bufferKey, buffer] of Array.from(this.tier2Buffers.entries())) {
      if (buffer.sessionId === sessionId && buffer.lastAnalysis) {
        return buffer.lastAnalysis;
      }
    }
    return undefined;
  }

  /**
   * Calculate overall confidence score from available insights
   */
  private calculateOverallConfidence(
    tier1Insights: CurrentInsights['tier1Insights'], 
    tier2Insights?: CurrentInsights['tier2Insights']
  ): number {
    let totalConfidence = 0;
    let count = 0;

    // Weight Tier 1 insights
    tier1Insights.forEach(group => {
      totalConfidence += group.insights.confidence * 0.6; // Lower weight for real-time
      count++;
    });

    // Weight Tier 2 insights higher if available
    if (tier2Insights) {
      totalConfidence += tier2Insights.insights.confidence * 0.8; // Higher weight for deep analysis
      count++;
    }

    return count > 0 ? totalConfidence / count : 0;
  }

  /**
   * Get buffer statistics for monitoring
   */
  getBufferStats(): { tier1: BufferStats; tier2: BufferStats } {
    return {
      tier1: this.calculateBufferStats(this.tier1Buffers),
      tier2: this.calculateBufferStats(this.tier2Buffers)
    };
  }

  /**
   * Manually trigger cleanup process
   */
  async cleanup(): Promise<void> {
    await this.performCleanup();
  }

  /**
   * Shutdown service and cleanup resources
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.tier1Buffers.clear();
    this.tier2Buffers.clear();
    
    // ✅ MEMORY: Force garbage collection
    if (global.gc) {
      global.gc();
    }
    
    console.log('🛑 AI Analysis Buffer Service shutdown completed');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async addToBuffer(
    tier: 'tier1' | 'tier2',
    validated: { groupId: string; sessionId: string; transcription: string; timestamp: Date },
    options: { maxBufferSize: number; maxBufferAgeMs: number; tier1WindowMs: number; tier2WindowMs: number }
  ): Promise<void> {
    const buffers = tier === 'tier1' ? this.tier1Buffers : this.tier2Buffers;
    const bufferKey = `${validated.sessionId}:${validated.groupId}`;
    
    let buffer = buffers.get(bufferKey);
    
    if (!buffer) {
      buffer = {
        transcripts: [],
        windowStart: validated.timestamp,
        lastUpdate: validated.timestamp,
        groupId: validated.groupId,
        sessionId: validated.sessionId,
        sequenceCounter: 0
      };
      buffers.set(bufferKey, buffer);
    }

    // Add transcript with sequence number
    buffer.transcripts.push({
      content: validated.transcription,
      timestamp: validated.timestamp,
      sequenceNumber: ++buffer.sequenceCounter
    });
    
    buffer.lastUpdate = validated.timestamp;

    // Enforce buffer size limits
    const maxSize = options?.maxBufferSize || this.config.maxBufferSize;
    if (buffer.transcripts.length > maxSize) {
      buffer.transcripts = buffer.transcripts.slice(-maxSize);
    }
  }

  private calculateBufferStats(buffers: Map<string, TranscriptBuffer>): BufferStats {
    let totalTranscripts = 0;
    let memoryUsageBytes = 0;
    let oldestBuffer: Date | undefined;
    let newestBuffer: Date | undefined;

    for (const buffer of Array.from(buffers.values())) {
      totalTranscripts += buffer.transcripts.length;
      
      // Estimate memory usage
      for (const transcript of buffer.transcripts) {
        memoryUsageBytes += transcript.content.length * 2; // Rough estimate for UTF-16
      }
      
      if (!oldestBuffer || buffer.windowStart < oldestBuffer) {
        oldestBuffer = buffer.windowStart;
      }
      
      if (!newestBuffer || buffer.lastUpdate > newestBuffer) {
        newestBuffer = buffer.lastUpdate;
      }
    }

    return {
      totalBuffers: buffers.size,
      totalTranscripts,
      memoryUsageBytes,
      oldestBuffer,
      newestBuffer
    };
  }

  private startCleanupProcess(): void {
    this.cleanupInterval = setInterval(() => {
      this.performCleanup().catch(error => {
        console.error('❌ Buffer cleanup failed:', error);
      });
    }, this.config.cleanupIntervalMs);
    // Do not keep the event loop alive solely for cleanup
    (this.cleanupInterval as any)?.unref?.();
  }

  private async performCleanup(): Promise<void> {
    const now = new Date();
    let cleanedCount = 0;

    // Clean tier1 buffers (shorter retention)
    cleanedCount += this.cleanupBufferMap(this.tier1Buffers, now, this.config.tier1WindowMs * 2);
    
    // Clean tier2 buffers (longer retention)
    cleanedCount += this.cleanupBufferMap(this.tier2Buffers, now, this.config.tier2WindowMs * 2);

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} old buffers`);
      
      // ✅ MEMORY: Force garbage collection after cleanup
      if (global.gc) {
        global.gc();
      }
    }
  }

  private cleanupBufferMap(
    buffers: Map<string, TranscriptBuffer>,
    now: Date,
    maxAgeMs: number
  ): number {
    let cleanedCount = 0;
    
    for (const [key, buffer] of Array.from(buffers.entries())) {
      const age = now.getTime() - buffer.lastUpdate.getTime();
      if (age > maxAgeMs) {
        buffers.delete(key);
        cleanedCount++;
      }
    }
    
    return cleanedCount;
  }

  private async auditLog(data: {
    eventType: string;
    actorId: string;
    targetType: string;
    targetId: string;
    educationalPurpose: string;
    complianceBasis: string;
    sessionId: string;
    transcriptionLength?: number;
    bufferSize?: number;
    error?: string;
  }): Promise<void> {
    try {
      const { auditLogPort } = await import('../utils/audit.port.instance');
      auditLogPort.enqueue({
        actorId: data.actorId,
        actorType: 'system',
        eventType: data.eventType,
        eventCategory: 'data_access',
        resourceType: data.targetType,
        resourceId: data.targetId,
        schoolId: 'system', // System-level operation
        description: `${data.educationalPurpose} - session:${data.sessionId}`,
        sessionId: data.sessionId,
        complianceBasis: 'legitimate_interest',
        dataAccessed: data.transcriptionLength ? `transcription_${data.transcriptionLength}_chars` : 'buffer_metadata'
      }).catch(() => {});
    } catch (error) {
      // Don't fail the main operation if audit logging fails
      console.warn('⚠️ Audit logging failed in AI buffer service:', error);
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const aiAnalysisBufferService = new AIAnalysisBufferService();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  aiAnalysisBufferService.shutdown();
});

process.on('SIGINT', () => {
  aiAnalysisBufferService.shutdown();
});
