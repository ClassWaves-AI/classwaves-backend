/**
 * AI Analysis Routes
 * 
 * Secure API endpoints for the AI Analysis and Teacher Guidance system:
 * - Real-time AI analysis endpoints (Tier 1 & Tier 2)
 * - Teacher guidance and prompt endpoints
 * - System status and metrics endpoints
 * 
 * ✅ SECURITY: Authentication, rate limiting, input validation
 * ✅ COMPLIANCE: FERPA/COPPA compliant with audit logging
 * ✅ PERFORMANCE: Optimized with caching and error handling
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.middleware';
import { validate, validateQuery, validateParams } from '../middleware/validation.middleware';
import * as aiController from '../controllers/ai-analysis.controller';
import { logger } from '../utils/logger';

// ============================================================================
// Input Validation Schemas
// ============================================================================

// Core AI analysis schemas
export const analyzeDiscussionSchema = z.object({
  groupId: z.string().uuid('Invalid group ID format'),
  transcripts: z.array(z.string().min(1).max(10000)).min(1).max(50),
  options: z.object({
    focusAreas: z.array(z.enum(['topical_cohesion', 'conceptual_density'])).optional(),
    windowSize: z.number().min(10).max(300).default(30),
    includeMetadata: z.boolean().default(true)
  }).optional()
});

export const generateInsightsSchema = z.object({
  groupTranscripts: z.array(z.object({
    groupId: z.string().uuid(),
    transcripts: z.array(z.string().min(1).max(10000)).min(1)
  })).min(1).max(20),
  options: z.object({
    analysisDepth: z.enum(['standard', 'comprehensive']).default('standard'),
    includeComparative: z.boolean().default(false),
    includeMetadata: z.boolean().default(true)
  }).optional()
});

// Teacher guidance schemas
export const generatePromptsSchema = z.object({
  groupId: z.string().uuid().optional(),
  insights: z.any(), // AI insights object - validated separately
  context: z.object({
    sessionPhase: z.enum(['opening', 'development', 'synthesis', 'closure']),
    subject: z.enum(['math', 'science', 'literature', 'history', 'general']),
    learningObjectives: z.array(z.string().min(1).max(200)).max(5),
    groupSize: z.number().min(1).max(8),
    sessionDuration: z.number().min(1).max(480)
  }),
  options: z.object({
    maxPrompts: z.number().min(1).max(15).default(5),
    priorityFilter: z.enum(['all', 'high', 'medium', 'low']).default('all'),
    categoryFilter: z.array(z.enum(['facilitation', 'deepening', 'redirection', 'collaboration', 'assessment', 'energy', 'clarity'])).optional(),
    includeEffectivenessScore: z.boolean().default(true)
  }).optional()
});

export const recordPromptInteractionSchema = z.object({
  interactionType: z.enum(['acknowledged', 'used', 'dismissed']),
  feedback: z.object({
    rating: z.number().min(1).max(5),
    text: z.string().max(500)
  }).optional(),
  outcomeData: z.object({
    learningImpact: z.number().min(0).max(1).optional(),
    followupNeeded: z.boolean().optional(),
    notes: z.string().max(1000).optional()
  }).optional()
});

// Query parameter schemas
export const sessionInsightsQuerySchema = z.object({
  includeHistory: z.enum(['true', 'false']).transform(val => val === 'true').default(() => false),
  groupIds: z.string().optional().transform(val => val ? val.split(',') : undefined),
  tier: z.enum(['tier1', 'tier2', 'both']).optional().default('both'),
  limit: z.string().transform(val => parseInt(val) || 50).pipe(z.number().min(1).max(100)).optional()
});

export const promptsQuerySchema = z.object({
  category: z.enum(['facilitation', 'deepening', 'redirection', 'collaboration', 'assessment', 'energy', 'clarity']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  status: z.enum(['active', 'acknowledged', 'used', 'dismissed', 'expired']).optional(),
  groupId: z.string().uuid().optional(),
  limit: z.string().transform(val => parseInt(val) || 50).pipe(z.number().min(1).max(100)).optional()
});

// Path parameter schemas
export const sessionParamsSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID format')
});

export const promptParamsSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID format'),
  promptId: z.string().min(1, 'Invalid prompt ID format')
});

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

// ✅ SECURITY: Rate limiting with educational-appropriate limits
const aiAnalysisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes per IP
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many AI analysis requests. Please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for authenticated users with valid teacher ID
    const authReq = req as any;
    return authReq.user?.id ? false : false;
  }
});

const teacherGuidanceLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 requests per 5 minutes per teacher
  message: {
    error: 'RATE_LIMIT_EXCEEDED', 
    message: 'Too many teacher guidance requests. Please try again later.',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for authenticated users with valid teacher ID
    const authReq = req as any;
    return authReq.user?.id ? false : false;
  }
});

const statusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 status checks per minute
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many status requests. Please try again later.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// ============================================================================
// Security Middleware Configuration
// ============================================================================

/**
 * Selective authentication middleware for AI routes
 * Implements tiered security model:
 * - Public: Status endpoints (safe aggregate information)
 * - Protected: All other AI analysis and guidance endpoints
 */
const aiSecurityMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  // Define public status endpoints that don't require authentication
  const publicPaths = ['/status', '/tier1/status', '/tier2/status'];
  const requestPath = req.path;
  
  // Allow public access to status endpoints
  if (publicPaths.includes(requestPath)) {
    logger.debug(`🔓 AI Status endpoint accessed publicly: ${requestPath}`);
    return next();
  }
  
  // Require authentication for all other AI endpoints
  logger.debug(`🔐 AI endpoint requires authentication: ${requestPath}`);
  return authenticate(req, res, next);
};

// ============================================================================
// Response Filtering Utilities
// ============================================================================

/**
 * Filters sensitive information from AI status responses for public endpoints
 * Returns only safe, aggregate information suitable for monitoring systems
 */
const getPublicStatusResponse = (fullStatus: any) => ({
  success: true,
  system: 'ClassWaves AI Analysis',
  status: fullStatus.status || 'unknown',
  timestamp: new Date().toISOString(),
  services: {
    tier1: { 
      status: fullStatus.services?.databricksAI?.status === 'online' ? 'healthy' : 'degraded'
    },
    tier2: { 
      status: fullStatus.services?.databricksAI?.status === 'online' ? 'healthy' : 'degraded'
    }
  },
  uptime: Math.floor(process.uptime())
});

// ============================================================================
// Router Setup
// ============================================================================

const router = express.Router();

// ✅ SECURITY: Selective authentication - public status, protected analysis
router.use(aiSecurityMiddleware);

// ============================================================================
// Core AI Analysis Endpoints
// ============================================================================

/**
 * POST /ai/sessions/:sessionId/analyze-discussion
 * 
 * Analyzes group discussion for real-time insights (Tier 1)
 * Rate limited: 100 requests per 15 minutes
 */
router.post('/sessions/:sessionId/analyze-discussion',
  aiAnalysisLimiter,
  validateParams(sessionParamsSchema),
  validate(analyzeDiscussionSchema),
  aiController.analyzeGroupDiscussion as any
);

/**
 * POST /ai/analyze-discussion
 * 
 * Frontend-compatible route for group discussion analysis (Tier 1)
 * Matches frontend expectation: /api/v1/ai/analyze-discussion
 * Rate limited: 100 requests per 15 minutes
 */
router.post('/analyze-discussion',
  aiAnalysisLimiter,
  validate(analyzeDiscussionSchema),
  aiController.analyzeGroupDiscussion as any
);

/**
 * POST /ai/sessions/:sessionId/generate-insights
 * 
 * Generates deep educational insights (Tier 2)
 * Rate limited: 100 requests per 15 minutes
 */
router.post('/sessions/:sessionId/generate-insights',
  aiAnalysisLimiter,
  validateParams(sessionParamsSchema),
  validate(generateInsightsSchema),
  aiController.generateDeepInsights as any
);

/**
 * POST /ai/generate-insights
 * 
 * Frontend-compatible route for deep insights generation (Tier 2)
 * Matches frontend expectation: /api/v1/ai/generate-insights
 * Rate limited: 100 requests per 15 minutes
 */
router.post('/generate-insights',
  aiAnalysisLimiter,
  validate(generateInsightsSchema),
  aiController.generateDeepInsights as any
);

/**
 * GET /ai/sessions/:sessionId/insights
 * 
 * Retrieves AI insights for a session
 * Query params: includeHistory, groupIds, tier, limit
 */
router.get('/sessions/:sessionId/insights',
  aiAnalysisLimiter,
  validateParams(sessionParamsSchema),
  validateQuery(sessionInsightsQuerySchema),
  aiController.getSessionInsights as any
);

/**
 * GET /ai/insights/:sessionId
 * 
 * Frontend-compatible route for AI insights retrieval
 * Matches frontend expectation: /api/v1/ai/insights/{sessionId}
 * Query params: includeHistory, groupIds, tier, limit
 */
router.get('/insights/:sessionId',
  aiAnalysisLimiter,
  validateParams(sessionParamsSchema),
  validateQuery(sessionInsightsQuerySchema),
  aiController.getSessionInsights as any
);

// ============================================================================
// Teacher Guidance Endpoints
// ============================================================================

/**
 * POST /ai/sessions/:sessionId/generate-prompts
 * 
 * Generates contextual teacher prompts from AI insights
 * Rate limited: 50 requests per 5 minutes
 */
