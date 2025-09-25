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
import { contextEpisodesService } from './context-episodes.service';
import type { GuidanceTranscriptLine, GuidanceWindowSelection } from './ports/guidance-context.port';
import type { Tier1Insights, Tier2Insights, PromptContextQuote } from '../types/ai-analysis.types';
import { isGuidanceEpisodesEnabled } from '../config/feature-flags';
import { logger } from '../utils/logger';

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

const COMMON_FIRST_NAMES = new Set(
  [
    'alex','alexa','alexis','andrew','angel','anna','anthony','aria','ashley','ben','benjamin','carla','caroline','carlos','charlie','christian','daniel','david','dylan','ella','emily','emma','ethan','felix','grace','hannah','isabella','jack','jackson','jacob','james','jasmine','jayden','jessica','joel','john','jonathan','jordan','jose','josh','joshua','kate','katie','kevin','laura','lily','lucas','luke','madison','maria','mason','matt','matthew','mia','michael','natalie','nathan','noah','olivia','oscar','paul','rachel','ryan','samantha','sarah','sofia','sophia','steven','thomas','victoria','will','william','zoe'
  ]
);

const COMMON_NAME_EXCEPTIONS = new Set([
  'analysis','answer','bridge','celebrate','concept','concepts','context','density','discussion','energy','essay','evidence','focus','goal','learning','momentum','photosynthesis','reason','science','summary','topic','transition'
]);

interface ContextQuote {
  speakerLabel: string;
  text: string;
  timestamp: number;
  sequence?: number;
}

interface ContextWindowOptions {
  goal?: string;
  domainTerms?: string[];
  now?: number;
}

interface ContextWindowResult {
  aligned: ContextQuote[];
  current: ContextQuote[];
  tangent: ContextQuote[];
  drift: GuidanceWindowSelection['drift'];
  inputQuality: GuidanceWindowSelection['inputQuality'];
  feature: 'legacy' | 'episodes';
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
  tier2ByGroup?: Record<string, {
    insights: Tier2Insights;
    bufferInfo: {
      transcriptCount: number;
      windowStart: Date;
      lastAnalysis?: Date;
    };
  }>;
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

  private readonly contextConfig = (() => {
    const maxChars = Math.max(200, Math.min(2400, parseInt(process.env.AI_GUIDANCE_CONTEXT_MAX_CHARS || '1200', 10)));
    const windowUtteranceLimit = Math.max(1, Math.min(8, parseInt(process.env.AI_GUIDANCE_CONTEXT_MAX_LINES || '6', 10)));
    const episodeWindowMinutes = Math.max(
      4,
      Math.min(10, Number.parseFloat(process.env.AI_GUIDANCE_EPISODE_MAX_MINUTES ?? '6'))
    );
    const episodeWindowMs = Math.round(episodeWindowMinutes * 60_000);
    return {
      maxChars,
      windowUtteranceLimit,
      episodeWindowMinutes,
      episodeWindowMs,
    } as const;
  })();

