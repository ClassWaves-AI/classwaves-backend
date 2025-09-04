import { aiAnalysisBufferService } from './ai-analysis-buffer.service';
import { eventBusPort } from '../utils/event-bus.port.instance';
import { aiAnalysisPort } from '../utils/ai-analysis.port.instance';
import { guidanceSystemHealthService } from './guidance-system-health.service';
import * as client from 'prom-client';

/**
 * AI Analysis Trigger Service
 *
 * Extracted from legacy websocket.service.ts. Logic preserved, but all WS emissions
 * now flow through the namespaced Sessions namespace when firing insights.
 */
class AIAnalysisTriggerService {
  private readonly tier1TimeToInsight = (() => {
    try {
      return new client.Histogram({
        name: 'ai_tier1_time_to_insight_ms',
        help: 'Time from last transcript buffer to Tier1 insight emission',
        buckets: [200, 500, 1000, 2000, 5000, 10000, 20000],
        labelNames: ['school']
      });
    } catch {
      return client.register.getSingleMetric('ai_tier1_time_to_insight_ms') as client.Histogram<string>;
    }
  })();
  private readonly tier2TimeToInsight = (() => {
    try {
      return new client.Histogram({
        name: 'ai_tier2_time_to_insight_ms',
        help: 'Time from last transcript buffer to Tier2 insight emission',
        buckets: [500, 1000, 2000, 5000, 10000, 20000, 60000],
        labelNames: ['school']
      });
    } catch {
      return client.register.getSingleMetric('ai_tier2_time_to_insight_ms') as client.Histogram<string>;
    }
  })();
  private readonly tier1EmitCounter = (() => {
    try {
      return new client.Counter({ name: 'ai_tier1_insight_emits_total', help: 'Total Tier1 insight emits', labelNames: ['school'] });
    } catch {
      return client.register.getSingleMetric('ai_tier1_insight_emits_total') as client.Counter<string>;
    }
  })();
  private readonly tier2EmitCounter = (() => {
    try {
      return new client.Counter({ name: 'ai_tier2_insight_emits_total', help: 'Total Tier2 insight emits', labelNames: ['school'] });
    } catch {
      return client.register.getSingleMetric('ai_tier2_insight_emits_total') as client.Counter<string>;
    }
  })();

  // Prompt generation observability
  private readonly promptLatency = (() => {
    try {
      return new client.Histogram({
        name: 'guidance_prompt_generation_latency_ms',
        help: 'Latency for teacher prompt generation',
        buckets: [50, 100, 200, 500, 1000, 2000, 5000, 10000],
        labelNames: ['tier']
      });
    } catch {
      return client.register.getSingleMetric('guidance_prompt_generation_latency_ms') as client.Histogram<string>;
    }
  })();
  private readonly promptGenCounter = (() => {
    try {
      return new client.Counter({
        name: 'guidance_prompt_generation_total',
        help: 'Prompt generations by tier and status',
        labelNames: ['tier', 'status']
      });
    } catch {
      return client.register.getSingleMetric('guidance_prompt_generation_total') as client.Counter<string>;
    }
  })();
  /**
   * Check if AI analysis should be triggered and execute if ready
   */
  async checkAndTriggerAIAnalysis(groupId: string, sessionId: string, teacherId: string): Promise<void> {
    try {
      const tier1Transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', groupId, sessionId);
      const tier2Transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier2', groupId, sessionId);

      if (tier1Transcripts.length >= 3 && this.shouldTriggerTier1Analysis(tier1Transcripts)) {
        await this.triggerTier1Analysis(groupId, sessionId, teacherId, tier1Transcripts);
      }

      if (tier2Transcripts.length >= 8 && this.shouldTriggerTier2Analysis(tier2Transcripts)) {
        await this.triggerTier2Analysis(sessionId, teacherId, tier2Transcripts);
      }
    } catch (error) {
      console.error(`❌ AI analysis check failed for group ${groupId}:`, error);
    }
  }

  /**
   * Simple heuristics (preserved from legacy)
   */
  private shouldTriggerTier1Analysis(transcripts: string[]): boolean {
    const combinedLength = transcripts.join(' ').length;
    return combinedLength > 100;
  }

  private shouldTriggerTier2Analysis(transcripts: string[]): boolean {
    const combinedLength = transcripts.join(' ').length;
    return combinedLength > 500;
  }

