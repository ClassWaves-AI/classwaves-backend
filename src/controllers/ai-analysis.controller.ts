/**
 * AI Analysis Controller
 * 
 * REST API endpoints for the Two-Tier AI Analysis System:
 * - POST /api/v1/ai/analyze-discussion - Tier 1 group analysis
 * - POST /api/v1/ai/generate-insights - Tier 2 deep analysis  
 * - GET /api/v1/ai/insights/:sessionId - Retrieve session insights
 * - GET /api/v1/ai/tier1/status - Tier 1 system status
 * - GET /api/v1/ai/tier2/status - Tier 2 system status
 */

import { Response } from 'express';
import { 
  AnalyzeGroupDiscussionRequest,
  AnalyzeGroupDiscussionResponse,
  GenerateDeepInsightsRequest,
  GenerateDeepInsightsResponse,
  GetSessionInsightsRequest,
  GetSessionInsightsResponse,
  Tier1Options,
  Tier2Options,
  AIAnalysisError
} from '../types/ai-analysis.types';
import { getCompositionRoot } from '../app/composition-root';
import { AuthRequest } from '../types/auth.types';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// ============================================================================
// Tier 1 Analysis: Real-time Group Discussion Analysis
// ============================================================================

/**
 * POST /api/v1/ai/analyze-discussion
 * 
 * Analyzes group discussion transcripts in real-time (30s cadence)
 * Provides Topical Cohesion and Conceptual Density insights
 */
