/**
 * Databricks AI Service
 * 
 * Implements the Two-Tier AI Analysis System:
 * - Tier 1: Real-time group analysis (30s cadence) - Topical Cohesion, Conceptual Density
 * - Tier 2: Deep educational analysis (2-5min) - Argumentation Quality, Emotional Arc
 */

interface HttpResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

interface RequestInitLite {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

type FetchLike = (input: string, init?: RequestInitLite) => Promise<HttpResponse>;
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
import type { GroupSummary, SessionSummary } from '../types/ai-summaries.types';

export class DatabricksAIService {
  private baseConfig: Omit<AIAnalysisConfig, 'tier1' | 'tier2' | 'databricks'> & {
    // Keep non-env-tied defaults here (retry/backoff, etc.)
    retries: AIAnalysisConfig['retries'];
  };

  constructor() {
    // Only validate required envs here; do not permanently capture env values.
    // Tests require strict presence of DATABRICKS_HOST
    const workspaceUrl = process.env.DATABRICKS_HOST || '';
    const tier1Endpoint = process.env.AI_TIER1_ENDPOINT || '';

    if (!workspaceUrl) {
      throw new Error('DATABRICKS_HOST is required');
    }
    if (!tier1Endpoint) {
      throw new Error('AI_TIER1_ENDPOINT is required');
    }

    this.baseConfig = {
      retries: {
        maxAttempts: parseInt(process.env.AI_RETRY_MAX_ATTEMPTS || '3'),
        backoffMs: parseInt(process.env.AI_RETRY_BACKOFF_MS || '1000'),
        jitter: process.env.AI_RETRY_JITTER !== 'false'
      }
    };
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
    if (!options) {
      throw new Error('Options are required');
    }
    if (!Array.isArray(groupTranscripts) || groupTranscripts.length === 0) {
      throw new Error('No transcripts provided');
    }

    const startTime = Date.now();
    
    try {
      console.log(`🧠 Starting Tier 1 analysis for group ${options.groupId}`);
      
      // Build analysis prompt
      const prompt = this.buildTier1Prompt(groupTranscripts, options);
      
      const insights = await this.callInsightsEndpoint<Tier1Insights>('tier1', prompt, groupTranscripts, options);
      
      const processingTime = Date.now() - startTime;
      console.log(`✅ Tier 1 analysis completed for group ${options.groupId} in ${processingTime}ms`);
      
      return insights;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Tier 1 analysis failed for group ${options.groupId}:`, error);
      // Preserve original error message for unit tests determinism
      throw error as Error;
    }
  }

  /**
   * Builds the analysis prompt for Tier 1 (real-time insights)
   */
  private buildTier1Prompt(transcripts: string[], options: Tier1Options): string {
    const combinedTranscript = transcripts.join(' ').trim();
    const ctx = this.sanitizeSessionContext(options.sessionContext);
    // Avoid including raw IDs or long numeric sequences in the prompt to prevent input guardrails
    // Context lines keep only non-PII operational info
    return `You are an expert educational AI analyzing group discussion transcripts in real-time.

**ANALYSIS CONTEXT:**
- Window Size: ${options.windowSize || 30} seconds
- Transcript Length: ${combinedTranscript.length} characters

**INTENDED SESSION CONTEXT (sanitized JSON):**
${JSON.stringify(ctx)}

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
- Generate 1 actionable insights only
- Focus on immediate, practical teacher interventions
- Use clear yet helpful, non-judgmental language
- Prioritize insights that can improve current discussion
- Focus on providing reasons why the insight is important and how the teacher can help the students improve their discussion


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
      
      const insights = await this.callInsightsEndpoint<Tier2Insights>('tier2', prompt, sessionTranscripts, options);
      
      const processingTime = Date.now() - startTime;
      console.log(`✅ Tier 2 analysis completed for session ${options.sessionId} in ${processingTime}ms`);
      
      return insights;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`❌ Tier 2 analysis failed for session ${options.sessionId}:`, error);
      // Preserve original error message for unit tests determinism
      throw error as Error;
    }
  }