  /**
   * Trigger Tier 1 analysis and broadcast insights via namespaced sessions service
   */
  public async triggerTier1Analysis(
    groupId: string,
    sessionId: string,
    teacherId: string,
    transcripts: string[]
  ): Promise<void> {
    const startTime = Date.now();
    try {
      console.log(`🧠 Triggering Tier 1 analysis for group ${groupId}`);
      const insights = await aiAnalysisPort.analyzeTier1(transcripts, {
        groupId,
        sessionId,
        focusAreas: ['topical_cohesion', 'conceptual_density'],
        windowSize: 30,
        includeMetadata: true,
      });

      // Emit via Sessions namespace unless GUIDANCE_CANONICAL=1
      // Session-level tier events removed (guidance namespace is canonical)

      // Also emit to guidance namespace for teacher UI subscribers
      try {
        const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
        getNamespacedWebSocketService()?.getGuidanceService().emitTier1Insight(sessionId, {
          groupId,
          sessionId,
          insights,
          timestamp: insights.analysisTimestamp,
        });
      } catch (e) {
        console.warn('Failed to emit Tier1 to guidance namespace:', e instanceof Error ? e.message : String(e));
      }

      // Persist insights idempotently (non-blocking)
      try {
        const { aiInsightsPersistenceService } = await import('./ai-insights-persistence.service');
        await aiInsightsPersistenceService.persistTier1(sessionId, groupId, insights).catch(() => undefined);
      } catch (_) {
        // swallow persistence issues; emission already happened
      }

      // Auto-generate teacher prompts and emit to guidance (controlled via GUIDANCE_AUTO_PROMPTS; default on)
      try {
        if (process.env.GUIDANCE_AUTO_PROMPTS === '0') {
          // feature flag off
        } else {
          const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
          // Only run when IDs look valid to satisfy strict Zod schemas
          if (isUuid(sessionId) && isUuid(groupId) && isUuid(teacherId)) {
            const { teacherPromptService } = await import('./teacher-prompt.service');
            const promptStart = Date.now();
            const prompts = await teacherPromptService.generatePrompts(insights, {
              sessionId,
              groupId,
              teacherId,
              sessionPhase: 'development',
              subject: 'general',
              learningObjectives: [],
              groupSize: 4,
              sessionDuration: 45,
            }).catch(() => []);
            const pLatency = Date.now() - promptStart;
            try { this.promptLatency.observe({ tier: 'tier1' }, pLatency); } catch {}
            try { this.promptGenCounter.inc({ tier: 'tier1', status: Array.isArray(prompts) && prompts.length > 0 ? 'ok' : 'empty' }); } catch {}
            try { guidanceSystemHealthService.recordSuccess('promptGeneration', 'autoprompt_tier1', pLatency); } catch {}
            if (Array.isArray(prompts) && prompts.length > 0) {
              const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
              getNamespacedWebSocketService()?.getGuidanceService().emitTeacherRecommendations(sessionId, prompts, { generatedAt: promptStart, tier: 'tier1' });
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try { this.promptGenCounter.inc({ tier: 'tier1', status: 'error' }); } catch {}
        try { guidanceSystemHealthService.recordFailure('promptGeneration', 'autoprompt_tier1', 0, msg); } catch {}
        console.warn('Auto-prompt generation (Tier1) failed:', msg);
      }

      await aiAnalysisBufferService.markBufferAnalyzed('tier1', groupId, sessionId);

      const duration = Date.now() - startTime;
      guidanceSystemHealthService.recordSuccess('aiAnalysis', 'tier1_analysis', duration);
      // Observability: time-to-insight since last transcript
      try {
        const lastTs = aiAnalysisBufferService.getLastBufferedAt('tier1', sessionId, groupId);
        let school = 'unknown';
        try {
          const row = await (await import('./databricks.service')).databricksService.queryOne(
            `SELECT school_id FROM classwaves.sessions.classroom_sessions WHERE id = ?`,
            [sessionId]
          );
          school = (row as any)?.school_id || 'unknown';
        } catch {}
        try { this.tier1EmitCounter.inc({ school }); } catch {}
        if (lastTs) this.tier1TimeToInsight.observe({ school }, Date.now() - lastTs.getTime());
      } catch {}
      console.log(`✅ Tier 1 analysis completed and broadcasted for group ${groupId}`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Tier 1 analysis failed for group ${groupId}:`, error);
      guidanceSystemHealthService.recordFailure('aiAnalysis', 'tier1_analysis', duration, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Trigger Tier 2 analysis and broadcast insights via namespaced sessions service
   */
  public async triggerTier2Analysis(
    sessionId: string,
    teacherId: string,
    transcripts: string[]
  ): Promise<void> {
    const startTime = Date.now();
    try {
      console.log(`🧠 Triggering Tier 2 analysis for session ${sessionId}`);
      const insights = await aiAnalysisPort.analyzeTier2(transcripts, {
        sessionId,
        groupIds: [],
        analysisDepth: 'standard',
        includeMetadata: true,
      });

      // Session-level tier events removed (guidance namespace is canonical)

      // Also emit to guidance namespace
      try {
        const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
        getNamespacedWebSocketService()?.getGuidanceService().emitTier2Insight(sessionId, {
          sessionId,
          insights,
          timestamp: insights.analysisTimestamp,
        });
      } catch (e) {
        console.warn('Failed to emit Tier2 to guidance namespace:', e instanceof Error ? e.message : String(e));
      }

      // Persist insights idempotently (non-blocking)
      try {
        const { aiInsightsPersistenceService } = await import('./ai-insights-persistence.service');
        await aiInsightsPersistenceService.persistTier2(sessionId, insights).catch(() => undefined);
      } catch (_) {
        // swallow persistence issues; emission already happened
      }

      // Auto-generate teacher prompts at session level (best-effort; flag-controlled)
      try {
        if (process.env.GUIDANCE_AUTO_PROMPTS === '0') {
          // feature flag off
        } else {
          const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
          if (isUuid(sessionId) && isUuid(teacherId)) {
            let anyGroupId: string | null = null;
            try {
              const row = await (await import('./databricks.service')).databricksService.queryOne(
                `SELECT id FROM classwaves.sessions.student_groups WHERE session_id = ? LIMIT 1`,
                [sessionId]
              );
              anyGroupId = (row as any)?.id || null;
            } catch {}

            if (anyGroupId && isUuid(anyGroupId)) {
              const { teacherPromptService } = await import('./teacher-prompt.service');
              const promptStart = Date.now();
              const prompts = await teacherPromptService.generatePrompts(insights, {
                sessionId,
                groupId: anyGroupId,
                teacherId,
                sessionPhase: 'development',
                subject: 'general',
                learningObjectives: [],
                groupSize: 4,
                sessionDuration: 45,
              }).catch(() => []);
              const pLatency = Date.now() - promptStart;
              try { this.promptLatency.observe({ tier: 'tier2' }, pLatency); } catch {}
              try { this.promptGenCounter.inc({ tier: 'tier2', status: Array.isArray(prompts) && prompts.length > 0 ? 'ok' : 'empty' }); } catch {}
              try { guidanceSystemHealthService.recordSuccess('promptGeneration', 'autoprompt_tier2', pLatency); } catch {}
              if (Array.isArray(prompts) && prompts.length > 0) {
                const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
                getNamespacedWebSocketService()?.getGuidanceService().emitTeacherRecommendations(sessionId, prompts, { generatedAt: promptStart, tier: 'tier2' });
              }
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try { this.promptGenCounter.inc({ tier: 'tier2', status: 'error' }); } catch {}
        try { guidanceSystemHealthService.recordFailure('promptGeneration', 'autoprompt_tier2', 0, msg); } catch {}
        console.warn('Auto-prompt generation (Tier2) failed:', msg);
      }

      await aiAnalysisBufferService.markBufferAnalyzed('tier2', '', sessionId).catch(() => undefined);

      const duration = Date.now() - startTime;
      guidanceSystemHealthService.recordSuccess('aiAnalysis', 'tier2_analysis', duration);
      // Observability: time-to-insight since last transcript (across session)
      try {
        const lastTs = aiAnalysisBufferService.getLastBufferedAt('tier2', sessionId);
        let school = 'unknown';
        try {
          const row = await (await import('./databricks.service')).databricksService.queryOne(
            `SELECT school_id FROM classwaves.sessions.classroom_sessions WHERE id = ?`,
            [sessionId]
          );
          school = (row as any)?.school_id || 'unknown';
        } catch {}
        try { this.tier2EmitCounter.inc({ school }); } catch {}
        if (lastTs) this.tier2TimeToInsight.observe({ school }, Date.now() - lastTs.getTime());
      } catch {}
      console.log(`✅ Tier 2 analysis completed and broadcasted for session ${sessionId}`);
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ Tier 2 analysis failed for session ${sessionId}:`, error);
      guidanceSystemHealthService.recordFailure('aiAnalysis', 'tier2_analysis', duration, error instanceof Error ? error.message : 'Unknown error');
    }
  }

}

export const aiAnalysisTriggerService = new AIAnalysisTriggerService();