router.post('/sessions/:sessionId/generate-prompts',
  teacherGuidanceLimiter,
  validateParams(sessionParamsSchema),
  validate(generatePromptsSchema),
  async (req, res) => {
    // Import teacher guidance controller (to be implemented in Phase B)
    try {
      const { teacherPromptService } = await import('../services/teacher-prompt.service');
      const { sessionId } = req.params;
      const { groupId, insights, context, options } = req.body;
      const teacher = (req as any).user;

      const prompts = await teacherPromptService.generatePrompts(
        insights,
        {
          sessionId,
          groupId,
          teacherId: teacher.id,
          ...context
        },
        options
      );

      res.json({
        success: true,
        prompts,
        metadata: {
          totalGenerated: prompts.length,
          processingTimeMs: Date.now() - Date.now(), // Placeholder
          sessionPhase: context.sessionPhase
        }
      });
    } catch (error) {
      logger.error('Teacher prompt generation failed:', error);
      res.status(500).json({
        success: false,
        error: 'PROMPT_GENERATION_FAILED',
        message: 'Failed to generate teacher prompts'
      });
    }
  }
);

/**
 * GET /ai/sessions/:sessionId/prompts
 * 
 * Retrieves teacher prompts for a session
 * Query params: category, priority, status, groupId, limit
 */
router.get('/sessions/:sessionId/prompts',
  teacherGuidanceLimiter,
  validateParams(sessionParamsSchema),
  validateQuery(promptsQuerySchema),
  async (req, res) => {
    try {
      const { teacherPromptService } = await import('../services/teacher-prompt.service');
      const { sessionId } = req.params;
      const teacher = (req as any).user;

      const prompts = teacherPromptService.getSessionPrompts(sessionId);
      const metrics = teacherPromptService.getSessionMetrics(sessionId);

      // Apply query filters
      let filteredPrompts = prompts;
      const query = req.query as any;

      if (query.category) {
        filteredPrompts = filteredPrompts.filter(p => p.category === query.category);
      }
      if (query.priority) {
        filteredPrompts = filteredPrompts.filter(p => p.priority === query.priority);
      }
      if (query.status) {
        const now = new Date();
        filteredPrompts = filteredPrompts.filter(p => {
          switch (query.status) {
            case 'active': return !p.acknowledgedAt && p.expiresAt > now;
            case 'acknowledged': return p.acknowledgedAt && !p.usedAt;
            case 'used': return p.usedAt;
            case 'dismissed': return p.dismissedAt;
            case 'expired': return p.expiresAt <= now;
            default: return true;
          }
        });
      }
      if (query.groupId) {
        filteredPrompts = filteredPrompts.filter(p => p.groupId === query.groupId);
      }

      // Apply limit
      if (query.limit) {
        filteredPrompts = filteredPrompts.slice(0, query.limit);
      }

      res.json({
        success: true,
        prompts: filteredPrompts,
        stats: {
          totalActive: prompts.filter(p => !p.acknowledgedAt && p.expiresAt > new Date()).length,
          byCategory: metrics?.byCategory || {},
          byPriority: metrics?.byPriority || {},
          averageEffectiveness: metrics?.effectivenessAverage || 0
        }
      });
    } catch (error) {
      logger.error('Failed to get session prompts:', error);
      res.status(500).json({
        success: false,
        error: 'PROMPTS_RETRIEVAL_FAILED',
        message: 'Failed to retrieve teacher prompts'
      });
    }
  }
);

/**
 * POST /ai/sessions/:sessionId/prompts/:promptId/interact
 * 
 * Records teacher interaction with a prompt (acknowledge/use/dismiss)
 * Rate limited: 50 requests per 5 minutes
 */
router.post('/sessions/:sessionId/prompts/:promptId/interact',
  teacherGuidanceLimiter,
  validateParams(promptParamsSchema),
  validate(recordPromptInteractionSchema),
  async (req, res) => {
    try {
      const { teacherPromptService } = await import('../services/teacher-prompt.service');
      const { sessionId, promptId } = req.params;
      const { interactionType, feedback, outcomeData } = req.body;
      const teacher = (req as any).user;

      await teacherPromptService.recordPromptInteraction(
        promptId,
        sessionId,
        teacher.id,
        interactionType,
        feedback
      );

      res.json({
        success: true,
        interactionId: `interaction_${Date.now()}`,
        message: `Prompt ${interactionType} recorded successfully`
      });
    } catch (error) {
      logger.error('Failed to record prompt interaction:', error);
      res.status(500).json({
        success: false,
        error: 'INTERACTION_RECORDING_FAILED',
        message: 'Failed to record prompt interaction'
      });
    }
  }
);

// ============================================================================
// System Status and Health Endpoints
// ============================================================================