export const analyzeGroupDiscussion = async (req: AuthRequest, res: Response): Promise<Response> => {
  const startTime = Date.now();
  
  try {
    const { groupId, transcripts, options }: AnalyzeGroupDiscussionRequest = req.body;
    const { sessionId } = req.params;
    const teacher = req.user;

    // Validate input
    if (!groupId || !transcripts || !Array.isArray(transcripts) || transcripts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: groupId, transcripts array'
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId in URL parameters'
      });
    }

    // Verify teacher owns this session and group
    const session = await getCompositionRoot().getSessionRepository().getOwnedSessionBasic(sessionId, teacher?.id || '');

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found or access denied'
      });
    }

    if (session.status !== 'active') {
      return res.status(400).json({
        success: false,
        error: 'Session must be active for AI analysis'
      });
    }

    // Verify group exists in this session
    const groupExists = await getCompositionRoot().getGroupRepository().groupExistsInSession(sessionId, groupId);

    if (!groupExists) {
      return res.status(404).json({
        success: false,
        error: 'Group not found in session'
      });
    }

    logger.debug(`🧠 Starting Tier 1 analysis for group ${groupId} in session ${sessionId}`);

    // Prepare analysis options
    const tier1Options: Tier1Options = {
      groupId,
      sessionId,
      focusAreas: options?.focusAreas || ['topical_cohesion', 'conceptual_density'],
      windowSize: options?.windowSize || 30,
      includeMetadata: options?.includeMetadata !== false
    };

    // Perform AI analysis
    const insights = await getCompositionRoot().getAIAnalysisPort().analyzeTier1(transcripts, tier1Options);

    // Store insights in database
    const insightId = uuidv4();
    await getCompositionRoot().getAnalyticsRepository().insertTier1Analysis({
      id: insightId,
      session_id: sessionId,
      group_id: groupId,
      teacher_id: teacher?.id || '',
      analysis_type: 'tier1_realtime',
      insights: JSON.stringify(insights),
      transcript_count: transcripts.length,
      transcript_length: transcripts.join(' ').length,
      topical_cohesion: insights.topicalCohesion,
      conceptual_density: insights.conceptualDensity,
      confidence: insights.confidence,
      processing_time_ms: insights.metadata?.processingTimeMs,
      created_at: new Date(),
      analysis_timestamp: new Date(insights.analysisTimestamp)
    });

    // Broadcast to guidance namespace only (canonical)
    try {
      const { getNamespacedWebSocketService } = await import('../services/websocket/namespaced-websocket.service');
      getNamespacedWebSocketService()?.getGuidanceService().emitTier1Insight(sessionId, {
        groupId,
        sessionId,
        insights,
        timestamp: insights.analysisTimestamp,
      });
    } catch (e) {
      logger.warn('⚠️ Failed to emit Tier1 to guidance namespace:', e instanceof Error ? e.message : String(e));
    }

    // Record audit log (async, fire-and-forget)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: teacher?.id || '',
      actorType: 'teacher',
      eventType: 'ai_analysis_tier1',
      eventCategory: 'session',
      resourceType: 'group_discussion',
      resourceId: groupId,
      schoolId: teacher?.school_id || '',
      sessionId,
      description: `tier1 insights generated for group:${groupId}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      dataAccessed: JSON.stringify({ transcriptCount: transcripts.length, processingTimeMs: Date.now() - startTime })
    }).catch(() => {});

    const response: AnalyzeGroupDiscussionResponse = {
      success: true,
      insights,
      processingTime: Date.now() - startTime
    };

    logger.debug(`✅ Tier 1 analysis completed for group ${groupId} in ${response.processingTime}ms`);
    return res.json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('Tier 1 analysis failed:', error);

    // Handle specific AI analysis errors
    if (error instanceof Error && (error as AIAnalysisError).code) {
      const aiError = error as AIAnalysisError;
      return res.status(getErrorStatusCode(aiError.code)).json({
        success: false,
        error: aiError.message,
        processingTime,
        code: aiError.code
      });
    }

    return res.status(500).json({
      success: false,
      error: 'AI analysis failed',
      processingTime
    });
  }
};

// ============================================================================
// Tier 2 Analysis: Deep Educational Insights
// ============================================================================

/**
 * POST /api/v1/ai/generate-insights
 * 
 * Performs deep analysis of session transcripts (2-5min cadence)
 * Provides Argumentation Quality, Emotional Arc, Collaboration Patterns, Learning Signals
 */
export const generateDeepInsights = async (req: AuthRequest, res: Response): Promise<Response> => {
  const startTime = Date.now();
  
  try {
    const { groupTranscripts, options }: GenerateDeepInsightsRequest = req.body;
    const { sessionId } = req.params;
    const teacher = req.user;

    // Validate input
    if (!groupTranscripts || !Array.isArray(groupTranscripts) || groupTranscripts.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: groupTranscripts array'
      });
    }

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Missing sessionId in URL parameters'
      });
    }

    // Verify teacher owns this session
    const session = await getCompositionRoot().getSessionRepository().getOwnedSessionBasic(sessionId, teacher?.id || '');

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found or access denied'
      });
    }

    logger.debug(`🧠 Starting Tier 2 analysis for session ${sessionId} (${groupTranscripts.length} groups)`);

    // Prepare analysis options
    const tier2Options: Tier2Options = {
      sessionId,
      groupIds: groupTranscripts.map(gt => gt.groupId),
      analysisDepth: options?.analysisDepth || 'standard',
      includeComparative: options?.includeComparative !== false,
      includeMetadata: options?.includeMetadata !== false
    };

    // Combine all transcripts for deep analysis
    const allTranscripts = groupTranscripts.flatMap(gt => gt.transcripts);

    // Perform AI analysis
    const insights = await getCompositionRoot().getAIAnalysisPort().analyzeTier2(allTranscripts, tier2Options);

    // Store insights in database
    const insightId = uuidv4();
    await getCompositionRoot().getAnalyticsRepository().insertTier2Analysis({
      id: insightId,
      session_id: sessionId,
      teacher_id: teacher?.id || '',
      analysis_type: 'tier2_deep',
      insights: JSON.stringify(insights),
      groups_analyzed: JSON.stringify(tier2Options.groupIds),
      transcript_count: allTranscripts.length,
      total_transcript_length: allTranscripts.join('\n\n').length,
      argumentation_score: insights.argumentationQuality.score,
      collaboration_score: (
        insights.collaborationPatterns.turnTaking +
        insights.collaborationPatterns.buildingOnIdeas +
        insights.collaborationPatterns.conflictResolution +
        insights.collaborationPatterns.inclusivity
      ) / 4,
      learning_score: (
        insights.learningSignals.conceptualGrowth +
        insights.learningSignals.questionQuality +
        insights.learningSignals.metacognition +
        insights.learningSignals.knowledgeApplication
      ) / 4,
      engagement_score: insights.collectiveEmotionalArc.averageEngagement,
      confidence: insights.confidence,
      recommendation_count: insights.recommendations.length,
      processing_time_ms: insights.metadata?.processingTimeMs,
      created_at: new Date(),
      analysis_timestamp: new Date(insights.analysisTimestamp)
    });

    // Broadcast to guidance namespace (group scope only). If multiple groups provided,
    // skip session-scope emit per Phase 3 removal.
    try {
      const { getNamespacedWebSocketService } = await import('../services/websocket/namespaced-websocket.service');
      const ns = getNamespacedWebSocketService()?.getGuidanceService();
      const uniqueGroups = Array.from(new Set((groupTranscripts || []).map(gt => gt.groupId).filter(Boolean)));
      if (uniqueGroups.length === 1) {
        ns?.emitTier2Insight(sessionId, {
          scope: 'group',
          sessionId,
          groupId: uniqueGroups[0],
          insights,
          timestamp: insights.analysisTimestamp,
        });
      } else {
        logger.warn('⚠️ Dropping session-scope Tier2 emit (multi-group analysis); group-only is supported', {
          sessionId,
          groupCount: uniqueGroups.length,
        });
      }
    } catch (e) {
      logger.warn('⚠️ Failed to emit Tier2 to guidance namespace:', e instanceof Error ? e.message : String(e));
    }

    // Record audit log (async)
    const { auditLogPort } = await import('../utils/audit.port.instance');
    auditLogPort.enqueue({
      actorId: teacher?.id || '',
      actorType: 'teacher',
      eventType: 'ai_analysis_tier2',
      eventCategory: 'session',
      resourceType: 'session_discussion',
      resourceId: sessionId,
      schoolId: teacher?.school_id || '',
      sessionId,
      description: `tier2 insights generated for session:${sessionId}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      dataAccessed: JSON.stringify({
        insightId,
        groupCount: groupTranscripts.length,
        transcriptCount: allTranscripts.length,
        analysisDepth: tier2Options.analysisDepth,
        processingTimeMs: Date.now() - startTime,
      })
    }).catch(() => {});

    const response: GenerateDeepInsightsResponse = {
      success: true,
      insights,
      processingTime: Date.now() - startTime
    };

    logger.debug(`✅ Tier 2 analysis completed for session ${sessionId} in ${response.processingTime}ms`);
    return res.json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    logger.error('Tier 2 analysis failed:', error);

    // Handle specific AI analysis errors
    if (error instanceof Error && (error as AIAnalysisError).code) {
      const aiError = error as AIAnalysisError;
      return res.status(getErrorStatusCode(aiError.code)).json({
        success: false,
        error: aiError.message,
        processingTime,
        code: aiError.code
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Deep analysis failed',
      processingTime
    });
  }
};

