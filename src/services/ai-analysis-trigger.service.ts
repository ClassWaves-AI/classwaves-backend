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
  // Track first Tier1 analysis per sessionId:groupId to apply an extended window
  private firstTier1Completed: Set<string> = new Set();
  // Track last on-track state per sessionId:groupId to support optional return threshold
  private lastOnTrackState: Map<string, boolean> = new Map();
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
  // New counters for gating observability
  private readonly tier1SuppressedOnTrack = (() => {
    try {
      return new client.Counter({ name: 'guidance_tier1_suppressed_ontrack_total', help: 'Tier1 emits/prompts suppressed due to on-track gating' });
    } catch {
      return client.register.getSingleMetric('guidance_tier1_suppressed_ontrack_total') as client.Counter<string>;
    }
  })();
  private readonly tier1SuppressedWarmup = (() => {
    try {
      return new client.Counter({ name: 'guidance_tier1_suppressed_warmup_total', help: 'Tier1 analysis suppressed during warm-up window' });
    } catch {
      return client.register.getSingleMetric('guidance_tier1_suppressed_warmup_total') as client.Counter<string>;
    }
  })();
  private readonly guidanceAnalyticsEmits = (() => {
    try {
      return new client.Counter({ name: 'guidance_analytics_emits_total', help: 'Total guidance analytics emits' });
    } catch {
      return client.register.getSingleMetric('guidance_analytics_emits_total') as client.Counter<string>;
    }
  })();
  /**
   * Check if AI analysis should be triggered and execute if ready
   */
  async checkAndTriggerAIAnalysis(groupId: string, sessionId: string, teacherId: string): Promise<void> {
    try {
      const tier1Transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', groupId, sessionId);
      const tier2Transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier2', groupId, sessionId);

      // Warm-up suppression for Tier1 (recording + buffering continue)
      let withinWarmup = false;
      try {
        const warmupMs = parseInt(process.env.GUIDANCE_TIER1_WARMUP_MS || '60000', 10);
        if (warmupMs > 0) {
          const { getCompositionRoot } = await import('../app/composition-root');
          const repo = getCompositionRoot().getSessionRepository();
          const basic = await repo.getBasic(sessionId);
          const startedAt: Date | string | undefined = (basic as any)?.started_at || (basic as any)?.startedAt;
          if (startedAt) {
            const started = startedAt instanceof Date ? startedAt.getTime() : new Date(startedAt).getTime();
            if (!Number.isNaN(started)) {
              withinWarmup = Date.now() - started < warmupMs;
            }
          }
        }
      } catch {
        // If unable to determine warm-up, treat as not within warm-up to avoid blocking
        withinWarmup = false;
      }

      const eligibleForTier1 = tier1Transcripts.length >= 3 && this.shouldTriggerTier1Analysis(tier1Transcripts);
      if (withinWarmup && eligibleForTier1) {
        try { this.tier1SuppressedWarmup.inc(); } catch {}
      }
      if (!withinWarmup && eligibleForTier1) {
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
      // Apply extended window on first Tier1 analysis per session:group if configured
      const firstWindowSec = parseInt(process.env.GUIDANCE_TIER1_FIRST_WINDOW_SECONDS || '60', 10);
      const firstKey = `${sessionId}:${groupId}`;
      const isFirstTier1 = !this.firstTier1Completed.has(firstKey) && firstWindowSec > 0;
      const windowSize = isFirstTier1 ? firstWindowSec : 30;

      const insights = await aiAnalysisPort.analyzeTier1(transcripts, {
        groupId,
        sessionId,
        focusAreas: ['topical_cohesion', 'conceptual_density'],
        windowSize,
        includeMetadata: true,
      });

      if (isFirstTier1) {
        this.firstTier1Completed.add(firstKey);
      }

      // Tier1 gating: suppress on-track emits/prompts (env-controlled) and emit lightweight analytics instead
      const suppressOnTrack = process.env.GUIDANCE_TIER1_SUPPRESS_ONTRACK === '1';
      const threshold = Number.isFinite(Number(process.env.GUIDANCE_TIER1_ONTRACK_THRESHOLD))
        ? parseFloat(process.env.GUIDANCE_TIER1_ONTRACK_THRESHOLD as string)
        : 0.5;
      const returnThreshold = process.env.GUIDANCE_TIER1_RETURN_THRESHOLD ? parseFloat(process.env.GUIDANCE_TIER1_RETURN_THRESHOLD) : undefined;
      const confMin = Number.isFinite(Number(process.env.GUIDANCE_TIER1_CONF_MIN))
        ? parseFloat(process.env.GUIDANCE_TIER1_CONF_MIN as string)
        : 0.5;

      const tc = (insights as any)?.topicalCohesion;
      const cd = (insights as any)?.conceptualDensity;
      const conf = (insights as any)?.confidence;

      // Only consider gating when metrics are present and confidence meets minimum
      const hasMetrics = typeof tc === 'number' && typeof cd === 'number';
      const meetsConfidence = typeof conf === 'number' ? conf >= confMin : true; // if missing, don't block
      let onTrack = false;
      if (hasMetrics) {
        onTrack = tc >= threshold && cd >= threshold;
        // Optional return threshold (reduce flicker returning to on-track)
        if (onTrack && typeof returnThreshold === 'number') {
          const last = this.lastOnTrackState.get(firstKey);
          if (last === false) {
            onTrack = tc >= returnThreshold && cd >= returnThreshold;
          }
        }
      }

      if (meetsConfidence) {
        this.lastOnTrackState.set(firstKey, onTrack);
      }

      const shouldSuppress = suppressOnTrack && onTrack && meetsConfidence;

      if (!shouldSuppress) {
        // Emit to guidance namespace for teacher UI subscribers
        try {
          const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
          getNamespacedWebSocketService()?.getGuidanceService().emitTier1Insight(sessionId, {
            groupId,
            sessionId,
            insights,
            timestamp: (insights as any)?.analysisTimestamp,
          });
        } catch (e) {
          console.warn('Failed to emit Tier1 to guidance namespace:', e instanceof Error ? e.message : String(e));
        }
      }
      else {
        try { this.tier1SuppressedOnTrack.inc(); } catch {}
      }

      // Persist insights idempotently (non-blocking)
      try {
        const { aiInsightsPersistenceService } = await import('./ai-insights-persistence.service');
        await aiInsightsPersistenceService.persistTier1(sessionId, groupId, insights).catch(() => undefined);
      } catch (_) {
        // swallow persistence issues; emission already happened
      }

      // Auto-generate teacher prompts and emit to guidance (controlled via GUIDANCE_AUTO_PROMPTS; default on)
      // Suppress when on-track gating is in effect
      try {
        if (!shouldSuppress) {
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
        } else {
          try { this.promptGenCounter.inc({ tier: 'tier1', status: 'suppressed' }); } catch {}
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try { this.promptGenCounter.inc({ tier: 'tier1', status: 'error' }); } catch {}
        try { guidanceSystemHealthService.recordFailure('promptGeneration', 'autoprompt_tier1', 0, msg); } catch {}
        console.warn('Auto-prompt generation (Tier1) failed:', msg);
      }

      // Emit lightweight analytics when on-track is suppressed (power the on-track bar)
      if (shouldSuppress && hasMetrics) {
        try {
          const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
          const onTrackScore = Math.min(tc, cd);
          getNamespacedWebSocketService()?.getGuidanceService().emitGuidanceAnalytics(sessionId, {
            groupId,
            topicalCohesion: tc,
            conceptualDensity: cd,
            onTrackScore,
            timestamp: (insights as any)?.analysisTimestamp,
          });
          try { this.guidanceAnalyticsEmits.inc(); } catch {}
        } catch (e) {
          console.warn('Failed to emit guidance analytics:', e instanceof Error ? e.message : String(e));
        }
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
      const tier2Passive = process.env.GUIDANCE_TIER2_PASSIVE === '1';
      if (!tier2Passive) {
        // Emit to guidance namespace
        try {
          const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
          getNamespacedWebSocketService()?.getGuidanceService().emitTier2Insight(sessionId, {
            sessionId,
            insights,
            timestamp: (insights as any)?.analysisTimestamp,
          });
        } catch (e) {
          console.warn('Failed to emit Tier2 to guidance namespace:', e instanceof Error ? e.message : String(e));
        }
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
        const tier2Passive = process.env.GUIDANCE_TIER2_PASSIVE === '1';
        if (process.env.GUIDANCE_AUTO_PROMPTS === '0' || tier2Passive) {
          // feature flag off or passive Tier2 (suppressed)
          if (tier2Passive) {
            try { this.promptGenCounter.inc({ tier: 'tier2', status: 'suppressed' }); } catch {}
          }
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