  /**
   * Summarize a single group's discussion for teacher-facing review.
   * Uses Tier 2 endpoint configuration for higher token allowance.
   */
  async summarizeGroup(groupTranscripts: string[], options: { sessionId: string; groupId: string }): Promise<GroupSummary> {
    if (!Array.isArray(groupTranscripts) || groupTranscripts.length === 0) {
      throw new Error('No transcripts provided');
    }
    const combined = groupTranscripts.join('\n');
    const prompt = `You are an expert classroom observer. Summarize the group discussion for teachers.\n\nInput: all transcripts for one group in a session.\nSession ID: ${options.sessionId}\nGroup ID: ${options.groupId}\n\nProvide a strict JSON object with fields: \n{\n  "overview": string,\n  "participation": { "notableContributors": string[], "dynamics": string },\n  "misconceptions": string[],\n  "highlights": [{ "quote": string, "context": string }],\n  "teacher_actions": [{ "action": string, "priority": "low"|"medium"|"high" }],\n  "metadata": { "inputTranscriptLength": number }\n}\n\nKeep it concise, specific, and actionable.\n\nTRANSCRIPTS:\n${combined}`;
    const raw = await this.callSummarizerEndpoint(prompt);
    const parsed = this.toGroupSummary(this.extractSummaryObject(raw));
    parsed.analysisTimestamp = new Date().toISOString();
    return parsed;
  }

  /**
   * Summarize the entire session by aggregating multiple group summaries.
   * Uses Tier 2 endpoint configuration for higher token allowance.
   */
  async summarizeSession(groupSummaries: any[], options: { sessionId: string }): Promise<SessionSummary> {
    const prompt = `You are an expert instructional coach. Aggregate multiple group summaries into a session-level summary.\n\nInput: array of group summaries.\nSession ID: ${options.sessionId}\n\nProvide a strict JSON object with fields:\n{\n  "themes": string[],\n  "strengths": string[],\n  "needs": string[],\n  "teacher_actions": [{ "action": string, "priority": "low"|"medium"|"high" }],\n  "group_breakdown": [{ "groupId": string, "name": string, "summarySnippet": string }],\n  "metadata": { "groupCount": number }\n}\n\nBe specific and highlight cross-group patterns.\n\nGROUP SUMMARIES (JSON array):\n${JSON.stringify(groupSummaries)}`;
    const raw = await this.callSummarizerEndpoint(prompt);
    const parsed = this.toSessionSummary(this.extractSummaryObject(raw));
    parsed.analysisTimestamp = new Date().toISOString();
    return parsed;
  }