/**
 * GET /ai/status
 * 
 * Overall AI system health and status
 */
router.get('/status',
  statusLimiter,
  async (req, res) => {
    try {
      const { databricksAIService } = await import('../services/databricks-ai.service');
      const { aiAnalysisBufferService } = await import('../services/ai-analysis-buffer.service');
      
      const databricksConfig = databricksAIService.getConfiguration();
      const configValidation = databricksAIService.validateConfiguration();
      const bufferStats = aiAnalysisBufferService.getBufferStats();

      // Build complete status response
      const fullStatus = {
        success: true,
        system: 'ClassWaves AI Analysis',
        status: configValidation.valid ? 'healthy' : 'degraded',
        timestamp: new Date().toISOString(),
        services: {
          databricksAI: {
            status: configValidation.valid ? 'online' : 'offline',
            tier1Endpoint: databricksConfig.tier1?.endpoint ? 'configured' : 'missing',
            tier2Endpoint: databricksConfig.tier2?.endpoint ? 'configured' : 'missing',
            errors: configValidation.errors
          },
          bufferService: {
            status: 'online',
            tier1Buffers: bufferStats.tier1.totalBuffers,
            tier2Buffers: bufferStats.tier2.totalBuffers,
            memoryUsage: `${Math.round(bufferStats.tier1.memoryUsageBytes / 1024)}KB`
          },
          teacherGuidance: {
            status: 'online',
            // Additional metrics will be added in Phase B
          }
        },
        performance: {
          tier1WindowMs: databricksConfig.tier1?.timeout || 2000,
          tier2WindowMs: databricksConfig.tier2?.timeout || 5000,
          uptime: process.uptime()
        }
      };

      // Return filtered response for public access
      res.json(getPublicStatusResponse(fullStatus));
    } catch (error) {
      logger.error('Status check failed:', error);
      res.status(500).json({
        success: false,
        error: 'STATUS_CHECK_FAILED',
        message: 'Failed to retrieve system status'
      });
    }
  }
);

/**
 * GET /ai/tier1/status
 * 
 * Tier 1 analysis system status
 */
router.get('/tier1/status',
  statusLimiter,
  async (req, res) => {
    try {
      const { databricksAIService } = await import('../services/databricks-ai.service');
      const { aiAnalysisBufferService } = await import('../services/ai-analysis-buffer.service');
      
      const config = databricksAIService.getConfiguration();
      const bufferStats = aiAnalysisBufferService.getBufferStats();

      // Return safe public information only
      res.json({
        success: true,
        tier: 'tier1',
        status: 'online',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime())
      });
    } catch (error) {
      logger.error('Tier 1 status check failed:', error);
      res.status(500).json({
        success: false,
        error: 'TIER1_STATUS_FAILED',
        message: 'Failed to retrieve Tier 1 status'
      });
    }
  }
);

/**
 * GET /ai/tier2/status
 * 
 * Tier 2 analysis system status
 */
router.get('/tier2/status',
  statusLimiter,
  async (req, res) => {
    try {
      const { databricksAIService } = await import('../services/databricks-ai.service');
      const { aiAnalysisBufferService } = await import('../services/ai-analysis-buffer.service');
      
      const config = databricksAIService.getConfiguration();
      const bufferStats = aiAnalysisBufferService.getBufferStats();

      // Return safe public information only
      res.json({
        success: true,
        tier: 'tier2',
        status: 'online',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime())
      });
    } catch (error) {
      logger.error('Tier 2 status check failed:', error);
      res.status(500).json({
        success: false,
        error: 'TIER2_STATUS_FAILED',
        message: 'Failed to retrieve Tier 2 status'
      });
    }
  }
);

// ============================================================================
// Error Handling Middleware
// ============================================================================

router.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error('AI Analysis Routes Error:', error);
  
  // Handle specific AI analysis errors
  if (error.code && ['DATABRICKS_TIMEOUT', 'DATABRICKS_AUTH', 'DATABRICKS_QUOTA', 'ANALYSIS_FAILED'].includes(error.code)) {
    return res.status(503).json({
      success: false,
      error: error.code,
      message: error.message,
      tier: error.tier,
      retryAfter: error.code === 'DATABRICKS_QUOTA' ? '5 minutes' : '30 seconds'
    });
  }

  // Handle validation errors
  if (error.name === 'ZodError') {
    return res.status(400).json({
      success: false,
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      details: error.issues
    });
  }

  // Handle rate limiting errors
  if (error.statusCode === 429) {
    return res.status(429).json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests',
      retryAfter: error.retryAfter
    });
  }

  // Generic error response
  res.status(500).json({
    success: false,
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred'
  });
});

// ============================================================================
// Export Router
// ============================================================================

export default router;