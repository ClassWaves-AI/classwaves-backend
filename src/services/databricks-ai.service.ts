/**
 * Databricks AI Service
 * 
 * Implements the Two-Tier AI Analysis System:
 * - Tier 1: Real-time group analysis (30s cadence) - Topical Cohesion, Conceptual Density
 * - Tier 2: Deep educational analysis (2-5min) - Argumentation Quality, Emotional Arc
 */

import axios, { AxiosResponse } from 'axios';
import { 
  Tier1Options, 
  Tier1Insights, 
  Tier2Options, 
  Tier2Insights,
  DatabricksAIRequest,
  DatabricksAIResponse,
  AIAnalysisConfig,
  AIAnalysisError,
  AnalysisTier
} from '../types/ai-analysis.types';

export class DatabricksAIService {
  private config: AIAnalysisConfig;
  
  constructor() {
    this.config = {
      tier1: {
        endpoint: process.env.AI_TIER1_ENDPOINT || '/serving-endpoints/classwaves-tier1-group-analysis/invocations',
        timeout: parseInt(process.env.AI_TIER1_TIMEOUT_MS || '2000'),
        windowSeconds: parseInt(process.env.AI_TIER1_WINDOW_SECONDS || '30'),
        maxTokens: parseInt(process.env.AI_TIER1_MAX_TOKENS || '1000'),
        temperature: parseFloat(process.env.AI_TIER1_TEMPERATURE || '0.1')
      },
      tier2: {
        endpoint: process.env.AI_TIER2_ENDPOINT || '/serving-endpoints/classwaves-tier2-deep-analysis/invocations',
        timeout: parseInt(process.env.AI_TIER2_TIMEOUT_MS || '5000'),
        windowMinutes: parseInt(process.env.AI_TIER2_WINDOW_MINUTES || '3'),
        maxTokens: parseInt(process.env.AI_TIER2_MAX_TOKENS || '2000'),
        temperature: parseFloat(process.env.AI_TIER2_TEMPERATURE || '0.1')
      },
      databricks: {
        token: process.env.DATABRICKS_TOKEN || '',
        workspaceUrl: process.env.DATABRICKS_WORKSPACE_URL || 'https://dbc-d5db37cb-5441.cloud.databricks.com'
      },
      retries: {
        maxAttempts: parseInt(process.env.AI_RETRY_MAX_ATTEMPTS || '3'),
        backoffMs: parseInt(process.env.AI_RETRY_BACKOFF_MS || '1000'),
        jitter: process.env.AI_RETRY_JITTER !== 'false'
      }
    };

    if (!this.config.databricks.token) {
      console.warn('⚠️  DATABRICKS_TOKEN not configured - AI analysis will not function');
    }
  }

  // ============================================================================
  // Tier 1 Analysis: Real-time Group Insights (30s cadence)
  // ============================================================================