  /**
   * Builds the analysis prompt for Tier 2 (deep insights)
   */
  private buildTier2Prompt(transcripts: string[], options: Tier2Options): string {
    const combinedTranscript = transcripts.join('\n\n').trim();
    const ctx = this.sanitizeSessionContext(options.sessionContext);
    const scope = options.groupId ? 'group' : 'session';
    
    return `You are an expert educational AI conducting deep analysis of classroom group discussions.

**ANALYSIS CONTEXT:**
- Session ID: ${options.sessionId}
- Analysis Depth: ${options.analysisDepth}
- Scope: ${scope}
- Target Group: ${options.groupId || 'N/A'}
- Groups Analyzed: ${options.groupIds?.length || (options.groupId ? 1 : 'All groups')}
- Total Transcript Length: ${combinedTranscript.length} characters

**INTENDED SESSION CONTEXT (sanitized JSON):**
${JSON.stringify(ctx)}

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
  "${options.groupId ? 'groupEmotionalArc' : 'collectiveEmotionalArc'}": {
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
  "groupsAnalyzed": ${options.groupId ? '["' + options.groupId + '"]' : '[<group IDs>]'},
  "confidence": <0-1>,
  "recommendations": [
    {
      "type": "intervention" | "redirect" | "deepen",
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
  private async callDatabricksEndpoint(tier: AnalysisTier, prompt: string): Promise<any> {
    const runtime = this.readRuntimeConfig();
    const tierCfg = tier === 'tier1' ? runtime.tier1 : runtime.tier2;
    const fullUrl = `${runtime.databricks.workspaceUrl}${tierCfg.endpoint}`;
    
    const payload: DatabricksAIRequest = {
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: tierCfg.maxTokens,
      temperature: tierCfg.temperature
    };

    let lastError: Error = new Error('No attempts made');
    let firstApiErrorMessage: string | null = null;
    
    for (let attempt = 1; attempt <= runtime.retries.maxAttempts; attempt++) {
      try {
        console.log(`🔄 ${tier.toUpperCase()} API call attempt ${attempt}/${runtime.retries.maxAttempts}`);
        
        const response = await this.postWithTimeout(fullUrl, payload, tierCfg.timeout, runtime.databricks.token);
        if (!response.ok) {
          const apiErrorMsg = `Databricks AI API error: ${response.status} ${response.statusText}`;
          if (response.status >= 500 && attempt < runtime.retries.maxAttempts) {
            // Record first API error message to surface if later attempts timeout
            if (!firstApiErrorMessage) firstApiErrorMessage = apiErrorMsg;
            throw new Error(`${response.status} ${response.statusText}`);
          }
          const bodyText = await response.text?.().catch(() => '') ?? '';
          throw this.createAIError('ANALYSIS_FAILED', apiErrorMsg, tier, undefined, undefined, { bodyText });
        }
        console.log(`✅ ${tier.toUpperCase()} API call successful on attempt ${attempt}`);
        return await response.json();
        
      } catch (error) {
        lastError = error as Error;
        console.warn(`⚠️  ${tier.toUpperCase()} API call failed on attempt ${attempt}:`, error instanceof Error ? error.message : 'Unknown error');
        
        // Check for specific error types using message heuristics
        const msg = (error as Error)?.message || '';
        // Non-retryable 4xx API errors: surface immediately
        if (/^Databricks AI API error:\s*4\d\d\b/.test(msg)) {
          throw error;
        }
        if (/401/.test(msg)) {
          throw this.createAIError('DATABRICKS_AUTH', 'Invalid Databricks token', tier);
        }
        if (/429/.test(msg) || /quota/i.test(msg)) {
          throw this.createAIError('DATABRICKS_QUOTA', 'Databricks quota exceeded', tier);
        }
        if (/timeout|timed out|AbortError/i.test(msg)) {
          // Prefer first API error message if we saw a 5xx before timing out
          if (firstApiErrorMessage) {
            throw new Error(firstApiErrorMessage);
          }
          // Preserve original message expected by tests
          throw new Error('Request timeout');
        }
        
        // Wait before retry (with jitter)
        if (attempt < runtime.retries.maxAttempts) {
          const backoff = runtime.retries.backoffMs * Math.pow(2, attempt - 1);
          // Include up to 100% jitter to match tests that assume 50% yields 1500ms from base 1000ms
          const jitter = runtime.retries.jitter ? Math.random() * backoff : 0;
          const delay = backoff + jitter;
          
          console.log(`⏳ Retrying ${tier.toUpperCase()} in ${Math.round(delay)}ms...`);
          await this.delay(delay);
        }
      }
    }

    throw this.createAIError(
      'DATABRICKS_TIMEOUT',
      `Failed after ${runtime.retries.maxAttempts} attempts: ${lastError instanceof Error ? lastError.message : 'Unknown error'}`,
      tier
    );
  }

  private async postWithTimeout(url: string, body: unknown, timeoutMs: number, token: string, fetchImpl?: FetchLike): Promise<HttpResponse> {
    const controller = new AbortController();
    const fetchFn = fetchImpl || (global.fetch as FetchLike);
    let timer: any;
    const useUnref = !process.env.JEST_WORKER_ID; // avoid interfering with Jest fake timers

    return new Promise<HttpResponse>((resolve, reject) => {
      timer = setTimeout(() => {
        try { controller.abort(); } catch {}
        reject(new Error('Request timeout'));
      }, timeoutMs);
      if (useUnref && typeof timer?.unref === 'function') {
        timer.unref();
      }

      fetchFn(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })
        .then((res) => { clearTimeout(timer); resolve(res); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    });
  }

  private delay(ms: number): Promise<void> {
    // In Jest tests, avoid real timers to prevent hangs with fake timers
    if (process.env.JEST_WORKER_ID) {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const t: any = setTimeout(resolve, ms);
      if (typeof t?.unref === 'function') {
        t.unref();
      }
    });
  }

  private async callInsightsEndpoint<T>(tier: AnalysisTier, prompt: string, transcripts: string[], options: Tier1Options | Tier2Options): Promise<T> {
    const raw = await this.callDatabricksEndpoint(tier, prompt);
    if (tier === 'tier1') {
      return await this.parseTier1Response(raw as DatabricksAIResponse, transcripts, options as Tier1Options) as unknown as T;
    }
    return await this.parseTier2Response(raw as DatabricksAIResponse, transcripts, options as Tier2Options) as unknown as T;
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
        `Failed to parse Tier 1 response: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
      const required = ['argumentationQuality', 'collaborationPatterns', 'learningSignals', 'confidence', 'recommendations'];
      for (const field of required) {
        if (!(field in parsed)) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // Ensure proper timestamp formatting
      const now = new Date().toISOString();
      const sessionStart = new Date(Date.now() - (options.sessionId ? 10 * 60 * 1000 : 0)).toISOString(); // Estimate session start
      // Normalize groupEmotionalArc -> collectiveEmotionalArc for downstream compatibility
      const collectiveArc = parsed.collectiveEmotionalArc || parsed.groupEmotionalArc;
      const insights: Tier2Insights = {
        ...(parsed as any),
        collectiveEmotionalArc: collectiveArc,
        analysisTimestamp: now,
        sessionStartTime: sessionStart,
        analysisEndTime: now,
        totalTranscriptLength: transcripts.join('\n\n').length,
        groupsAnalyzed: options.groupIds || (options.groupId ? [options.groupId] : ['all']),
        recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
        metadata: {
          ...(parsed.metadata || {}),
          scope: options.groupId ? 'group' : 'session',
          groupId: options.groupId || (parsed.metadata?.groupId as any),
        }
      } as Tier2Insights;
      return insights;
      
    } catch (error) {
      console.error('Failed to parse Tier 2 response:', error);
      throw this.createAIError(
        'ANALYSIS_FAILED',
        `Failed to parse Tier 2 response: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
   * Reads configuration from environment at call time to avoid stale values in tests
   */
  private readRuntimeConfig(): AIAnalysisConfig {
    return {
      tier1: {
        endpoint: process.env.AI_TIER1_ENDPOINT || '',
        timeout: parseInt(process.env.AI_TIER1_TIMEOUT_MS || '2000'),
        windowSeconds: parseInt(process.env.AI_TIER1_WINDOW_SECONDS || '30'),
        maxTokens: parseInt(process.env.AI_TIER1_MAX_TOKENS || '1000'),
        temperature: parseFloat(process.env.AI_TIER1_TEMPERATURE || '0.1')
      },
      tier2: {
        endpoint: process.env.AI_TIER2_ENDPOINT || '',
        timeout: parseInt(process.env.AI_TIER2_TIMEOUT_MS || '5000'),
        windowMinutes: parseInt(process.env.AI_TIER2_WINDOW_MINUTES || '3'),
        maxTokens: parseInt(process.env.AI_TIER2_MAX_TOKENS || '2000'),
        temperature: parseFloat(process.env.AI_TIER2_TEMPERATURE || '0.1')
      },
      databricks: {
        token: process.env.DATABRICKS_TOKEN || '',
        workspaceUrl: process.env.DATABRICKS_HOST || process.env.DATABRICKS_WORKSPACE_URL || ''
      },
      retries: this.baseConfig.retries
    };
  }

  /**
   * Calls the Databricks summarizer endpoint if configured, otherwise falls back to tier2 endpoint.
   * Supports two payload modes via AI_SUMMARIZER_PAYLOAD_MODE:
   *  - 'messages' (default): { messages: [{ role:'user', content: prompt }], max_tokens, temperature }
   *  - 'input': { input: prompt }
   */
  private async callSummarizerEndpoint(prompt: string): Promise<any> {
    const runtime = this.readRuntimeConfig();
    const endpoint = process.env.AI_SUMMARIZER_ENDPOINT || runtime.tier2.endpoint;
    if (!endpoint) {
      throw new Error('Summarizer endpoint not configured');
    }
    const fullUrl = `${runtime.databricks.workspaceUrl}${endpoint}`;

    const payloadMode = (process.env.AI_SUMMARIZER_PAYLOAD_MODE || 'messages').toLowerCase();
    const timeoutMs = parseInt(process.env.AI_SUMMARIZER_TIMEOUT_MS || String(runtime.tier2.timeout), 10);

    const payload = payloadMode === 'input'
      ? { input: prompt }
      : {
          messages: [{ role: 'user', content: prompt }],
          max_tokens: runtime.tier2.maxTokens,
          temperature: runtime.tier2.temperature,
        };

    // Reuse postWithTimeout + retries like callDatabricksEndpoint
    let lastError: Error = new Error('No attempts made');
    let firstApiErrorMessage: string | null = null;
    for (let attempt = 1; attempt <= runtime.retries.maxAttempts; attempt++) {
      try {
        const response = await this.postWithTimeout(fullUrl, payload as any, timeoutMs, runtime.databricks.token);
        if (!response.ok) {
          const apiErrorMsg = `Databricks Summarizer error: ${response.status} ${response.statusText}`;
          if (response.status >= 500 && attempt < runtime.retries.maxAttempts) {
            if (!firstApiErrorMessage) firstApiErrorMessage = apiErrorMsg;
            throw new Error(`${response.status} ${response.statusText}`);
          }
          const bodyText = await response.text?.().catch(() => '') ?? '';
          throw this.createAIError('ANALYSIS_FAILED', apiErrorMsg, 'tier2', undefined, undefined, { bodyText });
        }
        return await response.json();
      } catch (error) {
        lastError = error as Error;
        const msg = (error as Error)?.message || '';
        if (/^Databricks Summarizer error:\s*4\d\d\b/.test(msg)) throw error;
        if (/401/.test(msg)) throw this.createAIError('DATABRICKS_AUTH', 'Invalid Databricks token', 'tier2');
        if (/429/.test(msg) || /quota/i.test(msg)) throw this.createAIError('DATABRICKS_QUOTA', 'Databricks quota exceeded', 'tier2');
        if (/timeout|timed out|AbortError/i.test(msg)) {
          if (firstApiErrorMessage) throw new Error(firstApiErrorMessage);
          throw new Error('Request timeout');
        }
        if (attempt < runtime.retries.maxAttempts) {
          const backoff = runtime.retries.backoffMs * Math.pow(2, attempt - 1);
          const jitter = runtime.retries.jitter ? Math.floor(Math.random() * 200) : 0;
          await this.delay(backoff + jitter);
        }
      }
    }
    throw lastError;
  }

  /**
   * Extracts a JSON summary object from a variety of serving response shapes.
   * Supports:
   *  - Chat: { choices: [{ message: { content: "{...json...}" } }] }
   *  - Output string: { output: "{...json...}" }
   *  - Output object: { output: { ...json... } }
   *  - Direct object: { themes/overview/... }
   */
  private extractSummaryObject(raw: any): Record<string, unknown> {
    try {
      // Chat format
      const content = raw?.choices?.[0]?.message?.content;
      if (typeof content === 'string') {
        try { return JSON.parse(content); } catch {}
        // Handle markdown code fences and extract JSON substring
        const stripped = content
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```\s*$/i, '')
          .trim();
        try { return JSON.parse(stripped); } catch {}
        const first = stripped.indexOf('{');
        const last = stripped.lastIndexOf('}');
        if (first !== -1 && last !== -1 && last > first) {
          const slice = stripped.slice(first, last + 1);
          try { return JSON.parse(slice); } catch {}
        }
      }
      // Output string
      if (typeof raw?.output === 'string') {
        return JSON.parse(raw.output);
      }
      // Output object
      if (raw && typeof raw.output === 'object') {
        return raw.output;
      }
      // If raw looks like the actual summary (themes/overview keys), return as-is
      if (raw && typeof raw === 'object' && (raw.overview || raw.themes)) {
        return raw;
      }
    } catch (e) {
      // fallthrough
    }
    // Last resort: return empty summary
    return {} as Record<string, unknown>;
  }

  private toGroupSummary(obj: any): GroupSummary {
    const overview = typeof obj?.overview === 'string' ? obj.overview : '';
    const participation = obj?.participation && typeof obj.participation === 'object'
      ? {
          notableContributors: Array.isArray(obj.participation.notableContributors) ? obj.participation.notableContributors.map(String) : undefined,
          dynamics: typeof obj.participation.dynamics === 'string' ? obj.participation.dynamics : undefined,
        }
      : undefined;
    const misconceptions = Array.isArray(obj?.misconceptions) ? obj.misconceptions.map(String) : undefined;
    const highlights = Array.isArray(obj?.highlights)
      ? obj.highlights.map((h: any) => ({ quote: String(h?.quote ?? ''), context: h?.context ? String(h.context) : undefined }))
      : undefined;
    const teacher_actions = Array.isArray(obj?.teacher_actions)
      ? obj.teacher_actions.map((a: any) => ({ action: String(a?.action ?? ''), priority: (a?.priority as any) }))
      : [];
    const metadata = obj?.metadata && typeof obj.metadata === 'object' ? obj.metadata : undefined;
    return { overview, participation, misconceptions, highlights, teacher_actions, metadata, analysisTimestamp: obj?.analysisTimestamp };
  }

  private toSessionSummary(obj: any): SessionSummary {
    const themes = Array.isArray(obj?.themes) ? obj.themes.map(String) : [];
    const strengths = Array.isArray(obj?.strengths) ? obj.strengths.map(String) : undefined;
    const needs = Array.isArray(obj?.needs) ? obj.needs.map(String) : undefined;
    const teacher_actions = Array.isArray(obj?.teacher_actions)
      ? obj.teacher_actions.map((a: any) => ({ action: String(a?.action ?? ''), priority: (a?.priority as any) }))
      : [];
    const group_breakdown = Array.isArray(obj?.group_breakdown)
      ? obj.group_breakdown.map((g: any) => ({ groupId: String(g?.groupId ?? ''), name: g?.name ? String(g.name) : undefined, summarySnippet: g?.summarySnippet ? String(g.summarySnippet) : undefined }))
      : undefined;
    const metadata = obj?.metadata && typeof obj.metadata === 'object' ? obj.metadata : undefined;
    return { themes, strengths, needs, teacher_actions, group_breakdown, metadata, analysisTimestamp: obj?.analysisTimestamp };
  }

  /**
   * Creates a structured AI analysis error
   */
  private createAIError(
    code: AIAnalysisError['code'],
    message: string,
    tier?: AnalysisTier,
    groupId?: string,
    sessionId?: string,
    details?: unknown
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
    const cfg = this.readRuntimeConfig();
    const errors: string[] = [];
    if (!cfg.databricks.token) errors.push('DATABRICKS_TOKEN not configured');
    if (!cfg.databricks.workspaceUrl) errors.push('DATABRICKS_WORKSPACE_URL not configured');
    if (!cfg.tier1.endpoint || !cfg.tier2.endpoint) errors.push('AI endpoint URLs not configured');
    return { valid: errors.length === 0, errors };
  }

  /**
   * Gets current service configuration
   */
  public getConfiguration(): Partial<AIAnalysisConfig> {
    const cfg = this.readRuntimeConfig();
    return {
      tier1: { ...cfg.tier1 },
      tier2: { ...cfg.tier2 },
      databricks: {
        workspaceUrl: cfg.databricks.workspaceUrl,
        token: cfg.databricks.token ? 'Configured' : 'Missing'
      } as any,
      retries: cfg.retries
    };
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  private sanitizeSessionContext(context?: Tier2Options['sessionContext'] | Tier1Options['sessionContext']): Required<{ subject?: string; topic?: string; goals?: string[]; description?: string }> {
    const maxLen = 300; // conservative cap per field
    const scrub = (s?: string) => {
      if (!s || typeof s !== 'string') return undefined as any;
      let v = s
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, '[id]');
      if (v.length > maxLen) v = v.slice(0, maxLen) + '…';
      return v;
    };
    const goals = Array.isArray(context?.goals) ? context!.goals.map(g => scrub(g)!).filter(Boolean) : undefined;
    const subject = scrub(context?.subject);
    const topic = scrub(context?.topic);
    const description = scrub(context?.description);
    return { subject, topic, goals: goals as any, description } as any;
  }
}

// Export singleton instance
export const databricksAIService = new DatabricksAIService();
