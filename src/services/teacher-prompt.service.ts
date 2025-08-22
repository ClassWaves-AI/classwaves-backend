/**
 * Teacher Prompt Service
 * 
 * Generates contextual teaching prompts from AI analysis insights with:
 * - COPPA compliance (group-level analysis only, no individual student identification)
 * - Subject-specific and phase-aware prompt generation
 * - Effectiveness scoring and rate limiting
 * - Comprehensive audit logging
 */

import { z } from 'zod';
import { databricksService } from './databricks.service';
import type { Tier1Insights, Tier2Insights } from '../types/ai-analysis.types';
import type { TeacherPrompt, PromptCategory, PromptPriority, PromptTiming, SessionPhase, SubjectArea } from '../types/teacher-guidance.types';

// ============================================================================
// Input Validation Schemas
// ============================================================================

const promptContextSchema = z.object({
  sessionPhase: z.enum(['opening', 'development', 'synthesis', 'closure']),
  subject: z.enum(['math', 'science', 'literature', 'history', 'general']),
  learningObjectives: z.array(z.string().min(1).max(200)).max(5),
  groupSize: z.number().min(1).max(8),
  sessionDuration: z.number().min(1).max(480), // minutes
  sessionId: z.string().uuid(),
  groupId: z.string().uuid(),
  teacherId: z.string().uuid()
});

const promptGenerationOptionsSchema = z.object({
  maxPrompts: z.number().min(1).max(15).default(5),
  priorityFilter: z.enum(['all', 'high', 'medium', 'low']).default('all'),
  categoryFilter: z.array(z.enum(['facilitation', 'deepening', 'redirection', 'collaboration', 'assessment', 'energy', 'clarity'])).optional(),
  includeEffectivenessScore: z.boolean().default(true)
}).optional();

// ============================================================================
// Teacher Prompt Service Types
// ============================================================================

interface PromptGenerationContext {
  sessionId: string;
  groupId: string;
  teacherId: string;
  sessionPhase: SessionPhase;
  subject: SubjectArea;
  learningObjectives: string[];
  groupSize: number;
  sessionDuration: number;
}

interface PromptMetrics {
  totalGenerated: number;
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  effectivenessAverage: number;
}

// ============================================================================
// Teacher Prompt Service
// ============================================================================

export class TeacherPromptService {
  private readonly config = {
    maxPromptsPerSession: parseInt(process.env.TEACHER_PROMPT_MAX_PER_SESSION || '15'),
    promptExpirationMinutes: parseInt(process.env.TEACHER_PROMPT_EXPIRATION_MINUTES || '30'),
    effectivenessScoreWeight: parseFloat(process.env.TEACHER_PROMPT_EFFECTIVENESS_WEIGHT || '0.3'),
    subjectAware: process.env.TEACHER_PROMPT_SUBJECT_AWARE === 'true',
    enableHighPrioritySound: process.env.TEACHER_ALERT_HIGH_PRIORITY_SOUND === 'true'
  };

  private promptCache = new Map<string, TeacherPrompt[]>();
  private sessionMetrics = new Map<string, PromptMetrics>();

  constructor() {
    console.log('🧠 Teacher Prompt Service initialized', {
      maxPromptsPerSession: this.config.maxPromptsPerSession,
      subjectAware: this.config.subjectAware,
      effectivenessScoreWeight: this.config.effectivenessScoreWeight
    });
  }

  // ============================================================================
  // Public Methods
  // ============================================================================

