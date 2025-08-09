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

import { Request, Response } from 'express';
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
import { databricksAIService } from '../services/databricks-ai.service';
import { databricksService } from '../services/databricks.service';
import { AuthRequest } from '../types/auth.types';
import { v4 as uuidv4 } from 'uuid';

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
    const { groupId, transcripts, options = {} }: AnalyzeGroupDiscussionRequest = req.body;
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
    const session = await databricksService.queryOne(`
      SELECT id, teacher_id, status 
      FROM classwaves.sessions.classroom_sessions 
      WHERE id = '${sessionId}' AND teacher_id = '${teacher.id}'
    `);

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
    const group = await databricksService.queryOne(`
      SELECT id, session_id 
      FROM classwaves.sessions.student_groups 
      WHERE id = '${groupId}' AND session_id = '${sessionId}'
    `);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: 'Group not found in session'
      });
    }

    console.log(`🧠 Starting Tier 1 analysis for group ${groupId} in session ${sessionId}`);

    // Prepare analysis options
    const tier1Options: Tier1Options = {
      groupId,
      sessionId,
      focusAreas: options.focusAreas || ['topical_cohesion', 'conceptual_density'],
      windowSize: options.windowSize || 30,
      includeMetadata: options.includeMetadata !== false
    };

    // Perform AI analysis
    const insights = await databricksAIService.analyzeTier1(transcripts, tier1Options);

    // Store insights in database
    const insightId = uuidv4();
    await databricksService.insert('ai_insights.tier1_analysis', {
      id: insightId,
      session_id: sessionId,
      group_id: groupId,
      teacher_id: teacher.id,
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

    // Broadcast insights via WebSocket
    const websocketService = (global as any).websocketService;
    if (websocketService) {
      websocketService.emitToSession(sessionId, 'group:tier1:insight', {
        groupId,
        sessionId,
        insights,
        timestamp: insights.analysisTimestamp
      });
      
      console.log(`📡 Tier 1 insights broadcasted for group ${groupId}`);
    }

    // Record audit log
    await databricksService.recordAuditLog({
      user_id: teacher.id,
      user_type: 'teacher',
      action: 'ai_analysis_tier1',
      resource_type: 'group_discussion',
      resource_id: groupId,
      metadata: {
        sessionId,
        insightId,
        transcriptCount: transcripts.length,
        processingTimeMs: Date.now() - startTime
      },
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      school_id: teacher.school_id
    });

    const response: AnalyzeGroupDiscussionResponse = {
      success: true,
      insights,
      processingTime: Date.now() - startTime
    };

    console.log(`✅ Tier 1 analysis completed for group ${groupId} in ${response.processingTime}ms`);
    return res.json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('Tier 1 analysis failed:', error);

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
    const { groupTranscripts, options = {} }: GenerateDeepInsightsRequest = req.body;
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
    const session = await databricksService.queryOne(`
      SELECT id, teacher_id, status, title 
      FROM classwaves.sessions.classroom_sessions 
      WHERE id = '${sessionId}' AND teacher_id = '${teacher.id}'
    `);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found or access denied'
      });
    }

    console.log(`🧠 Starting Tier 2 analysis for session ${sessionId} (${groupTranscripts.length} groups)`);

    // Prepare analysis options
    const tier2Options: Tier2Options = {
      sessionId,
      groupIds: groupTranscripts.map(gt => gt.groupId),
      analysisDepth: options.analysisDepth || 'standard',
      includeComparative: options.includeComparative !== false,
      includeMetadata: options.includeMetadata !== false
    };

    // Combine all transcripts for deep analysis
    const allTranscripts = groupTranscripts.flatMap(gt => gt.transcripts);

    // Perform AI analysis
    const insights = await databricksAIService.analyzeTier2(allTranscripts, tier2Options);

    // Store insights in database
    const insightId = uuidv4();
    await databricksService.insert('ai_insights.tier2_analysis', {
      id: insightId,
      session_id: sessionId,
      teacher_id: teacher.id,
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

    // Broadcast insights via WebSocket
    const websocketService = (global as any).websocketService;
    if (websocketService) {
      websocketService.emitToSession(sessionId, 'group:tier2:insight', {
        sessionId,
        insights,
        timestamp: insights.analysisTimestamp
      });
      
      console.log(`📡 Tier 2 insights broadcasted for session ${sessionId}`);
    }

    // Record audit log
    await databricksService.recordAuditLog({
      user_id: teacher.id,
      user_type: 'teacher',
      action: 'ai_analysis_tier2',
      resource_type: 'session_discussion',
      resource_id: sessionId,
      metadata: {
        insightId,
        groupCount: groupTranscripts.length,
        transcriptCount: allTranscripts.length,
        analysisDepth: tier2Options.analysisDepth,
        processingTimeMs: Date.now() - startTime
      },
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      school_id: teacher.school_id
    });

    const response: GenerateDeepInsightsResponse = {
      success: true,
      insights,
      processingTime: Date.now() - startTime
    };

    console.log(`✅ Tier 2 analysis completed for session ${sessionId} in ${response.processingTime}ms`);
    return res.json(response);

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('Tier 2 analysis failed:', error);

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
    const { includeHistory = false, groupIds } = req.query as GetSessionInsightsRequest;
    const teacher = req.user;

    // Verify teacher owns this session
    const session = await databricksService.queryOne(`
      SELECT id, teacher_id, title 
      FROM classwaves.sessions.classroom_sessions 
      WHERE id = '${sessionId}' AND teacher_id = '${teacher.id}'
    `);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found or access denied'
      });
    }

    // Build query conditions
    const groupFilter = groupIds && Array.isArray(groupIds) 
      ? `AND group_id IN ('${groupIds.join("','")}')` 
      : '';
    
    const timeFilter = includeHistory 
      ? '' 
      : 'AND created_at >= CURRENT_TIMESTAMP() - INTERVAL 2 HOURS';

    // Retrieve Tier 1 insights
    const tier1Results = await databricksService.query(`
      SELECT group_id, insights, created_at, analysis_timestamp
      FROM classwaves.ai_insights.tier1_analysis 
      WHERE session_id = '${sessionId}' ${groupFilter} ${timeFilter}
      ORDER BY created_at ASC
    `);

    // Retrieve Tier 2 insights  
    const tier2Results = await databricksService.query(`
      SELECT insights, created_at, analysis_timestamp
      FROM classwaves.ai_insights.tier2_analysis 
      WHERE session_id = '${sessionId}' ${timeFilter}
      ORDER BY created_at ASC
    `);

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
    console.error('Failed to retrieve session insights:', error);
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
    console.error('Failed to get Tier 1 status:', error);
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
    console.error('Failed to get Tier 2 status:', error);
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