// ============================================================================
// Insights Retrieval
// ============================================================================

/**
 * GET /api/v1/ai/insights/:sessionId
 * 
 * Retrieves stored AI insights for a session
 */
export const getSessionInsights = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    const { sessionId } = req.params;
    const { includeHistory = false, groupIds } = req.query as Partial<GetSessionInsightsRequest>;
    const teacher = req.user;

    // Verify teacher owns this session
    const session = await getCompositionRoot().getSessionRepository().getOwnedSessionBasic(sessionId, teacher?.id || '');

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found or access denied'
      });
    }

    // Retrieve Tier 1 insights
    const tier1Results = await getCompositionRoot().getAnalyticsRepository().getTier1Results(sessionId, {
      groupIds: (groupIds && Array.isArray(groupIds) && groupIds.length > 0) ? (groupIds as string[]) : undefined,
      includeHistory: Boolean(includeHistory),
      hoursBack: 2,
      order: 'ASC'
    });

    // Retrieve Tier 2 insights  
    const tier2Results = await getCompositionRoot().getAnalyticsRepository().getTier2Results(sessionId, {
      includeHistory: Boolean(includeHistory),
      hoursBack: 2,
      order: 'ASC'
    });

    // Group Tier 1 insights by group
    const tier1Insights: Record<string, any[]> = {};
    for (const result of tier1Results) {
      if (!tier1Insights[result.group_id]) {
        tier1Insights[result.group_id] = [];
      }
      tier1Insights[result.group_id].push(JSON.parse(result.insights));
    }

    // Parse Tier 2 insights
    const tier2Insights = tier2Results.map((result: any) => JSON.parse(result.insights));

    const response: GetSessionInsightsResponse = {
      success: true,
      tier1Insights,
      tier2Insights
    };

    return res.json(response);

  } catch (error) {
    logger.error('Failed to retrieve session insights:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve insights'
    });
  }
};

// ============================================================================
// System Status Endpoints
// ============================================================================

/**
 * GET /api/v1/ai/tier1/status
 * 
 * Returns Tier 1 system status and configuration
 */
export const getTier1Status = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    const { databricksAIService } = await import('../services/databricks-ai.service');
    const validation = databricksAIService.validateConfiguration();
    const config = databricksAIService.getConfiguration();

    return res.json({
      success: true,
      status: validation.valid ? 'operational' : 'degraded',
      tier: 'tier1',
      configuration: {
        timeout: config.tier1?.timeout,
        windowSeconds: config.tier1?.windowSeconds,
        maxTokens: config.tier1?.maxTokens,
        endpoint: config.tier1?.endpoint ? 'configured' : 'missing'
      },
      validation: {
        valid: validation.valid,
        errors: validation.errors
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get Tier 1 status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve status'
    });
  }
};

/**
 * GET /api/v1/ai/tier2/status
 * 
 * Returns Tier 2 system status and configuration
 */
export const getTier2Status = async (req: AuthRequest, res: Response): Promise<Response> => {
  try {
    const { databricksAIService } = await import('../services/databricks-ai.service');
    const validation = databricksAIService.validateConfiguration();
    const config = databricksAIService.getConfiguration();

    return res.json({
      success: true,
      status: validation.valid ? 'operational' : 'degraded',
      tier: 'tier2',
      configuration: {
        timeout: config.tier2?.timeout,
        windowMinutes: config.tier2?.windowMinutes,
        maxTokens: config.tier2?.maxTokens,
        endpoint: config.tier2?.endpoint ? 'configured' : 'missing'
      },
      validation: {
        valid: validation.valid,
        errors: validation.errors
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Failed to get Tier 2 status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve status'
    });
  }
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Maps AI error codes to HTTP status codes
 */
function getErrorStatusCode(code: AIAnalysisError['code']): number {
  switch (code) {
    case 'DATABRICKS_AUTH':
      return 401;
    case 'DATABRICKS_QUOTA':
      return 429;
    case 'DATABRICKS_TIMEOUT':
      return 504;
    case 'INVALID_INPUT':
      return 400;
    case 'ANALYSIS_FAILED':
    default:
      return 500;
  }
}