  /**
   * Generate contextual teaching prompts from AI insights
   * 
   * ✅ COMPLIANCE: Group-level analysis only (no individual student identification)
   * ✅ SECURITY: Input validation with Zod schemas
   * ✅ AUDIT: Comprehensive logging for AI-generated teacher guidance
   * ✅ RATE LIMITING: Maximum 15 prompts per session
   */
  async generatePrompts(
    insights: Tier1Insights | Tier2Insights,
    context: PromptGenerationContext,
    options?: z.infer<typeof promptGenerationOptionsSchema>
  ): Promise<TeacherPrompt[]> {
    const startTime = Date.now();

    try {
      // ✅ SECURITY: Input validation
      const validatedContext = promptContextSchema.parse(context);
      const validatedOptions = promptGenerationOptionsSchema.parse(options || {});

      // ✅ RATE LIMITING: Check session prompt limit
      await this.checkRateLimit(validatedContext.sessionId);

      // ✅ COMPLIANCE: Audit logging for AI-generated teacher guidance
      await this.auditLog({
        eventType: 'teacher_prompt_generation',
        actorId: 'system',
        targetType: 'teacher_guidance',
        targetId: validatedContext.sessionId,
        educationalPurpose: 'Generate contextual teaching prompts to improve group discussion quality',
        complianceBasis: 'legitimate_educational_interest',
        sessionId: validatedContext.sessionId,
        groupId: validatedContext.groupId,
        teacherId: validatedContext.teacherId
      });

      // Generate prompts based on insights type
      let prompts: TeacherPrompt[];
      if (this.isTier1Insights(insights)) {
        prompts = await this.generateFromTier1Insights(insights, validatedContext, validatedOptions);
      } else {
        prompts = await this.generateFromTier2Insights(insights, validatedContext, validatedOptions);
      }

      // Apply filters and limits
      prompts = this.applyFilters(prompts, validatedOptions || {});
      prompts = prompts.slice(0, (validatedOptions && validatedOptions.maxPrompts) || 5);

      // ✅ DATABASE: Store generated prompts in database
      await this.storePromptsInDatabase(prompts, validatedContext);

      // Cache prompts and update metrics
      this.cachePrompts(validatedContext.sessionId, prompts);
      await this.updateSessionMetrics(validatedContext.sessionId, prompts);

      const processingTime = Date.now() - startTime;
      console.log(`✅ Generated ${prompts.length} prompts for session ${validatedContext.sessionId} in ${processingTime}ms`);

      return prompts;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Failed to generate prompts for session ${context.sessionId}:`, error);

      // ✅ COMPLIANCE: Audit log for errors
      await this.auditLog({
        eventType: 'teacher_prompt_generation_error',
        actorId: 'system',
        targetType: 'teacher_guidance',
        targetId: context.sessionId,
        educationalPurpose: 'Log prompt generation error for system monitoring',
        complianceBasis: 'system_administration',
        sessionId: context.sessionId,
        error: (error as Error).message
      });

      throw error;
    }
  }

  /**
   * Get cached prompts for a session
   */
  getSessionPrompts(sessionId: string): TeacherPrompt[] {
    return this.promptCache.get(sessionId) || [];
  }

  /**
   * Mark prompt as acknowledged/used/dismissed for effectiveness tracking
   */
  async recordPromptInteraction(
    promptId: string,
    sessionId: string,
    teacherId: string,
    interactionType: 'acknowledged' | 'used' | 'dismissed',
    feedback?: { rating: number; text: string }
  ): Promise<void> {
    try {
      // ✅ COMPLIANCE: Audit logging for teacher interaction data
      await this.auditLog({
        eventType: 'prompt_interaction',
        actorId: teacherId,
        targetType: 'teacher_prompt',
        targetId: promptId,
        educationalPurpose: 'Track teacher engagement with AI-generated guidance for system improvement',
        complianceBasis: 'legitimate_educational_interest',
        sessionId,
        interactionType,
        feedbackRating: feedback?.rating
      });

      // Store interaction in database for analytics
      await this.recordPromptInteractionToDB(promptId, sessionId, teacherId, interactionType, feedback);

    } catch (error) {
      console.error(`❌ Failed to record prompt interaction:`, error);
      throw error;
    }
  }

  /**
   * Get session prompt metrics
   */
  getSessionMetrics(sessionId: string): PromptMetrics | null {
    return this.sessionMetrics.get(sessionId) || null;
  }

  /**
   * Get active prompts for a specific session
   * 
   * ✅ COMPLIANCE: Audit logging for prompt access
   * ✅ PERFORMANCE: Combines cache and database with deduplication
   * ✅ SECURITY: Input validation and error handling
   * ✅ REAL-TIME: Fresh data with cache optimization
   */
  async getActivePrompts(sessionId: string, options?: {
    includeExpired?: boolean;
    maxAge?: number; // minutes
    priorityFilter?: PromptPriority[];
  }): Promise<TeacherPrompt[]> {
    const startTime = Date.now();

    try {
      // ✅ SECURITY: Input validation
      if (!sessionId || typeof sessionId !== 'string') {
        throw new Error('Invalid sessionId provided');
      }

      // ✅ COMPLIANCE: Audit logging for prompt access
      await this.auditLog({
        eventType: 'teacher_prompt_access',
        actorId: 'system',
        targetType: 'teacher_guidance',
        targetId: sessionId,
        educationalPurpose: 'Retrieve active teacher prompts for real-time guidance',
        complianceBasis: 'legitimate_educational_interest',
        sessionId
      });

      const now = new Date();
      const maxAge = options?.maxAge || this.config.promptExpirationMinutes;
      const cutoffTime = new Date(now.getTime() - maxAge * 60000);

      // Step 1: Get prompts from in-memory cache
      const cachedPrompts = this.promptCache.get(sessionId) || [];
      
      // Step 2: Get prompts from database for persistence/recovery
      let dbPrompts: TeacherPrompt[] = [];
      try {
        const dbResults = await databricksService.query(
          `SELECT id, session_id, prompt_id, prompt_text, priority_level, effectiveness_score, generated_at, expires_at FROM classwaves.ai_insights.teacher_guidance_metrics 
           WHERE session_id = ? 
           AND generated_at >= ?
           ${!options?.includeExpired ? 'AND expires_at > ?' : ''}
           AND dismissed_at IS NULL
           ORDER BY priority_level DESC, generated_at DESC`,
          options?.includeExpired 
            ? [sessionId, cutoffTime.toISOString()]
            : [sessionId, cutoffTime.toISOString(), now.toISOString()]
        );

        // Transform database results to TeacherPrompt objects
        dbPrompts = dbResults.map(row => this.transformDbToPrompt(row));
      } catch (dbError) {
        console.warn('⚠️ Database query failed for active prompts, using cache only:', dbError);
        // Continue with cache-only results for graceful degradation
      }

      // Step 3: Merge and deduplicate prompts (cache takes precedence)
      const allPrompts = new Map<string, TeacherPrompt>();
      
      // Add database prompts first
      dbPrompts.forEach(prompt => allPrompts.set(prompt.id, prompt));
      
      // Add cached prompts (overwrites DB with fresher data)
      cachedPrompts.forEach(prompt => allPrompts.set(prompt.id, prompt));

      // Step 4: Apply filters
      let filteredPrompts = Array.from(allPrompts.values());

      // Filter by expiration (unless includeExpired is true)
      if (!options?.includeExpired) {
        filteredPrompts = filteredPrompts.filter(p => p.expiresAt > now);
      }

      // Filter by priority if specified
      if (options?.priorityFilter && options.priorityFilter.length > 0) {
        filteredPrompts = filteredPrompts.filter(p => 
          options.priorityFilter!.includes(p.priority)
        );
      }

      // Filter by age
      filteredPrompts = filteredPrompts.filter(p => 
        p.generatedAt >= cutoffTime
      );

      // Step 5: Sort by priority and creation time
      filteredPrompts.sort((a, b) => {
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
        const aPriority = priorityOrder[a.priority] || 0;
        const bPriority = priorityOrder[b.priority] || 0;
        
        if (aPriority !== bPriority) {
          return bPriority - aPriority; // High priority first
        }
        
        return b.generatedAt.getTime() - a.generatedAt.getTime(); // Newest first
      });

      const processingTime = Date.now() - startTime;
      console.log(`✅ Retrieved ${filteredPrompts.length} active prompts for session ${sessionId} in ${processingTime}ms`);

      return filteredPrompts;

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Failed to get active prompts for session ${sessionId}:`, error);

      // ✅ COMPLIANCE: Audit log for errors
      await this.auditLog({
        eventType: 'teacher_prompt_access_error',
        actorId: 'system',
        targetType: 'teacher_guidance',
        targetId: sessionId,
        educationalPurpose: 'Log prompt access error for system monitoring',
        complianceBasis: 'system_administration',
        sessionId,
        error: (error as Error).message
      });

      throw error;
    }
  }

  /**
   * Transform database row to TeacherPrompt object
   */
  private transformDbToPrompt(row: any): TeacherPrompt {
    return {
      id: row.prompt_id || row.id,
      sessionId: row.session_id,
      teacherId: row.teacher_id,
      groupId: row.group_id,
      category: row.prompt_category,
      priority: row.priority_level,
      message: row.prompt_message,
      context: row.prompt_context,
      suggestedTiming: row.suggested_timing,
      generatedAt: new Date(row.generated_at),
      expiresAt: new Date(row.expires_at),
      acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at) : undefined,
      usedAt: row.used_at ? new Date(row.used_at) : undefined,
      dismissedAt: row.dismissed_at ? new Date(row.dismissed_at) : undefined,
      sessionPhase: row.session_phase,
      subject: row.subject_area,
      targetMetric: row.target_metric,
      learningObjectives: row.learning_objectives ? JSON.parse(row.learning_objectives) : undefined,
      effectivenessScore: row.effectiveness_score,
      feedbackRating: row.feedback_rating,
      feedbackText: row.feedback_text,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at)
    };
  }

  /**
   * Clear expired prompts and cleanup
   */
  async cleanup(): Promise<void> {
    const now = new Date();
    let cleanedCount = 0;

    for (const [sessionId, prompts] of Array.from(this.promptCache.entries())) {
      const activePrompts = prompts.filter(p => p.expiresAt > now);
      
      if (activePrompts.length !== prompts.length) {
        if (activePrompts.length === 0) {
          this.promptCache.delete(sessionId);
        } else {
          this.promptCache.set(sessionId, activePrompts);
        }
        cleanedCount += prompts.length - activePrompts.length;
      }
    }

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired prompts`);
    }
  }

  // ============================================================================
  // Private Methods - Tier 1 Insights Processing
  // ============================================================================

  private async generateFromTier1Insights(
    insights: Tier1Insights,
    context: PromptGenerationContext,
    options: z.infer<typeof promptGenerationOptionsSchema>
  ): Promise<TeacherPrompt[]> {
    const prompts: TeacherPrompt[] = [];

    // Analyze topical cohesion
    if (insights.topicalCohesion < 0.6) {
      prompts.push(this.createPrompt({
        category: 'redirection',
        priority: insights.topicalCohesion < 0.4 ? 'high' : 'medium',
        message: this.getTopicalCohesionPrompt(insights.topicalCohesion, context),
        context: `Group showing topic drift (score: ${(insights.topicalCohesion * 100).toFixed(0)}%)`,
        suggestedTiming: insights.topicalCohesion < 0.4 ? 'immediate' : 'next_break',
        targetMetric: 'topicalCohesion',
        sessionPhase: context.sessionPhase,
        subject: context.subject,
        sessionId: context.sessionId,
        teacherId: context.teacherId,
        groupId: context.groupId
      }));
    }

    // Analyze conceptual density
    if (insights.conceptualDensity < 0.5) {
      prompts.push(this.createPrompt({
        category: 'deepening',
        priority: 'medium',
        message: this.getConceptualDensityPrompt(insights.conceptualDensity, context),
        context: `Discussion needs more depth (score: ${(insights.conceptualDensity * 100).toFixed(0)}%)`,
        suggestedTiming: 'next_break',
        targetMetric: 'conceptualDensity',
        sessionPhase: context.sessionPhase,
        subject: context.subject,
        sessionId: context.sessionId,
        teacherId: context.teacherId,
        groupId: context.groupId
      }));
    }

    // Process any additional insights
    for (const insight of insights.insights) {
      if (insight.severity === 'warning') {
        prompts.push(this.createPromptFromInsight(insight, context));
      }
    }

    return prompts;
  }

  // ============================================================================
  // Private Methods - Tier 2 Insights Processing
  // ============================================================================

  private async generateFromTier2Insights(
    insights: Tier2Insights,
    context: PromptGenerationContext,
    options: z.infer<typeof promptGenerationOptionsSchema>
  ): Promise<TeacherPrompt[]> {
    const prompts: TeacherPrompt[] = [];

    // Analyze argumentation quality
    if (insights.argumentationQuality.score < 0.6) {
      prompts.push(this.createPrompt({
        category: 'deepening',
        priority: 'high',
        message: this.getArgumentationPrompt(insights.argumentationQuality, context),
        context: `Low argumentation quality (score: ${(insights.argumentationQuality.score * 100).toFixed(0)}%)`,
        suggestedTiming: 'immediate',
        targetMetric: 'argumentationQuality',
        sessionPhase: context.sessionPhase,
        subject: context.subject,
        sessionId: context.sessionId,
        teacherId: context.teacherId,
        groupId: context.groupId
      }));
    }

    // Analyze collaboration patterns
    if (insights.collaborationPatterns.inclusivity < 0.5) {
      prompts.push(this.createPrompt({
        category: 'collaboration',
        priority: 'high',
        message: this.getInclusivityPrompt(insights.collaborationPatterns, context),
        context: `Some voices may not be heard (inclusivity: ${(insights.collaborationPatterns.inclusivity * 100).toFixed(0)}%)`,
        suggestedTiming: 'immediate',
        targetMetric: 'collaborationPatterns.inclusivity',
        sessionPhase: context.sessionPhase,
        subject: context.subject,
        sessionId: context.sessionId,
        teacherId: context.teacherId,
        groupId: context.groupId
      }));
    }

    // Analyze emotional arc
    if (insights.collectiveEmotionalArc.trajectory === 'descending') {
      prompts.push(this.createPrompt({
        category: 'energy',
        priority: 'medium',
        message: this.getEnergyPrompt(insights.collectiveEmotionalArc, context),
        context: `Group energy is declining`,
        suggestedTiming: 'immediate',
        targetMetric: 'collectiveEmotionalArc.trajectory',
        sessionPhase: context.sessionPhase,
        subject: context.subject,
        sessionId: context.sessionId,
        teacherId: context.teacherId,
        groupId: context.groupId
      }));
    }

    // Process recommendations
    for (const recommendation of insights.recommendations) {
      if (recommendation.priority === 'high' || recommendation.priority === 'medium') {
        prompts.push(this.createPromptFromRecommendation(recommendation, context));
      }
    }

    return prompts;
  }

  // ============================================================================
  // Private Methods - Prompt Creation
  // ============================================================================

  private createPrompt(data: {
    category: PromptCategory;
    priority: PromptPriority;
    message: string;
    context: string;
    suggestedTiming: PromptTiming;
    targetMetric?: string;
    sessionPhase: SessionPhase;
    subject: SubjectArea;
    sessionId: string;
    teacherId: string;
    groupId?: string;
  }): TeacherPrompt {
    const now = new Date();
    return {
      id: this.generatePromptId(),
      sessionId: data.sessionId,
      teacherId: data.teacherId,
      groupId: data.groupId,
      category: data.category,
      priority: data.priority,
      message: data.message,
      context: data.context,
      suggestedTiming: data.suggestedTiming,
      generatedAt: now,
      expiresAt: new Date(now.getTime() + this.config.promptExpirationMinutes * 60000),
      sessionPhase: data.sessionPhase,
      subject: data.subject,
      targetMetric: data.targetMetric,
      effectivenessScore: this.calculateEffectivenessScore(data.category, data.priority),
      createdAt: now,
      updatedAt: now
    };
  }

  private createPromptFromInsight(insight: any, context: PromptGenerationContext): TeacherPrompt {
    return this.createPrompt({
      category: insight.type === 'topical_cohesion' ? 'redirection' : 'deepening',
      priority: insight.severity === 'warning' ? 'high' : 'medium',
      message: insight.actionable || insight.message,
      context: insight.message,
      suggestedTiming: 'next_break',
      sessionPhase: context.sessionPhase,
      subject: context.subject,
      sessionId: context.sessionId,
      teacherId: context.teacherId,
      groupId: context.groupId
    });
  }

  private createPromptFromRecommendation(recommendation: any, context: PromptGenerationContext): TeacherPrompt {
    const categoryMap: Record<string, PromptCategory> = {
      'intervention': 'redirection',
      'praise': 'energy',
      'redirect': 'redirection',
      'deepen': 'deepening'
    };

    return this.createPrompt({
      category: categoryMap[recommendation.type] || 'facilitation',
      priority: recommendation.priority,
      message: recommendation.suggestedAction || recommendation.message,
      context: recommendation.message,
      suggestedTiming: recommendation.priority === 'high' ? 'immediate' : 'next_break',
      sessionPhase: context.sessionPhase,
      subject: context.subject,
      sessionId: context.sessionId,
      teacherId: context.teacherId,
      groupId: context.groupId
    });
  }

  // ============================================================================
  // Private Methods - Subject-Specific Prompts
  // ============================================================================

  private getTopicalCohesionPrompt(score: number, context: PromptGenerationContext): string {
    const subjectSpecificPrompts = {
      math: "Consider refocusing the group on the mathematical concept at hand. Try asking: 'How does this relate to our problem?'",
      science: "Guide the discussion back to the scientific inquiry. Ask: 'What evidence supports this hypothesis?'",
      literature: "Bring attention back to the text or theme. Try: 'How does this connect to what we're reading?'",
      history: "Redirect to the historical context or period being studied. Ask: 'How does this fit with the time period we're discussing?'",
      general: "Help the group refocus on the main topic. Try asking: 'How does this relate to our learning goal?'"
    };

    const basePrompt = subjectSpecificPrompts[context.subject] || subjectSpecificPrompts.general;
    
    if (score < 0.3) {
      return `The group has significantly drifted off-topic. ${basePrompt} Consider using a gentle redirect or refocusing question.`;
    } else {
      return `The group is showing some topic drift. ${basePrompt}`;
    }
  }

  private getConceptualDensityPrompt(score: number, context: PromptGenerationContext): string {
    const subjectSpecificPrompts = {
      math: "Encourage deeper mathematical thinking. Try asking: 'Can you explain your reasoning?' or 'What patterns do you notice?'",
      science: "Push for more scientific depth. Ask: 'What's your hypothesis?' or 'What observations support that?'",
      literature: "Deepen literary analysis. Try: 'What evidence from the text supports that?' or 'How does the author convey that theme?'",
      history: "Encourage historical thinking. Ask: 'What were the causes and effects?' or 'How did different groups experience this?'",
      general: "Encourage deeper thinking. Try asking: 'Why do you think that?' or 'Can you give an example?'"
    };

    return subjectSpecificPrompts[context.subject] || subjectSpecificPrompts.general;
  }

  private getArgumentationPrompt(argQuality: any, context: PromptGenerationContext): string {
    if (argQuality.claimEvidence < 0.5) {
      return "Students need to support their claims with evidence. Try asking: 'What evidence supports that idea?'";
    }
    if (argQuality.counterarguments < 0.5) {
      return "Encourage considering different perspectives. Ask: 'What might someone who disagrees say?'";
    }
    return "Help students build stronger arguments. Try: 'Can you explain the reasoning behind that?'";
  }

  private getInclusivityPrompt(collaboration: any, context: PromptGenerationContext): string {
    return "Some group members may not be participating fully. Try: 'Let's hear from everyone on this' or 'What do you think, [name]?'";
  }

  private getEnergyPrompt(emotionalArc: any, context: PromptGenerationContext): string {
    return "The group's energy seems to be declining. Consider a brief energizer or change of pace to re-engage students.";
  }

  // ============================================================================
  // Private Methods - Utilities
  // ============================================================================

  private isTier1Insights(insights: Tier1Insights | Tier2Insights): insights is Tier1Insights {
    return 'topicalCohesion' in insights && 'conceptualDensity' in insights;
  }

  private async checkRateLimit(sessionId: string): Promise<void> {
    const prompts = this.promptCache.get(sessionId) || [];
    const activePrompts = prompts.filter(p => p.expiresAt > new Date());
    
    if (activePrompts.length >= this.config.maxPromptsPerSession) {
      throw new Error(`Rate limit exceeded: Maximum ${this.config.maxPromptsPerSession} prompts per session`);
    }
  }

  private applyFilters(
    prompts: TeacherPrompt[], 
    options: z.infer<typeof promptGenerationOptionsSchema> | {}
  ): TeacherPrompt[] {
    let filtered = prompts;

    if (options && 'priorityFilter' in options && options.priorityFilter !== 'all') {
      filtered = filtered.filter(p => p.priority === options.priorityFilter);
    }

    if (options && 'categoryFilter' in options && options.categoryFilter && options.categoryFilter.length > 0) {
      filtered = filtered.filter(p => options.categoryFilter!.includes(p.category));
    }

    // Sort by priority and effectiveness score
    return filtered.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      
      if (priorityDiff !== 0) return priorityDiff;
      
      return (b.effectivenessScore || 0) - (a.effectivenessScore || 0);
    });
  }

  private calculateEffectivenessScore(category: string, priority: string): number {
    const categoryWeights: Record<string, number> = {
      redirection: 0.9,
      collaboration: 0.85,
      deepening: 0.8,
      energy: 0.75,
      facilitation: 0.7,
      assessment: 0.65,
      clarity: 0.6
    };

    const priorityWeights: Record<string, number> = {
      high: 1.0,
      medium: 0.8,
      low: 0.6
    };

    const baseScore = (categoryWeights[category] || 0.5) * (priorityWeights[priority] || 0.5);
    return Math.min(0.95, baseScore + Math.random() * 0.1); // Add small random factor
  }

  private cachePrompts(sessionId: string, prompts: TeacherPrompt[]): void {
    const existing = this.promptCache.get(sessionId) || [];
    this.promptCache.set(sessionId, [...existing, ...prompts]);
  }

  private async updateSessionMetrics(sessionId: string, prompts: TeacherPrompt[]): Promise<void> {
    let metrics = this.sessionMetrics.get(sessionId) || {
      totalGenerated: 0,
      byCategory: {},
      byPriority: {},
      effectivenessAverage: 0
    };

    metrics.totalGenerated += prompts.length;

    for (const prompt of prompts) {
      metrics.byCategory[prompt.category] = (metrics.byCategory[prompt.category] || 0) + 1;
      metrics.byPriority[prompt.priority] = (metrics.byPriority[prompt.priority] || 0) + 1;
    }

    // Recalculate effectiveness average
    const allPrompts = this.promptCache.get(sessionId) || [];
    const scores = allPrompts.map(p => p.effectivenessScore || 0).filter(s => s > 0);
    metrics.effectivenessAverage = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    this.sessionMetrics.set(sessionId, metrics);
  }

  private async recordPromptInteractionToDB(
    promptId: string,
    sessionId: string,
    teacherId: string,
    interactionType: string,
    feedback?: { rating: number; text: string }
  ): Promise<void> {
    try {
      // ✅ DATABASE: Store prompt interaction in teacher_guidance_metrics table
      const interactionData = {
        id: `interaction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        session_id: sessionId,
        teacher_id: teacherId,
        prompt_id: promptId,
        prompt_category: 'unknown', // Will be updated when we have prompt details
        priority_level: 'medium', // Will be updated when we have prompt details
        generated_at: new Date(),
        [`${interactionType}_at`]: new Date(),
        feedback_rating: feedback?.rating,
        feedback_text: feedback?.text,
        created_at: new Date(),
        updated_at: new Date()
      };

      // Insert into database
      await databricksService.insert('teacher_guidance_metrics', interactionData);

      // Update effectiveness metrics
      await this.updateEffectivenessMetrics(promptId, sessionId, teacherId, interactionType, feedback);

      console.log(`📊 Prompt interaction stored in database: ${promptId} - ${interactionType}`);

    } catch (error) {
      console.error(`❌ Failed to store prompt interaction in database:`, error);
      // Don't throw error to avoid breaking the main flow
    }
  }

  private async storePromptsInDatabase(
    prompts: TeacherPrompt[],
    context: PromptGenerationContext
  ): Promise<void> {
    try {
      for (const prompt of prompts) {
        // ✅ DATABASE: Store prompt in teacher_guidance_metrics table
        const promptData = {
          id: prompt.id,
          session_id: context.sessionId,
          teacher_id: context.teacherId,
          prompt_id: prompt.id,
          prompt_category: prompt.category,
          priority_level: prompt.priority,
          prompt_message: prompt.message,
          prompt_context: prompt.context,
          suggested_timing: prompt.suggestedTiming,
          session_phase: prompt.sessionPhase,
          subject_area: prompt.subject,
          target_metric: prompt.targetMetric,
          learning_objectives: JSON.stringify(context.learningObjectives),
          group_id: context.groupId,
          generated_at: prompt.generatedAt,
          expires_at: prompt.expiresAt,
          effectiveness_score: prompt.effectivenessScore,
          educational_purpose: 'AI-generated teacher guidance to improve educational outcomes',
          compliance_basis: 'legitimate_educational_interest',
          data_retention_date: new Date(Date.now() + 7 * 365 * 24 * 60 * 60 * 1000), // 7 years
          created_at: new Date(),
          updated_at: new Date()
        };

        await databricksService.insert('teacher_guidance_metrics', promptData);
      }

      console.log(`✅ Stored ${prompts.length} prompts in database for session ${context.sessionId}`);

    } catch (error) {
      console.error(`❌ Failed to store prompts in database:`, error);
      // Don't throw error to avoid breaking the main flow
    }
  }

  private async updateEffectivenessMetrics(
    promptId: string,
    sessionId: string,
    teacherId: string,
    interactionType: string,
    feedback?: { rating: number; text: string }
  ): Promise<void> {
    try {
      // ✅ DATABASE: Update the existing prompt record with interaction data
      const updateData: any = {
        updated_at: new Date()
      };

      // Set the appropriate timestamp field
      if (interactionType === 'acknowledged') {
        updateData.acknowledged_at = new Date();
      } else if (interactionType === 'used') {
        updateData.used_at = new Date();
      } else if (interactionType === 'dismissed') {
        updateData.dismissed_at = new Date();
      }

      // Add feedback if provided
      if (feedback) {
        updateData.feedback_rating = feedback.rating;
        updateData.feedback_text = feedback.text;
      }

      // Calculate response time if acknowledged
      if (interactionType === 'acknowledged') {
        const promptRecord = await this.getPromptFromDatabase(promptId);
        if (promptRecord && promptRecord.generated_at) {
          const responseTime = (Date.now() - new Date(promptRecord.generated_at).getTime()) / 1000;
          updateData.response_time_seconds = Math.round(responseTime);
        }
      }

      // Update the record
      await databricksService.update('teacher_guidance_metrics', promptId, updateData);

      // Update aggregated effectiveness metrics
      await this.updatePromptEffectivenessTable(promptId, sessionId, teacherId, interactionType, feedback);

      console.log(`✅ Updated effectiveness metrics for prompt ${promptId}`);

    } catch (error) {
      console.error(`❌ Failed to update effectiveness metrics:`, error);
    }
  }

  private async getPromptFromDatabase(promptId: string): Promise<any> {
    try {
      const query = `
        SELECT generated_at, prompt_category, priority_level, subject_area, session_phase
        FROM classwaves.ai_insights.teacher_guidance_metrics
        WHERE id = ?
        LIMIT 1
      `;
      
      const results = await databricksService.query(query, [promptId]);
      return results.length > 0 ? results[0] : null;

    } catch (error) {
      console.error(`❌ Failed to get prompt from database:`, error);
      return null;
    }
  }

  private async updatePromptEffectivenessTable(
    promptId: string,
    sessionId: string,
    teacherId: string,
    interactionType: string,
    feedback?: { rating: number; text: string }
  ): Promise<void> {
    try {
      // Get prompt details for aggregation
      const promptRecord = await this.getPromptFromDatabase(promptId);
      if (!promptRecord) {
        return;
      }

      const { prompt_category, subject_area, session_phase, priority_level } = promptRecord;

      // Check if effectiveness record exists
      const existingQuery = `
        SELECT id, total_generated, total_acknowledged, total_used, total_dismissed,
               avg_effectiveness_score, avg_feedback_rating, data_points
        FROM classwaves.ai_insights.teacher_prompt_effectiveness
        WHERE prompt_category = ? AND subject_area = ? AND session_phase = ?
        LIMIT 1
      `;

      const existing = await databricksService.query(existingQuery, [prompt_category, subject_area, session_phase]);

      if (existing.length > 0) {
        // Update existing record
        const record = existing[0];
        const updateData: any = {
          updated_at: new Date(),
          last_calculated: new Date()
        };

        // Increment appropriate counters
        if (interactionType === 'acknowledged') {
          updateData.total_acknowledged = record.total_acknowledged + 1;
        } else if (interactionType === 'used') {
          updateData.total_used = record.total_used + 1;
        } else if (interactionType === 'dismissed') {
          updateData.total_dismissed = record.total_dismissed + 1;
        }

        // Update averages if feedback provided
        if (feedback && feedback.rating) {
          const currentAvg = record.avg_feedback_rating || 0;
          const currentDataPoints = record.data_points || 0;
          const newDataPoints = currentDataPoints + 1;
          updateData.avg_feedback_rating = ((currentAvg * currentDataPoints) + feedback.rating) / newDataPoints;
          updateData.data_points = newDataPoints;
        }

        await databricksService.update('teacher_prompt_effectiveness', record.id, updateData);

      } else {
        // Create new effectiveness record
        const newRecord = {
          id: `effectiveness_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          prompt_category,
          subject_area,
          session_phase,
          priority_level,
          total_generated: 1,
          total_acknowledged: interactionType === 'acknowledged' ? 1 : 0,
          total_used: interactionType === 'used' ? 1 : 0,
          total_dismissed: interactionType === 'dismissed' ? 1 : 0,
          avg_effectiveness_score: 0.5, // Default
          avg_feedback_rating: feedback?.rating || 0,
          avg_response_time_seconds: 0,
          avg_learning_impact: 0,
          data_points: feedback ? 1 : 0,
          calculation_period_start: new Date(),
          calculation_period_end: new Date(),
          last_calculated: new Date(),
          created_at: new Date(),
          updated_at: new Date()
        };

        await databricksService.insert('teacher_prompt_effectiveness', newRecord);
      }

      console.log(`✅ Updated prompt effectiveness table for category: ${prompt_category}`);

    } catch (error) {
      console.error(`❌ Failed to update prompt effectiveness table:`, error);
    }
  }

  private generatePromptId(): string {
    return 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  private async auditLog(data: {
    eventType: string;
    actorId: string;
    targetType: string;
    targetId: string;
    educationalPurpose: string;
    complianceBasis: string;
    sessionId: string;
    groupId?: string;
    teacherId?: string;
    interactionType?: string;
    feedbackRating?: number;
    error?: string;
  }): Promise<void> {
    try {
      await databricksService.recordAuditLog({
        actorId: data.actorId,
        actorType: data.actorId === 'system' ? 'system' : 'teacher',
        eventType: data.eventType,
        eventCategory: 'data_access',
        resourceType: data.targetType,
        resourceId: data.targetId,
        schoolId: 'system', // System-level operation
        description: `${data.educationalPurpose} - Session: ${data.sessionId}`,
        complianceBasis: 'legitimate_interest',
        dataAccessed: data.interactionType ? `prompt_interaction_${data.interactionType}` : 'ai_insights'
      });
    } catch (error) {
      // Don't fail the main operation if audit logging fails
      console.warn('⚠️ Audit logging failed in teacher prompt service:', error);
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const teacherPromptService = new TeacherPromptService();

// Periodic cleanup (skip in test environment to avoid keeping Jest alive)
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    teacherPromptService.cleanup().catch(error => {
      console.error('❌ Teacher prompt cleanup failed:', error);
    });
  }, 15 * 60 * 1000); // Every 15 minutes
}