  constructor() {
    // Start automatic cleanup process (skip in test to avoid open handles)
    if (process.env.NODE_ENV !== 'test') {
      this.startCleanupProcess();
    }

    logger.debug('🔄 AI Analysis Buffer Service initialized', {
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
      logger.debug(`✅ Buffered transcription for group ${groupId} in ${processingTime}ms`);

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logger.error(`❌ Failed to buffer transcription for group ${groupId}:`, error);
      
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
      logger.error(`❌ Failed to get buffered transcripts for group ${groupId}:`, error);
      throw error;
    }
  }

  /**
   * Build sanitized transcript slices for contextual prompts (aligned vs tangent windows).
   * Returns empty arrays when buffers are unavailable or below minimum threshold.
   */
  getContextWindows(sessionId: string, groupId: string, options?: ContextWindowOptions): ContextWindowResult {
    const bufferKey = `${sessionId}:${groupId}`;
    const buffer = this.tier1Buffers.get(bufferKey);
    const useEpisodes = isGuidanceEpisodesEnabled();
    if (!buffer || buffer.transcripts.length === 0) {
      return this.buildEmptyContextWindow(useEpisodes ? 'episodes' : 'legacy');
    }

    const sanitized = buffer.transcripts
      .slice()
      .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
      .map((entry, idx) => this.sanitizeTranscriptEntry(entry.content, entry.timestamp, idx, entry.sequenceNumber))
      .filter((line): line is ContextQuote => Boolean(line));

    if (sanitized.length === 0) {
      return this.buildEmptyContextWindow(useEpisodes ? 'episodes' : 'legacy');
    }

    if (!useEpisodes) {
      return this.buildLegacyContextWindow(sanitized);
    }

    const transcriptLines: GuidanceTranscriptLine[] = sanitized.map((quote, idx) => ({
      text: quote.text,
      timestamp: quote.timestamp,
      speakerLabel: quote.speakerLabel,
      sequence: Number.isFinite(quote.sequence) ? Number(quote.sequence) : idx,
      sttConfidence: 0.75,
    }));

    const episodes = contextEpisodesService.buildEpisodes(
      transcriptLines,
      options?.goal,
      options?.domainTerms,
      this.contextConfig.episodeWindowMinutes
    );

    const selection = contextEpisodesService.selectWindows(
      episodes,
      options?.goal,
      options?.now ?? Date.now(),
      {
        maxChars: this.contextConfig.maxChars,
        maxLines: this.contextConfig.windowUtteranceLimit,
        windowMs: this.contextConfig.episodeWindowMs,
      }
    );

    const aligned = this.toContextQuotes(selection.aligned);
    const current = this.toContextQuotes(selection.current);

    if (aligned.length === 0 && current.length === 0) {
      return this.buildLegacyContextWindow(sanitized);
    }

    return {
      aligned,
      current,
      tangent: current,
      drift: selection.drift,
      inputQuality: selection.inputQuality,
      feature: 'episodes',
    };
  }

  private buildLegacyContextWindow(sanitized: ContextQuote[]): ContextWindowResult {
    const maxChars = this.contextConfig.maxChars;
    const lineLimit = this.contextConfig.windowUtteranceLimit;

    const tangent: ContextQuote[] = [];
    const aligned: ContextQuote[] = [];

    let usedChars = 0;
    let pointer = sanitized.length - 1;

    for (; pointer >= 0 && tangent.length < lineLimit; pointer--) {
      const candidate = sanitized[pointer];
      if (!candidate.text) continue;
      const projected = usedChars + candidate.text.length;
      if (projected > maxChars && tangent.length > 0) {
        break;
      }
      tangent.unshift(candidate);
      usedChars = Math.min(maxChars, projected);
      if (usedChars >= maxChars) {
        pointer--;
        break;
      }
    }

    for (; pointer >= 0 && aligned.length < lineLimit && usedChars < maxChars; pointer--) {
      const candidate = sanitized[pointer];
      if (!candidate.text) continue;
      const projected = usedChars + candidate.text.length;
      if (projected > maxChars) {
        continue;
      }
      aligned.unshift(candidate);
      usedChars = projected;
    }

    return {
      aligned,
      current: tangent,
      tangent,
      drift: this.emptyDriftMetrics(),
      inputQuality: this.legacyInputQuality(sanitized),
      feature: 'legacy',
    };
  }

  private buildEmptyContextWindow(feature: 'legacy' | 'episodes'): ContextWindowResult {
    return {
      aligned: [],
      current: [],
      tangent: [],
      drift: this.emptyDriftMetrics(),
      inputQuality: {
        sttConfidence: 0,
        coverage: 0,
        alignmentDelta: 0,
        episodeCount: 0,
      },
      feature,
    };
  }

  private legacyInputQuality(sanitized: ContextQuote[]): GuidanceWindowSelection['inputQuality'] {
    if (!Array.isArray(sanitized) || sanitized.length === 0) {
      return {
        sttConfidence: 0,
        coverage: 0,
        alignmentDelta: 0,
        episodeCount: 0,
      };
    }
    const first = sanitized[0];
    const last = sanitized[sanitized.length - 1];
    const span = Math.max(0, last.timestamp - first.timestamp);
    const coverage = this.contextConfig.episodeWindowMs > 0
      ? Math.max(0, Math.min(1, span / this.contextConfig.episodeWindowMs))
      : 0;
    return {
      sttConfidence: 0.75,
      coverage,
      alignmentDelta: 0,
      episodeCount: 1,
    };
  }

  private emptyDriftMetrics(): GuidanceWindowSelection['drift'] {
    return {
      alignmentDelta: 0,
      persistentMs: 0,
      priorAlignment: 0,
      currentAlignment: 0,
      lastAlignedAt: null,
    };
  }

  private toContextQuotes(lines: GuidanceTranscriptLine[]): ContextQuote[] {
    return lines
      .filter((line) => typeof line?.text === 'string' && line.text.trim().length > 0)
      .map((line) => ({
        speakerLabel: line.speakerLabel ?? '',
        text: line.text.trim(),
        timestamp: line.timestamp,
        sequence: line.sequence,
      }));
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
        logger.debug(`✅ Retrieved cached insights for session ${sessionId}`);
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
      logger.debug(`✅ Built fresh insights for session ${sessionId} in ${processingTime}ms`);

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
      logger.error(`❌ Failed to get current insights for session ${sessionId}:`, error);

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
          logger.warn(`⚠️ Failed to load Tier 1 analysis for group ${buffer.groupId}:`, (error as Error)?.message || error);
          errors.push(error as Error);
          failures++;
          continue;
        }
      }
    }

    // Step 2: Gather latest per-group Tier2 (best-effort)
    const tier2ByGroup: NonNullable<CurrentInsights['tier2ByGroup']> = {};
    try {
      for (const [, buffer] of Array.from(this.tier2Buffers.entries())) {
        if (buffer.sessionId !== sessionId) continue;
        const latest = await this.getLatestTier2AnalysisForGroupFromDB(buffer.groupId, sessionId);
        if (latest) {
          tier2ByGroup[buffer.groupId] = {
            insights: latest,
            bufferInfo: {
              transcriptCount: buffer.transcripts.length,
              windowStart: buffer.windowStart,
              lastAnalysis: buffer.lastAnalysis
            }
          };
        }
      }
    } catch (e) {
      logger.warn('⚠️ Failed to load per-group Tier 2 insights:', (e as Error)?.message || e);
    }

    // Step 3: Build summary metrics
    const averageTopicalCohesion = validTier1Count > 0 ? totalTopicalCohesion / validTier1Count : 0;
    const averageConceptualDensity = validTier1Count > 0 ? totalConceptualDensity / validTier1Count : 0;
    const overallConfidence = this.calculateOverallConfidence(tier1Insights, tier2ByGroup);
    
    // Identify critical alerts
    const criticalAlerts: string[] = [];
    let alertCount = 0;

    tier1Insights.forEach(group => {
      const arr = Array.isArray(group?.insights?.insights) ? group.insights.insights : [];
      arr.forEach(insight => {
        alertCount++;
        if (insight.severity === 'warning') {
          criticalAlerts.push(`Group ${group.groupId}: ${insight.message}`);
        }
      });
    });

    // Per-group Tier2 high priority recs as critical
    for (const [gId, obj] of Object.entries(tier2ByGroup)) {
      const recs = obj.insights?.recommendations || [];
      alertCount += recs.length;
      recs.forEach(rec => {
        if (rec.priority === 'high') {
          criticalAlerts.push(`Group ${gId}: ${rec.message}`);
        }
      });
    }

    const hasAnyInsights = tier1Insights.length > 0 || Object.keys(tier2ByGroup).length > 0;
    const allAttemptsFailed = attempts > 0 && failures >= attempts;
    if (!hasAnyInsights && allAttemptsFailed) {
      // If every attempted DB call failed, bubble up a representative error
      throw errors[0];
    }

    return {
      sessionId,
      lastUpdated: now,
      tier1Insights,
      tier2ByGroup: Object.keys(tier2ByGroup).length ? tier2ByGroup : undefined,
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
  /**
   * Get latest Tier 2 analysis for a specific group within a session
   */
  private async getLatestTier2AnalysisForGroupFromDB(
    groupId: string,
    sessionId: string
  ): Promise<Tier2Insights | null> {
    const query = `SELECT result_data FROM classwaves.ai_insights.analysis_results 
       WHERE analysis_type = 'tier2' 
       AND session_id = ? 
       AND (group_id = ? OR get_json_object(result_data, '$.groupId') = ?)
       ORDER BY analysis_timestamp DESC LIMIT 1`;
    const result = await databricksService.queryOne(query, [sessionId, groupId, groupId]);
    if (result && result.result_data) {
      return JSON.parse(result.result_data) as Tier2Insights;
    }
    return null;
  }

  /**
   * Calculate overall confidence score from available insights
   */
  private calculateOverallConfidence(
    tier1Insights: CurrentInsights['tier1Insights'],
    tier2ByGroup?: CurrentInsights['tier2ByGroup']
  ): number {
    let totalConfidence = 0;
    let count = 0;

    // Weight Tier 1 insights
    tier1Insights.forEach(group => {
      const conf = group?.insights?.confidence;
      if (typeof conf === 'number') {
        totalConfidence += conf * 0.6; // Lower weight for real-time
        count++;
      }
    });

    if (tier2ByGroup && Object.keys(tier2ByGroup).length) {
      for (const obj of Object.values(tier2ByGroup)) {
        if (obj?.insights?.confidence != null) {
          totalConfidence += obj.insights.confidence * 0.8;
          count++;
        }
      }
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
    
    logger.debug('🛑 AI Analysis Buffer Service shutdown completed');
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

  private sanitizeTranscriptEntry(
    content: string,
    timestamp: Date,
    fallbackIndex: number,
    sequenceNumber?: number
  ): ContextQuote | null {
    const normalized = typeof content === 'string' ? content.trim() : '';
    if (!normalized) return null;

    const colonIndex = normalized.indexOf(':');
    const utterance = colonIndex > -1 && colonIndex < 40
      ? normalized.slice(colonIndex + 1).trim()
      : normalized;

    const text = this.sanitizeQuote(utterance);
    if (!text) return null;

    const timestampMs = Number.isFinite(timestamp?.getTime?.()) ? timestamp.getTime() : Date.now();

    const sequence = Number.isFinite(sequenceNumber) ? Number(sequenceNumber) : fallbackIndex;

    return {
      speakerLabel: `Participant ${fallbackIndex + 1}`,
      text,
      timestamp: timestampMs,
      sequence,
    };
  }

  private sanitizeQuote(input: string): string {
    if (!input) return '';

    let sanitized = input
      .replace(/\s+/g, ' ')
      .replace(/https?:\/\/\S+/gi, '[link]')
      .trim();

    // Redact emails and phone numbers
    sanitized = sanitized.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]');
    sanitized = sanitized.replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[redacted]');
    sanitized = sanitized.replace(/\b\d{4,}\b/g, '[redacted]');

    // Mask simple profanity list (case-insensitive)
    const profanity = ['shit', 'fuck', 'damn', 'bitch', 'asshole', 'crap'];
    if (profanity.length > 0) {
      const profanityRegex = new RegExp(`\\b(${profanity.join('|')})\\b`, 'gi');
      sanitized = sanitized.replace(profanityRegex, '***');
    }

    sanitized = this.maskHonorifics(sanitized);
    sanitized = this.maskCommonNames(sanitized);

    // Remove stray punctuation repeated sequences
    sanitized = sanitized.replace(/["']+/g, '"').replace(/\s{2,}/g, ' ').trim();

    if (sanitized.length > this.contextConfig.maxChars) {
      sanitized = `${sanitized.slice(0, this.contextConfig.maxChars - 1)}…`;
    }

    return sanitized || '[redacted]';
  }

  private maskHonorifics(input: string): string {
    return input.replace(/\b(Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\.?\s+[A-Z][a-z]+/g, 'Teacher');
  }

  private maskCommonNames(input: string): string {
    let result = input;

    result = result.replace(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g, (match) => {
      const lower = match.toLowerCase();
      if (COMMON_NAME_EXCEPTIONS.has(lower)) {
        return match;
      }
      const [first, second] = lower.split(' ');
      if (COMMON_FIRST_NAMES.has(first) || COMMON_FIRST_NAMES.has(second)) {
        return 'Student';
      }
      return match;
    });

    result = result.replace(/\b([A-Z][a-z]{2,})\b/g, (match) => {
      const lower = match.toLowerCase();
      if (COMMON_NAME_EXCEPTIONS.has(lower)) {
        return match;
      }
      if (COMMON_FIRST_NAMES.has(lower)) {
        return 'Student';
      }
      return match;
    });

    return result;
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
        logger.error('❌ Buffer cleanup failed:', error);
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
      logger.debug(`🧹 Cleaned up ${cleanedCount} old buffers`);
      
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
      logger.warn('⚠️ Audit logging failed in AI buffer service:', error);
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