  /**
   * Analyzes group transcripts for real-time insights
   * Focus: Topical Cohesion, Conceptual Density
   * Timeline: <2s response time
   */
  async analyzeTier1(groupTranscripts: string[], options: Tier1Options): Promise<Tier1Insights> {
    const startTime = Date.now();
    
    try {
      console.log(`🧠 Starting Tier 1 analysis for group ${options.groupId}`);
      
      // Build analysis prompt
      const prompt = this.buildTier1Prompt(groupTranscripts, options);
      
      // Call Databricks AI endpoint
      const response = await this.callDatabricksEndpoint('tier1', prompt);
      
      // Parse and validate response
      const insights = await this.parseTier1Response(response, groupTranscripts, options);
      
      const processingTime = Date.now() - startTime;
      console.log(`✅ Tier 1 analysis completed for group ${options.groupId} in ${processingTime}ms`);
      
      // Add processing metadata
      insights.metadata = {
        ...insights.metadata,
        processingTimeMs: processingTime,
        modelVersion: 'tier1-v1.0'
      };
      
      return insights;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Tier 1 analysis failed for group ${options.groupId}:`, error);
      
      throw this.createAIError(
        'ANALYSIS_FAILED',
        `Tier 1 analysis failed: ${error.message}`,
        'tier1',
        options.groupId,
        options.sessionId,
        { processingTime, originalError: error }
      );
    }
  }

  /**
   * Builds the analysis prompt for Tier 1 (real-time insights)
   */
  private buildTier1Prompt(transcripts: string[], options: Tier1Options): string {
    const combinedTranscript = transcripts.join(' ').trim();
    
    return `You are an expert educational AI analyzing group discussion transcripts in real-time. 

**ANALYSIS CONTEXT:**
- Group ID: ${options.groupId}
- Session ID: ${options.sessionId}
- Window Size: ${options.windowSize || 30} seconds
- Transcript Length: ${combinedTranscript.length} characters

**TRANSCRIPT TO ANALYZE:**
${combinedTranscript}

**ANALYSIS REQUIREMENTS:**
Provide a JSON response with exactly this structure:

{
  "topicalCohesion": <0-1 score>,
  "conceptualDensity": <0-1 score>,
  "analysisTimestamp": "<ISO timestamp>",
  "windowStartTime": "<ISO timestamp>",
  "windowEndTime": "<ISO timestamp>",
  "transcriptLength": <number>,
  "confidence": <0-1 score>,
  "insights": [
    {
      "type": "topical_cohesion" | "conceptual_density",
      "message": "<actionable insight>",
      "severity": "info" | "warning" | "success",
      "actionable": "<teacher suggestion>"
    }
  ]
}

**SCORING GUIDELINES:**
- **topicalCohesion** (0-1): How well the group stays focused on the intended topic/task
  - 0.8+: Excellent focus, clear topic progression
  - 0.6-0.8: Good focus with minor diversions
  - 0.4-0.6: Moderate focus, some off-topic discussion
  - <0.4: Poor focus, significant topic drift
  
- **conceptualDensity** (0-1): Sophistication and depth of language/concepts used
  - 0.8+: Advanced vocabulary, complex concepts, deep thinking
  - 0.6-0.8: Good use of subject-specific terms, clear reasoning
  - 0.4-0.6: Basic concepts with some complexity
  - <0.4: Simple language, surface-level discussion

**INSIGHT GUIDELINES:**
- Generate 1-3 actionable insights only
- Focus on immediate, practical teacher interventions
- Use clear, non-judgmental language
- Prioritize insights that can improve current discussion

Return only valid JSON with no additional text.`;
  }

  // ============================================================================
  // Tier 2 Analysis: Deep Educational Insights (2-5min cadence)
  // ============================================================================

  /**
   * Performs deep analysis of session transcripts
   * Focus: Argumentation Quality, Emotional Arc, Collaboration Patterns, Learning Signals
   * Timeline: <5s response time
   */
  async analyzeTier2(sessionTranscripts: string[], options: Tier2Options): Promise<Tier2Insights> {
    const startTime = Date.now();
    
    try {
      console.log(`🧠 Starting Tier 2 analysis for session ${options.sessionId}`);
      
      // Build comprehensive analysis prompt
      const prompt = this.buildTier2Prompt(sessionTranscripts, options);
      
      // Call Databricks AI endpoint
      const response = await this.callDatabricksEndpoint('tier2', prompt);
      
      // Parse and validate response
      const insights = await this.parseTier2Response(response, sessionTranscripts, options);
      
      const processingTime = Date.now() - startTime;
      console.log(`✅ Tier 2 analysis completed for session ${options.sessionId} in ${processingTime}ms`);
      
      // Add processing metadata
      insights.metadata = {
        ...insights.metadata,
        processingTimeMs: processingTime,
        modelVersion: 'tier2-v1.0',
        analysisModules: ['argumentation', 'emotional_arc', 'collaboration', 'learning_signals']
      };
      
      return insights;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Tier 2 analysis failed for session ${options.sessionId}:`, error);
      
      throw this.createAIError(
        'ANALYSIS_FAILED',
        `Tier 2 analysis failed: ${error.message}`,
        'tier2',
        undefined,
        options.sessionId,
        { processingTime, originalError: error }
      );
    }
  }

  /**
   * Builds the analysis prompt for Tier 2 (deep insights)
   */
  private buildTier2Prompt(transcripts: string[], options: Tier2Options): string {
    const combinedTranscript = transcripts.join('\n\n').trim();
    
    return `You are an expert educational AI conducting deep analysis of classroom group discussions.

**ANALYSIS CONTEXT:**
- Session ID: ${options.sessionId}
- Analysis Depth: ${options.analysisDepth}
- Groups Analyzed: ${options.groupIds?.length || 'All groups'}
- Total Transcript Length: ${combinedTranscript.length} characters

**TRANSCRIPT TO ANALYZE:**
${combinedTranscript}

**ANALYSIS REQUIREMENTS:**
Provide a comprehensive JSON response with exactly this structure:

{
  "argumentationQuality": {
    "score": <0-1>,
    "claimEvidence": <0-1>,
    "logicalFlow": <0-1>,
    "counterarguments": <0-1>,
    "synthesis": <0-1>
  },
  "collectiveEmotionalArc": {
    "trajectory": "ascending" | "descending" | "stable" | "volatile",
    "averageEngagement": <0-1>,
    "energyPeaks": [<timestamps>],
    "sentimentFlow": [
      {
        "timestamp": "<ISO timestamp>",
        "sentiment": <-1 to 1>,
        "confidence": <0-1>
      }
    ]
  },
  "collaborationPatterns": {
    "turnTaking": <0-1>,
    "buildingOnIdeas": <0-1>,
    "conflictResolution": <0-1>,
    "inclusivity": <0-1>
  },
  "learningSignals": {
    "conceptualGrowth": <0-1>,
    "questionQuality": <0-1>,
    "metacognition": <0-1>,
    "knowledgeApplication": <0-1>
  },
  "analysisTimestamp": "<ISO timestamp>",
  "sessionStartTime": "<ISO timestamp>",
  "analysisEndTime": "<ISO timestamp>",
  "totalTranscriptLength": <number>,
  "groupsAnalyzed": [<group IDs>],
  "confidence": <0-1>,
  "recommendations": [
    {
      "type": "intervention" | "praise" | "redirect" | "deepen",
      "priority": "low" | "medium" | "high",
      "message": "<teacher-facing message>",
      "suggestedAction": "<specific action>",
      "targetGroups": [<group IDs>]
    }
  ]
}

**DETAILED SCORING GUIDELINES:**

**Argumentation Quality:**
- claimEvidence: How well students support their claims with evidence
- logicalFlow: Logical progression and coherence of arguments
- counterarguments: Consideration of alternative perspectives
- synthesis: Integration of multiple viewpoints into coherent understanding

**Emotional Arc:**
- trajectory: Overall emotional direction of the discussion
- averageEngagement: Sustained interest and participation level
- energyPeaks: Moments of high engagement or excitement
- sentimentFlow: Emotional progression throughout the session

**Collaboration Patterns:**
- turnTaking: Balanced participation across group members
- buildingOnIdeas: How well students develop each other's contributions
- conflictResolution: Handling of disagreements constructively
- inclusivity: Ensuring all voices are heard and valued

**Learning Signals:**
- conceptualGrowth: Evidence of developing understanding
- questionQuality: Depth and relevance of student questions
- metacognition: Awareness of own thinking processes
- knowledgeApplication: Applying concepts to new contexts

**Recommendations:**
- Generate 2-5 high-value recommendations
- Focus on actionable interventions teachers can implement immediately
- Prioritize based on potential impact on learning outcomes
- Be specific about which groups need attention

Return only valid JSON with no additional text.`;
  }

  // ============================================================================
  // Databricks API Communication
  // ============================================================================

  /**
   * Calls the appropriate Databricks AI endpoint
   */
  private async callDatabricksEndpoint(tier: AnalysisTier, prompt: string): Promise<DatabricksAIResponse> {
    const config = tier === 'tier1' ? this.config.tier1 : this.config.tier2;
    const fullUrl = `${this.config.databricks.workspaceUrl}${config.endpoint}`;
    
    const payload: DatabricksAIRequest = {
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: config.maxTokens,
      temperature: config.temperature
    };

    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.config.retries.maxAttempts; attempt++) {
      try {
        console.log(`🔄 ${tier.toUpperCase()} API call attempt ${attempt}/${this.config.retries.maxAttempts}`);
        
        const response: AxiosResponse<DatabricksAIResponse> = await axios.post(fullUrl, payload, {
          headers: {
            'Authorization': `Bearer ${this.config.databricks.token}`,
            'Content-Type': 'application/json'
          },
          timeout: config.timeout
        });

        console.log(`✅ ${tier.toUpperCase()} API call successful on attempt ${attempt}`);
        return response.data;
        
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️  ${tier.toUpperCase()} API call failed on attempt ${attempt}:`, error.message);
        
        // Check for specific error types
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 401) {
            throw this.createAIError('DATABRICKS_AUTH', 'Invalid Databricks token', tier);
          }
          if (error.response?.status === 429) {
            throw this.createAIError('DATABRICKS_QUOTA', 'Databricks quota exceeded', tier);
          }
          if (error.code === 'ECONNABORTED') {
            throw this.createAIError('DATABRICKS_TIMEOUT', 'Databricks request timeout', tier);
          }
        }
        
        // Wait before retry (with jitter)
        if (attempt < this.config.retries.maxAttempts) {
          const backoff = this.config.retries.backoffMs * Math.pow(2, attempt - 1);
          const jitter = this.config.retries.jitter ? Math.random() * 0.3 * backoff : 0;
          const delay = backoff + jitter;
          
          console.log(`⏳ Retrying ${tier.toUpperCase()} in ${Math.round(delay)}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw this.createAIError(
      'DATABRICKS_TIMEOUT',
      `Failed after ${this.config.retries.maxAttempts} attempts: ${lastError.message}`,
      tier
    );
  }

  // ============================================================================
  // Response Parsing
  // ============================================================================

  /**
   * Parses Tier 1 response from Databricks
   */
  private async parseTier1Response(
    response: DatabricksAIResponse, 
    transcripts: string[], 
    options: Tier1Options
  ): Promise<Tier1Insights> {
    try {
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from Databricks');
      }

      const parsed = JSON.parse(content);
      
      // Validate required fields
      const required = ['topicalCohesion', 'conceptualDensity', 'confidence', 'insights'];
      for (const field of required) {
        if (!(field in parsed)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Ensure proper timestamp formatting
      const now = new Date().toISOString();
      const windowStart = new Date(Date.now() - (options.windowSize || 30) * 1000).toISOString();
      
      return {
        ...parsed,
        analysisTimestamp: now,
        windowStartTime: windowStart,
        windowEndTime: now,
        transcriptLength: transcripts.join(' ').length,
        // Ensure insights is an array
        insights: Array.isArray(parsed.insights) ? parsed.insights : []
      };
      
    } catch (error) {
      console.error('Failed to parse Tier 1 response:', error);
      throw this.createAIError(
        'ANALYSIS_FAILED',
        `Failed to parse Tier 1 response: ${error.message}`,
        'tier1',
        options.groupId,
        options.sessionId
      );
    }
  }

  /**
   * Parses Tier 2 response from Databricks
   */
  private async parseTier2Response(
    response: DatabricksAIResponse, 
    transcripts: string[], 
    options: Tier2Options
  ): Promise<Tier2Insights> {
    try {
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from Databricks');
      }

      const parsed = JSON.parse(content);
      
      // Validate required fields
      const required = ['argumentationQuality', 'collectiveEmotionalArc', 'collaborationPatterns', 'learningSignals', 'confidence', 'recommendations'];
      for (const field of required) {
        if (!(field in parsed)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Ensure proper timestamp formatting
      const now = new Date().toISOString();
      const sessionStart = new Date(Date.now() - (options.sessionId ? 10 * 60 * 1000 : 0)).toISOString(); // Estimate session start
      
      return {
        ...parsed,
        analysisTimestamp: now,
        sessionStartTime: sessionStart,
        analysisEndTime: now,
        totalTranscriptLength: transcripts.join('\n\n').length,
        groupsAnalyzed: options.groupIds || ['all'],
        // Ensure arrays
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : []
      };
      
    } catch (error) {
      console.error('Failed to parse Tier 2 response:', error);
      throw this.createAIError(
        'ANALYSIS_FAILED',
        `Failed to parse Tier 2 response: ${error.message}`,
        'tier2',
        undefined,
        options.sessionId
      );
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Creates a structured AI analysis error
   */
  private createAIError(
    code: AIAnalysisError['code'],
    message: string,
    tier?: AnalysisTier,
    groupId?: string,
    sessionId?: string,
    details?: any
  ): AIAnalysisError {
    const error = new Error(message) as AIAnalysisError;
    error.code = code;
    error.tier = tier;
    error.groupId = groupId;
    error.sessionId = sessionId;
    error.details = details;
    return error;
  }

  /**
   * Validates service configuration
   */
  public validateConfiguration(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!this.config.databricks.token) {
      errors.push('DATABRICKS_TOKEN not configured');
    }
    
    if (!this.config.databricks.workspaceUrl) {
      errors.push('DATABRICKS_WORKSPACE_URL not configured');
    }
    
    if (!this.config.tier1.endpoint || !this.config.tier2.endpoint) {
      errors.push('AI endpoint URLs not configured');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Gets current service configuration
   */
  public getConfiguration(): Partial<AIAnalysisConfig> {
    return {
      tier1: {
        ...this.config.tier1,
      },
      tier2: {
        ...this.config.tier2,
      },
      databricks: {
        workspaceUrl: this.config.databricks.workspaceUrl,
        token: this.config.databricks.token ? 'Configured' : 'Missing'
      } as any,
      retries: this.config.retries
    };
  }
}

// Export singleton instance
export const databricksAIService = new DatabricksAIService();
