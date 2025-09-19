import { aiAnalysisBufferService } from './ai-analysis-buffer.service';
import { aiAnalysisPort } from '../utils/ai-analysis.port.instance';
import { guidanceSystemHealthService } from './guidance-system-health.service';
import * as client from 'prom-client';
import { redisService } from './redis.service';
import {
  getGuidanceOnTrackSummaryEmittedCounter,
  getGuidanceOnTrackSummarySuppressedCounter,
  getGuidanceRedisUnavailableCounter,
  getGuidanceContextParaphraseCounter,
  getGuidanceContextSummaryLengthHistogram,
  getGuidanceContextQualityHistogram,
} from '../metrics/guidance.metrics';

type GuidanceRedisComponent = 'attention_gate' | 'autoprompt' | 'prompt_timing' | 'ontrack_summary';
import type { SubjectArea } from '../types/teacher-guidance.types';
import type {
  Tier1Insights,
  Tier2Insights,
  PromptContextDescriptor,
  PromptContextQuote,
  EvidenceWindows,
  GuidanceDriftSignal,
} from '../types/ai-analysis.types';
import type { WsGuidanceAnalyticsEvent } from '@classwaves/shared';
import { logger } from '../utils/logger';

type PromptContextPayload = PromptContextDescriptor;

const PARAPHRASE_TOKEN_SPAN = 6;
const BASE_STOP_WORDS = new Set([
  'a','an','and','are','as','at','be','but','by','for','from','have','in','into','is','it','its','of','on','or','that','the','their','they','this','to','was','were','with','we','you','i','me','my','our','ours','your','yours','his','her','hers','him','he','she','them','those','these','there','here','about','so','just','like','really','very','get','got','gonna','going','back','up','down','over','out','maybe','kinda','sorta','still','then','than'
]);

const QUOTE_CHARS_REGEX = /["'“”‘’]/g;

// Normalize arbitrary session subject strings to the limited SubjectArea union used by
// the Teacher Prompt service. Defaults to 'general' when unknown.
function toSubjectArea(input?: string): SubjectArea {
  if (!input) return 'general';
  const s = String(input).trim().toLowerCase();
  // Exact matches first
  if (s === 'math') return 'math';
  if (s === 'science') return 'science';
  if (s === 'literature') return 'literature';
  if (s === 'history') return 'history';
  if (s === 'general') return 'general';
  // Common aliases
  if (s === 'mathematics' || s === 'algebra' || s === 'geometry' || s === 'calculus') return 'math';
  if (s === 'english' || s === 'ela' || s === 'language arts') return 'literature';
  if (s === 'physics' || s === 'chemistry' || s === 'biology' || s === 'earth science') return 'science';
  if (s === 'social studies' || s === 'civics' || s === 'world history' || s === 'us history') return 'history';
  return 'general';
}

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
  // Maintain EMA state for discussion momentum calculations
  private discussionMomentumState: Map<string, { ema: number; count: number }> = new Map();
  private readonly contextSettings = this.initializeContextSettings();
  private readonly keywordStopWords = this.buildKeywordStopwords();
  private readonly contextQualityHistogram = getGuidanceContextQualityHistogram();
  private readonly onTrackSummaryLimit = Math.max(60, Math.min(240, parseInt(process.env.AI_ONTRACK_SUMMARY_MAX_CHARS || '160', 10)));
  private readonly onTrackSummaryState = new Map<string, { summary: string; timestamp: number }>();
  private readonly onTrackSummaryEmitted = getGuidanceOnTrackSummaryEmittedCounter();
  private readonly onTrackSummarySuppressed = getGuidanceOnTrackSummarySuppressedCounter();
  private readonly contextParaphraseCounter = getGuidanceContextParaphraseCounter();
  private readonly contextSummaryLength = getGuidanceContextSummaryLengthHistogram();
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
  private readonly guidanceRedisUnavailable = getGuidanceRedisUnavailableCounter();

  private initializeContextSettings() {
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const parseIntEnv = (raw: string | undefined, fallback: number) => {
      const parsed = parseInt(raw ?? '', 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    const parseFloatEnv = (raw: string | undefined, fallback: number) => {
      const parsed = parseFloat(raw ?? '');
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    const legacyMaxChars = clamp(parseIntEnv(process.env.AI_GUIDANCE_CONTEXT_MAX_CHARS, 1200), 200, 1600);
    const summaryMaxChars = clamp(parseIntEnv(process.env.AI_GUIDANCE_CONTEXT_SUMMARY_MAX_CHARS, 140), 100, Math.min(280, legacyMaxChars));
    const summaryMinRequested = clamp(parseIntEnv(process.env.AI_GUIDANCE_SUMMARY_MIN_CHARS, 80), 60, summaryMaxChars);
    const summaryMinChars = Math.min(summaryMinRequested, summaryMaxChars - 10 >= 60 ? summaryMaxChars - 10 : summaryMinRequested);
    const topicMaxChars = clamp(parseIntEnv(process.env.AI_GUIDANCE_TOPIC_MAX_CHARS, 48), 24, 96);
    const supportingLinesMax = clamp(parseIntEnv(process.env.AI_GUIDANCE_SUPPORTING_LINES_MAX, 3), 1, 5);
    const supportingLineCharLimit = clamp(parseIntEnv(process.env.AI_GUIDANCE_SUPPORTING_LINE_MAX_CHARS, 80), 48, Math.min(160, legacyMaxChars));
    const transitionMaxChars = Math.min(legacyMaxChars, Math.max(summaryMaxChars, 220));

    const topicStopwords = this.parseTopicStopwords(process.env.AI_GUIDANCE_TOPIC_STOPWORDS);
    const titlecasePatterns = this.parseTitlecaseTerms(process.env.AI_GUIDANCE_TITLECASE_TERMS);
    const domainTerms = this.parseDomainTerms(process.env.AI_GUIDANCE_DOMAIN_TERMS);
    const domainTermSet = new Set(domainTerms.map((term) => term.toLowerCase()));

    const alignedWeightRaw = Math.max(0, parseFloatEnv(process.env.AI_GUIDANCE_ALIGNED_WEIGHT, 0.7));
    const currentWeightRaw = Math.max(0, parseFloatEnv(process.env.AI_GUIDANCE_CURRENT_WEIGHT, 0.3));
    const weightSum = alignedWeightRaw + currentWeightRaw;
    const alignedWeight = weightSum > 0 ? alignedWeightRaw / weightSum : 0.7;
    const currentWeight = weightSum > 0 ? currentWeightRaw / weightSum : 0.3;

    const windowMaxAgeMs = clamp(parseIntEnv(process.env.AI_GUIDANCE_WINDOW_MAX_AGE_MS, 180000), 60000, 600000);

    return {
      summaryMaxChars,
      summaryMinChars,
      topicMaxChars,
      transitionMaxChars,
      supportingLinesMax,
      supportingLineCharLimit,
      legacyMaxChars,
      redactExactQuotes: process.env.GUIDANCE_CONTEXT_REDACT_EXACT_QUOTES !== '0',
      topicStopwords,
      titlecasePatterns,
      domainTerms,
      domainTermSet,
      alignedWeight,
      currentWeight,
      windowMaxAgeMs,
    } as const;
  }

  private buildKeywordStopwords(): Set<string> {
    const combined = new Set<string>(BASE_STOP_WORDS);
    for (const word of this.contextSettings.topicStopwords) {
      combined.add(word);
    }
    return combined;
  }

  private parseTopicStopwords(raw: string | undefined): Set<string> {
    const result = new Set<string>();
    if (!raw) {
      return result;
    }
    raw
      .split(/[;,]/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean)
      .forEach((token) => result.add(token));
    return result;
  }

  private parseTitlecaseTerms(raw: string | undefined): Array<{ regex: RegExp; replacement: string }> {
    if (!raw) {
      return [];
    }
    return raw
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [term, replacement] = entry.split('=').map((part) => part.trim());
        if (!term || !replacement) {
          return null;
        }
        const escaped = this.escapeRegExp(term.toLowerCase());
        return { regex: new RegExp(`\\b${escaped}\\b`, 'gi'), replacement };
      })
      .filter((item): item is { regex: RegExp; replacement: string } => Boolean(item));
  }

  private parseDomainTerms(raw: string | undefined): string[] {
    if (!raw) {
      return [];
    }
    return raw
      .split(/[,;]/)
      .map((term) => term.trim())
      .filter(Boolean);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private applyDomainNormalization(value: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return value;
    }
    let normalized = value;
    for (const { regex, replacement } of this.contextSettings.titlecasePatterns) {
      normalized = normalized.replace(regex, replacement);
    }
    return normalized.replace(/\s+/g, ' ').trim();
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  private logistic(z: number): number {
    if (!Number.isFinite(z)) return 0.5;
    const clipped = Math.max(-10, Math.min(10, z));
    return 1 / (1 + Math.exp(-clipped));
  }

  private computeLexicalDiversity(transcripts: string[]): number {
    const combined = transcripts.join(' ').trim();
    if (!combined) return 0;
    const tokens = combined
      .toLowerCase()
      .split(/\s+/)
      .map((token) => token.replace(/[^-a-z0-9']/gi, ''))
      .filter((token) => token.length > 0);
    if (tokens.length === 0) {
      return 0;
    }
    const unique = new Set(tokens).size;
    return this.clamp01(unique / tokens.length);
  }

  private async computePromptPressure(
    sessionId: string,
    groupId: string,
    referenceTimestampMs: number,
    component: GuidanceRedisComponent = 'autoprompt'
  ): Promise<number> {
    try {
      const client = redisService.getClient();
      const key = `guidance:prompt:acks:${sessionId}:${groupId}`;
      const hash = await client.hgetall(key);
      const ackCountRaw = hash?.ackCount;
      const lastAckRaw = hash?.lastAckTimestamp;
      const ackCount = Number(ackCountRaw);
      if (!Number.isFinite(ackCount) || ackCount <= 0) {
        return 1;
      }
      const halfLifeMs = parseInt(process.env.GUIDANCE_ATTN_HALF_LIFE_MS || '300000', 10);
      if (!Number.isFinite(halfLifeMs) || halfLifeMs <= 0) {
        return this.clamp01(1 - ackCount / 5);
      }
      const lastAckTimestamp = Number(lastAckRaw);
      const delta = Number.isFinite(lastAckTimestamp) && lastAckTimestamp > 0 ? Math.max(0, referenceTimestampMs - lastAckTimestamp) : 0;
      const decay = Math.pow(0.5, halfLifeMs > 0 ? delta / halfLifeMs : 0);
      const decayedSuccess = ackCount * decay;
      return this.clamp01(1 - decayedSuccess / 5);
    } catch (error) {
      try { this.guidanceRedisUnavailable.inc({ component }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
      if (process.env.API_DEBUG === '1') {
        logger.warn('Prompt pressure fallback (Redis unavailable)', error instanceof Error ? error.message : error);
      }
      return 1;
    }
  }

  private resolveAttentionWeights(): { offTopic: number; confusion: number; momentum: number } {
    const defaults = { offTopic: 0.45, confusion: 0.35, momentum: 0.2 };
    const off = Number(process.env.GUIDANCE_ATTN_W_OFFTOPIC);
    const conf = Number(process.env.GUIDANCE_ATTN_W_CONFUSION);
    const momentum = Number(process.env.GUIDANCE_ATTN_W_MOMENTUM);
    const weights = {
      offTopic: Number.isFinite(off) && off >= 0 ? off : defaults.offTopic,
      confusion: Number.isFinite(conf) && conf >= 0 ? conf : defaults.confusion,
      momentum: Number.isFinite(momentum) && momentum >= 0 ? momentum : defaults.momentum,
    };
    const sum = weights.offTopic + weights.confusion + weights.momentum;
    if (!Number.isFinite(sum) || sum <= 0 || sum > 1) {
      return defaults;
    }
    return weights;
  }

  private async buildPromptContext(
    evidence: EvidenceWindows,
    confidence: number | undefined,
    providerContext: PromptContextDescriptor | undefined,
    sessionContext?: { subject?: string; topic?: string; goals?: string[]; description?: string },
    metrics?: {
      topicalCohesion?: number;
      conceptualDensity?: number;
      offTopicHeat?: number;
      discussionMomentum?: number;
      confusionRisk?: number;
    }
  ): Promise<{ context?: PromptContextPayload }> {
    if (process.env.GUIDANCE_CONTEXT_ENRICHMENT !== '1') {
      return {};
    }

    try {
      const boundedEvidence = this.pruneEvidenceByAge(evidence);
      const sources = this.gatherSourceTexts(boundedEvidence);
      if (sources.length === 0) {
        this.recordContextMetrics('heuristic', 'skipped');
        return {};
      }

      const spanIndex = this.contextSettings.redactExactQuotes
        ? this.buildTokenSpanIndex(sources, PARAPHRASE_TOKEN_SPAN)
        : new Set<string>();

      const sessionGoal = this.resolveSessionGoal(sessionContext);
      const driftSignals = this.composeDriftSignals(metrics, sessionGoal);

      let path: 'llm' | 'heuristic' = 'llm';
      let result: 'success' | 'fallback' | 'skipped' = 'skipped';
      let quality = 0;
      let payload: PromptContextPayload | undefined;

      const llmDisabled = process.env.GUIDANCE_CONTEXT_USE_LLM_SUMMARIZER === '0';

      if (!llmDisabled) {
        try {
          const llm = await this.buildLlmContextSummary({
            evidence: boundedEvidence,
            sessionGoal,
            spanIndex,
            driftSignals,
            confidence,
          });
          payload = llm.payload;
          quality = typeof llm.quality === 'number' ? llm.quality : this.evaluateContextQuality(payload, sessionGoal);
          result = 'success';
        } catch (error) {
          if (process.env.API_DEBUG === '1') {
            logger.warn('LLM guidance summarizer fallback', error instanceof Error ? error.message : error);
          }
          result = 'fallback';
        }
      } else {
        path = 'heuristic';
        result = 'skipped';
      }

      if (!payload) {
        const heuristic = this.buildHeuristicContext(boundedEvidence, confidence, sessionGoal);
        if (heuristic) {
          payload = heuristic.payload;
          quality = heuristic.quality;
          if (llmDisabled) {
            path = 'heuristic';
            result = 'success';
          } else if (result !== 'success') {
            result = 'fallback';
          }
        }
      }

      if (!payload && providerContext) {
        const provider = this.transformProviderContext(providerContext, confidence, spanIndex, sessionGoal);
        if (provider) {
          payload = provider;
          quality = this.evaluateContextQuality(provider, sessionGoal);
          if (llmDisabled) {
            path = 'heuristic';
            result = 'success';
          } else if (result !== 'success') {
            result = 'fallback';
          }
        }
      }

      if (!payload) {
        this.recordContextMetrics(path, 'skipped');
        return {};
      }

      const normalized = this.normalizeFinalPayload(payload);
      this.recordContextMetrics(path, result, normalized.contextSummary ?? normalized.reason, quality);
      return { context: normalized };
    } catch (error) {
      if (process.env.API_DEBUG === '1') {
        logger.warn('Prompt context enrichment failed', error instanceof Error ? error.message : error);
      }
      this.recordContextMetrics('heuristic', 'skipped');
      return {};
    }
  }

  private recordContextMetrics(
    path: 'heuristic' | 'llm',
    result: 'success' | 'fallback' | 'skipped',
    summary?: string,
    quality?: number
  ): void {
    try {
      this.contextParaphraseCounter.inc({ path, result });
      if (summary && (result === 'success' || result === 'fallback')) {
        this.contextSummaryLength.observe(summary.length);
      }
      if (typeof quality === 'number' && quality >= 0) {
        this.contextQualityHistogram.observe(quality);
      }
    } catch {
      // Metrics are best-effort; ignore register conflicts in test environments.
    }
  }

  private gatherSourceTexts(evidence: EvidenceWindows): string[] {
    return [...evidence.tangent, ...evidence.aligned]
      .map((line) => line.text)
      .filter((text): text is string => typeof text === 'string' && text.trim().length > 0);
  }

  private normalizeFinalPayload(payload: PromptContextPayload): PromptContextPayload {
    const normalized: PromptContextPayload = { ...payload };

    const normalize = (value?: string) => (value ? this.applyDomainNormalization(value) : value);

    if (normalized.actionLine) {
      normalized.actionLine = normalize(normalized.actionLine);
    }
    if (normalized.reason) {
      normalized.reason = normalize(normalized.reason);
    }
    if (normalized.priorTopic) {
      normalized.priorTopic = normalize(normalized.priorTopic);
    }
    if (normalized.currentTopic) {
      normalized.currentTopic = normalize(normalized.currentTopic);
    }
    if (normalized.transitionIdea) {
      normalized.transitionIdea = normalize(normalized.transitionIdea);
    }
    if (normalized.contextSummary) {
      normalized.contextSummary = normalize(normalized.contextSummary);
    }

    if (Array.isArray(normalized.supportingLines)) {
      normalized.supportingLines = normalized.supportingLines.map((line) => ({
        speaker: line.speaker ?? '',
        quote: normalize(line.quote) ?? normalize(line.text) ?? '',
        timestamp: this.normalizeTimestampToString(line.timestamp),
      }));
    }

    if (Array.isArray(normalized.quotes)) {
      normalized.quotes = normalized.quotes.map((line) => ({
        speakerLabel: (line.speakerLabel ?? '').trim(),
        text: normalize(line.text) ?? '',
        timestamp: this.normalizeTimestampToString(line.timestamp),
      }));
    }

    if (normalized.contextSummary && (!normalized.supportingLines || normalized.supportingLines.length === 0)) {
      const timestamp = new Date().toISOString();
      normalized.supportingLines = [{ speaker: '', quote: normalized.contextSummary, timestamp }];
    }

    if (normalized.contextSummary && (!normalized.quotes || normalized.quotes.length === 0)) {
      const timestamp = normalized.supportingLines?.[0]?.timestamp ?? new Date().toISOString();
      normalized.quotes = [{ speakerLabel: '', text: normalized.contextSummary, timestamp }];
    }

    return normalized;
  }

  private composeDriftSignals(
    metrics: {
      topicalCohesion?: number;
      conceptualDensity?: number;
      offTopicHeat?: number;
      discussionMomentum?: number;
      confusionRisk?: number;
    } | undefined,
    sessionGoal?: string
  ): GuidanceDriftSignal[] {
    const signals: GuidanceDriftSignal[] = [];
    const clamp = (value: number) => this.clamp01(value);
    const toPercent = (value: number) => `${Math.round(clamp(value) * 100)}%`;

    if (typeof metrics?.topicalCohesion === 'number') {
      const detail = `${toPercent(metrics.topicalCohesion)} on-topic`;
      const trend = metrics.topicalCohesion >= 0.6 ? 'steady' : metrics.topicalCohesion >= 0.4 ? 'wobbling' : 'drifting';
      signals.push({ metric: 'topicalCohesion', detail, trend });
    }

    if (typeof metrics?.conceptualDensity === 'number') {
      const detail = `${toPercent(metrics.conceptualDensity)} concept depth`;
      const trend = metrics.conceptualDensity >= 0.6 ? 'solid' : metrics.conceptualDensity >= 0.45 ? 'light' : 'shallow';
      signals.push({ metric: 'conceptualDensity', detail, trend });
    }

    if (typeof metrics?.offTopicHeat === 'number') {
      const heat = clamp(metrics.offTopicHeat);
      const detail = `${toPercent(heat)} off-topic heat`;
      const trend = heat >= 0.6 ? 'spiking' : heat >= 0.4 ? 'elevated' : 'low';
      signals.push({ metric: 'offTopicHeat', detail, trend });
    }

    if (typeof metrics?.discussionMomentum === 'number') {
      const momentum = Math.max(-1, Math.min(1, metrics.discussionMomentum));
      const direction = momentum > 0.15 ? 'recovering' : momentum < -0.15 ? 'slowing' : 'flat';
      const detail = `momentum ${momentum.toFixed(2)}`;
      signals.push({ metric: 'momentum', detail, trend: direction });
    }

    if (typeof metrics?.confusionRisk === 'number') {
      const detail = `${toPercent(metrics.confusionRisk)} confusion risk`;
      const trend = metrics.confusionRisk >= 0.55 ? 'rising' : metrics.confusionRisk >= 0.35 ? 'watch' : 'low';
      signals.push({ metric: 'confusionRisk', detail, trend });
    }

    if (sessionGoal) {
      signals.push({ metric: 'goal', detail: this.applyDomainNormalization(sessionGoal) });
    }

    return signals.slice(0, 5);
  }

  private buildTitlecaseMap(): Array<{ match: string; replacement: string }> {
    const raw = process.env.AI_GUIDANCE_TITLECASE_TERMS;
    if (!raw) {
      return [];
    }
    return raw
      .split(/[;\n]/)
      .map((segment) => {
        const [match, replacement] = segment.split('=').map((token) => token?.trim());
        if (!match || !replacement) {
          return undefined;
        }
        return { match, replacement };
      })
      .filter((pair): pair is { match: string; replacement: string } => Boolean(pair));
  }

  private buildTokenSpanIndex(sources: string[], span: number): Set<string> {
    const index = new Set<string>();
    if (!Number.isFinite(span) || span <= 0) {
      return index;
    }
    for (const source of sources) {
      const tokens = this.tokenize(source);
      for (let i = 0; i <= tokens.length - span; i++) {
        index.add(this.buildTokenKey(tokens.slice(i, i + span)));
      }
    }
    return index;
  }

  private pruneEvidenceByAge(evidence: EvidenceWindows): EvidenceWindows {
    const maxAgeMs = this.contextSettings.windowMaxAgeMs;
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      return evidence;
    }
    const cutoff = Date.now() - maxAgeMs;
    const filterLines = (lines: PromptContextQuote[]) => {
      const filtered = lines.filter((line) => {
        const ts = typeof line.timestamp === 'number'
          ? line.timestamp
          : typeof line.timestamp === 'string'
            ? Date.parse(line.timestamp)
            : Number.isFinite((line as any)?.timestampMs)
              ? Number((line as any).timestampMs)
              : NaN;
        if (!Number.isFinite(ts)) {
          return true;
        }
        return ts >= cutoff;
      });
      return filtered.length > 0 ? filtered : lines;
    };
    return {
      aligned: filterLines(evidence.aligned),
      tangent: filterLines(evidence.tangent),
    };
  }

  private resolveSessionGoal(sessionContext?: { subject?: string; topic?: string; goals?: string[]; description?: string }): string | undefined {
    const goals = Array.isArray(sessionContext?.goals) ? sessionContext!.goals : undefined;
    const primaryGoal = goals?.find((goal) => typeof goal === 'string' && goal.trim().length > 0)?.trim();
    if (primaryGoal) {
      return primaryGoal;
    }
    const topic = typeof sessionContext?.topic === 'string' ? sessionContext.topic.trim() : '';
    if (topic) {
      return topic;
    }
    const description = typeof sessionContext?.description === 'string' ? sessionContext.description.trim() : '';
    if (description) {
      return description;
    }
    return undefined;
  }

  private evaluateContextQuality(payload: PromptContextPayload, sessionGoal?: string): number {
    let score = 0;
    const reason = payload.reason ?? '';
    if (reason) {
      score += 0.3;
    }

    if (sessionGoal) {
      const goalLc = sessionGoal.toLowerCase();
      if (reason.toLowerCase().includes(goalLc.slice(0, Math.min(goalLc.length, 12)))) {
        score += 0.1;
      }
    }

    const priorTopic = payload.priorTopic?.trim();
    const currentTopic = payload.currentTopic?.trim();
    if (priorTopic && currentTopic) {
      score += 0.25;
      if (priorTopic !== currentTopic) {
        score += 0.05;
      }
    } else if (priorTopic || currentTopic) {
      score += 0.12;
    }

    const supporting = payload.supportingLines ?? [];
    if (supporting.length >= 3) {
      score += 0.2;
    } else if (supporting.length >= 2) {
      score += 0.15;
    } else if (supporting.length === 1) {
      score += 0.08;
    }

    if (payload.transitionIdea) {
      score += 0.1;
    }

    const reasonLength = reason.length;
    if (reasonLength < this.contextSettings.summaryMinChars) {
      score -= 0.2;
    }
    if (reasonLength > this.contextSettings.summaryMaxChars) {
      score -= 0.1;
    }

    const reasonLc = reason.toLowerCase();
    for (const term of this.contextSettings.domainTerms) {
      if (reasonLc.includes(term.toLowerCase())) {
        score += 0.08;
        break;
      }
    }

    return this.clamp01(score);
  }

  private transformProviderContext(
    context: PromptContextDescriptor | undefined,
    confidence: number | undefined,
    spanIndex: Set<string>,
    sessionGoal?: string
  ): PromptContextPayload | undefined {
    if (!context) {
      return undefined;
    }

    const reasonRaw = this.cleanContextValue(context.reason, this.contextSettings.summaryMaxChars);
    const priorTopicRaw = this.cleanContextValue(context.priorTopic, this.contextSettings.topicMaxChars);
    const currentTopicRaw = this.cleanContextValue(context.currentTopic, this.contextSettings.topicMaxChars);
    const transitionIdeaRaw = this.cleanContextValue(context.transitionIdea, this.contextSettings.transitionMaxChars);
    const actionLineRaw = this.cleanContextValue(context.actionLine, this.contextSettings.transitionMaxChars);
    const summaryLimit = Math.min(240, Math.max(this.contextSettings.summaryMaxChars + 80, 200));
    const contextSummaryRaw = this.cleanContextValue(context.contextSummary, summaryLimit);

    const actionLine = actionLineRaw ? this.applyDomainNormalization(actionLineRaw) : undefined;
    const reason = reasonRaw ? this.applyDomainNormalization(reasonRaw) : undefined;
    const priorTopic = priorTopicRaw ? this.applyDomainNormalization(priorTopicRaw) : undefined;
    const currentTopic = currentTopicRaw ? this.applyDomainNormalization(currentTopicRaw) : undefined;
    const transitionIdea = transitionIdeaRaw ? this.applyDomainNormalization(transitionIdeaRaw) : undefined;
    const contextSummary = contextSummaryRaw ? this.applyDomainNormalization(contextSummaryRaw) : undefined;

    const lines = this.normalizeProviderLines(context, spanIndex);
    const limitedLines = lines.slice(0, this.contextSettings.supportingLinesMax);

    const hasContent = Boolean(
      actionLine ||
      reason ||
      priorTopic ||
      currentTopic ||
      transitionIdea ||
      contextSummary ||
      limitedLines.length > 0
    );

    if (!hasContent) {
      return undefined;
    }

    const payload: PromptContextPayload = {};
    if (actionLine) payload.actionLine = actionLine;
    if (reason) payload.reason = reason;
    if (priorTopic) payload.priorTopic = priorTopic;
    if (currentTopic) payload.currentTopic = currentTopic;
    if (transitionIdea) payload.transitionIdea = transitionIdea;
    if (contextSummary) payload.contextSummary = contextSummary;

    if (contextSummary) {
      const timestamp = new Date().toISOString();
      payload.supportingLines = [{ speaker: '', quote: contextSummary, timestamp }];
      payload.quotes = [{ speakerLabel: '', text: contextSummary, timestamp }];
    } else if (limitedLines.length > 0) {
      const firstLine = limitedLines[0];
      const quoteText = this.applyDomainNormalization(firstLine.text);
      payload.quotes = [{
        speakerLabel: firstLine.speakerLabel,
        text: quoteText,
        timestamp: firstLine.timestamp,
      }];
      payload.supportingLines = [{
        speaker: firstLine.speakerLabel || '',
        quote: quoteText,
        timestamp: firstLine.timestamp,
      }];
      if (!payload.contextSummary) {
        payload.contextSummary = quoteText;
      }
    }

    const normalizedConfidence = typeof context.confidence === 'number' ? this.clamp01(context.confidence) : undefined;
    const mergedConfidence = typeof confidence === 'number' ? this.clamp01(confidence) : normalizedConfidence;
    if (typeof mergedConfidence === 'number') {
      payload.confidence = mergedConfidence;
    }

    const quality = this.evaluateContextQuality(payload, sessionGoal);
    if (quality < 0.6) {
      const fallback = this.buildFallbackReason(sessionGoal);
      payload.reason = this.applyDomainNormalization(
        this.truncateContextText(reason ? `${reason} ${fallback}` : fallback, this.contextSettings.summaryMaxChars) ?? fallback
      );
    }

    return payload;
  }

  private normalizeProviderLines(context: PromptContextDescriptor, spanIndex: Set<string>): PromptContextQuote[] {
    const primary = Array.isArray(context.supportingLines) ? context.supportingLines : undefined;
    const fallback = Array.isArray(context.quotes) ? context.quotes : undefined;
    const source = primary && primary.length > 0 ? primary : fallback || [];

    const lines: PromptContextQuote[] = [];
    source.forEach((raw, index) => {
      const speakerRaw = (raw as any)?.speakerLabel ?? (raw as any)?.speaker;
      const textRaw = (raw as any)?.text ?? (raw as any)?.quote;
      const cleaned = this.cleanContextValue(textRaw, this.contextSettings.supportingLineCharLimit);
      if (!cleaned) {
        return;
      }
      if (this.containsExactSpan(cleaned, spanIndex)) {
        return;
      }
      const speakerLabel = this.safeSpeakerLabel(typeof speakerRaw === 'string' ? speakerRaw : undefined, index);
      const timestamp = this.normalizeTimestampToString((raw as any)?.timestamp);
      lines.push({
        speakerLabel,
        text: cleaned,
        timestamp,
      });
    });

    return lines;
  }

  private cleanContextValue(value: string | undefined, limit: number): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = this.stripQuotes(value).replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return undefined;
    }
    return this.truncateContextText(normalized, limit);
  }

  private stripQuotes(input: string): string {
    return input.replace(QUOTE_CHARS_REGEX, '');
  }

  private truncateContextText(input?: string, limit = this.contextSettings.legacyMaxChars): string | undefined {
    if (!input) return undefined;
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    if (trimmed.length <= limit) {
      return trimmed;
    }
    if (limit <= 1) {
      return trimmed.slice(0, Math.max(0, limit));
    }
    return `${trimmed.slice(0, Math.max(0, limit - 1))}…`;
  }

  private buildHeuristicContext(
    evidence: EvidenceWindows,
    confidence: number | undefined,
    sessionGoal?: string
  ): { payload: PromptContextPayload; quality: number } | null {
    const tangent = evidence.tangent;
    const aligned = evidence.aligned;

    if (tangent.length === 0 && aligned.length === 0) {
      return null;
    }

    const currentTopics = this.composeTopicSummary(tangent);
    const priorTopics = this.composeTopicSummary(aligned);
    const currentTopic = this.joinTopics(currentTopics);
    const priorTopic = this.joinTopics(priorTopics);

    const reason = this.composeReason(currentTopic, priorTopic, sessionGoal);
    const transitionIdea = this.composeTransitionIdea(currentTopic, priorTopic, sessionGoal);
    const actionLine = this.composeActionLine(currentTopic, sessionGoal);

    const summaryLimit = Math.min(240, Math.max(this.contextSettings.summaryMaxChars + 80, 200));
    const summarySource = [reason, transitionIdea].filter(Boolean).join(' ');
    const contextSummary = this.truncateContextText(summarySource, summaryLimit) ?? reason ?? transitionIdea;

    const timestamp = new Date().toISOString();
    const payload: PromptContextPayload = {
      actionLine,
      reason: reason ? this.applyDomainNormalization(reason) : undefined,
      priorTopic: priorTopic ? this.applyDomainNormalization(priorTopic) : undefined,
      currentTopic: currentTopic ? this.applyDomainNormalization(currentTopic) : undefined,
      transitionIdea: transitionIdea ? this.applyDomainNormalization(transitionIdea) : undefined,
      contextSummary: contextSummary ? this.applyDomainNormalization(contextSummary) : undefined,
      supportingLines: contextSummary
        ? [
            {
              speaker: '',
              quote: this.applyDomainNormalization(contextSummary),
              timestamp,
            },
          ]
        : undefined,
      quotes: contextSummary
        ? [
            {
              speakerLabel: '',
              text: this.applyDomainNormalization(contextSummary),
              timestamp,
            },
          ]
        : undefined,
      confidence: typeof confidence === 'number' ? this.clamp01(confidence) : undefined,
    };

    const hasContent = Boolean(
      payload.actionLine &&
        payload.reason &&
        payload.contextSummary &&
        (payload.priorTopic || payload.currentTopic || payload.transitionIdea)
    );

    if (!hasContent) {
      return null;
    }

    const quality = this.evaluateContextQuality(payload, sessionGoal);

    return { payload, quality };
  }

  private composeTopicSummary(lines: PromptContextQuote[]): string[] {
    if (!lines || lines.length === 0) {
      return [];
    }

    const scores = new Map<string, number>();
    const addScore = (term: string, weight: number) => {
      if (!term) return;
      const normalized = this.applyDomainNormalization(term);
      const current = scores.get(normalized) ?? 0;
      scores.set(normalized, current + weight);
    };

    for (const line of lines) {
      const text = line.text.toLowerCase();
      for (const term of this.contextSettings.domainTerms) {
        const lowerTerm = term.toLowerCase();
        if (text.includes(lowerTerm)) {
          addScore(term, 3);
        }
      }
    }

    const keywords = this.extractKeywordsFromLines(lines, 6);
    if (keywords.length > 0) {
      const primaryPhrase = this.capitalizeFirst(this.formatKeywordList(keywords.slice(0, Math.min(3, keywords.length))));
      if (primaryPhrase) {
        addScore(primaryPhrase, 2);
      }
      if (keywords.length > 3) {
        const secondaryPhrase = this.capitalizeFirst(this.formatKeywordList(keywords.slice(1, Math.min(4, keywords.length))));
        if (secondaryPhrase) {
          addScore(secondaryPhrase, 1.2);
        }
      }
      keywords.forEach((token, index) => {
        const tokenPhrase = this.capitalizeFirst(token);
        addScore(tokenPhrase, 1 - index * 0.1);
      });
    }

    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const topics: string[] = [];
    for (const [term] of sorted) {
      if (!term) continue;
      if (topics.some((existing) => existing.toLowerCase() === term.toLowerCase())) {
        continue;
      }
      topics.push(term);
      if (topics.length >= 3) {
        break;
      }
    }

    return topics.slice(0, 3);
  }

  private joinTopics(topics: string[]): string | undefined {
    if (!topics || topics.length === 0) {
      return undefined;
    }
    const joined = topics.join(' · ');
    return this.truncateContextText(joined, this.contextSettings.topicMaxChars);
  }

  private composeReason(currentTopic?: string, priorTopic?: string, sessionGoal?: string): string | undefined {
    const goal = sessionGoal ? this.applyDomainNormalization(sessionGoal) : undefined;
    if (!currentTopic && !priorTopic && !goal) {
      return undefined;
    }

    const goalPhrase = goal ? `${goal}` : `today's goal`;

    let text: string;
    if (currentTopic && priorTopic) {
      text = `${goalPhrase} stalled while discussion shifted from ${this.lowerCaseFirst(priorTopic)} toward ${this.lowerCaseFirst(currentTopic)}.`;
    } else if (currentTopic) {
      text = `${goalPhrase} is on hold while ${this.lowerCaseFirst(currentTopic)} dominates the conversation.`;
    } else if (priorTopic) {
      text = `${goalPhrase} needs forward movement; the group is still circling ${this.lowerCaseFirst(priorTopic)}.`;
    } else {
      text = `${goalPhrase} needs to come back into focus after the tangent.`;
    }

    const secondSentence = goal
      ? `Refocus the dialogue on how this advances ${goal}.`
      : `Guide them to reconnect with the learning objective.`;

    const combined = `${text} ${secondSentence}`;
    return this.truncateContextText(combined, this.contextSettings.summaryMaxChars);
  }

  private composeTransitionIdea(currentTopic?: string, priorTopic?: string, sessionGoal?: string): string | undefined {
    const goal = sessionGoal ? this.applyDomainNormalization(sessionGoal) : undefined;
    if (currentTopic && priorTopic && goal) {
      return this.truncateContextText(
        `Ask for a quick share-out connecting ${priorTopic} to what ${currentTopic} adds to ${goal}.`,
        this.contextSettings.transitionMaxChars
      );
    }
    if (currentTopic && goal) {
      return this.truncateContextText(
        `Invite one student to link ${currentTopic} back to ${goal}.`,
        this.contextSettings.transitionMaxChars
      );
    }
    if (priorTopic && goal) {
      return this.truncateContextText(
        `Have the group extend ${priorTopic} with evidence that advances ${goal}.`,
        this.contextSettings.transitionMaxChars
      );
    }
    if (currentTopic && !goal) {
      return this.truncateContextText(
        `Ask the group how ${currentTopic} supports the lesson objective.`,
        this.contextSettings.transitionMaxChars
      );
    }
    if (priorTopic && !goal) {
      return this.truncateContextText(
        `Prompt them to build on ${priorTopic} with a concrete example.`,
        this.contextSettings.transitionMaxChars
      );
    }
    return goal
      ? this.truncateContextText(`Ask for a quick recap that spotlights progress toward ${goal}.`, this.contextSettings.transitionMaxChars)
      : undefined;
  }

  private composeActionLine(currentTopic?: string, sessionGoal?: string): string {
    const goal = sessionGoal ? this.applyDomainNormalization(sessionGoal) : "today's goal";
    const limit = Math.max(80, Math.min(120, this.contextSettings.transitionMaxChars));
    if (currentTopic) {
      const line = `Refocus the group by tying ${this.lowerCaseFirst(currentTopic)} directly to ${goal}.`;
      return this.truncateContextText(line, limit) ?? line;
    }
    const fallback = `Guide the group back to ${goal} with a quick evidence check-in.`;
    return this.truncateContextText(fallback, limit) ?? fallback;
  }

  private buildFallbackReason(sessionGoal?: string): string {
    const goal = sessionGoal ? this.applyDomainNormalization(sessionGoal) : undefined;
    const base = goal
      ? `Bring focus back to today's goal (${goal}). Ask each student to share one example that advances it.`
      : `Bring the discussion back to today's goal. Ask each student to share one example that supports it.`;
    return this.truncateContextText(base, this.contextSettings.summaryMaxChars) ?? base;
  }

  private async buildLlmContextSummary(args: {
    evidence: EvidenceWindows;
    sessionGoal?: string;
    spanIndex: Set<string>;
    driftSignals: GuidanceDriftSignal[];
    confidence?: number;
  }): Promise<{ payload: PromptContextPayload; quality?: number }> {
    const { evidence, sessionGoal, spanIndex, driftSignals, confidence } = args;
    const { databricksAIService } = await import('./databricks-ai.service');

    const aligned = evidence.aligned.map((line) => ({ text: line.text?.replace(/[\n\r]+/g, ' ') ?? '' }));
    const current = evidence.tangent.map((line) => ({ text: line.text?.replace(/[\n\r]+/g, ' ') ?? '' }));

    const descriptor = await databricksAIService.summarizeGuidanceContext({
      aligned,
      current,
      sessionGoal,
      driftSignals,
      domainTerms: this.contextSettings.domainTerms,
      titlecaseMap: this.buildTitlecaseMap(),
    });

    if (!descriptor) {
      throw new Error('Guidance summarizer returned empty descriptor');
    }

    const payload = this.transformProviderContext(descriptor, confidence, spanIndex, sessionGoal);
    if (!payload) {
      throw new Error('Guidance summarizer produced unusable payload');
    }

    const quality = this.evaluateContextQuality(payload, sessionGoal);
    return { payload, quality };
  }

  private extractKeywordsFromLines(lines: Array<{ text: string }>, maxTerms: number): string[] {
    const counts = new Map<string, number>();
    for (const line of lines) {
      const tokens = this.extractKeywords(line.text, maxTerms * 4);
      for (const token of tokens) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([token]) => token)
      .slice(0, maxTerms);
  }

  private extractKeywords(text: string | undefined, maxTerms: number): string[] {
    if (!text) {
      return [];
    }
    const tokens = this.tokenize(text).filter((token) => token.length > 2 && !this.keywordStopWords.has(token));
    if (tokens.length === 0) {
      return [];
    }
    return tokens.slice(0, maxTerms);
  }

  private formatKeywordList(keywords: string[]): string {
    if (keywords.length === 0) {
      return '';
    }
    if (keywords.length === 1) {
      return keywords[0];
    }
    if (keywords.length === 2) {
      return `${keywords[0]} and ${keywords[1]}`;
    }
    return `${keywords[0]}, ${keywords[1]}, and ${keywords[2]}`;
  }

  private capitalizeFirst(value: string): string {
    if (!value) return value;
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private lowerCaseFirst(value: string): string {
    if (!value) return value;
    return value.charAt(0).toLowerCase() + value.slice(1);
  }

  private containsExactSpan(text: string, spanIndex: Set<string>): boolean {
    if (!this.contextSettings.redactExactQuotes || spanIndex.size === 0) {
      return false;
    }
    const tokens = this.tokenize(text);
    if (tokens.length < PARAPHRASE_TOKEN_SPAN) {
      return false;
    }
    for (let i = 0; i <= tokens.length - PARAPHRASE_TOKEN_SPAN; i++) {
      const key = this.buildTokenKey(tokens.slice(i, i + PARAPHRASE_TOKEN_SPAN));
      if (spanIndex.has(key)) {
        return true;
      }
    }
    return false;
  }

  private buildTokenKey(tokens: string[]): string {
    return tokens.join('|');
  }

  private tokenize(text: string): string[] {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return [];
    }
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }

  private buildEvidenceWindowsFromBuffer(raw: {
    aligned: Array<{ speakerLabel: string; text: string; timestamp: number }>;
    tangent: Array<{ speakerLabel: string; text: string; timestamp: number }>;
  }): EvidenceWindows {
    return {
      aligned: this.toPromptContextQuotes(raw.aligned),
      tangent: this.toPromptContextQuotes(raw.tangent),
    };
  }

  private toPromptContextQuotes(lines: Array<{ speakerLabel: string; text: string; timestamp: number }>): PromptContextQuote[] {
    return lines
      .slice(-6)
      .map((line, index) => this.toPromptContextQuote(line, index))
      .filter((quote): quote is PromptContextQuote => Boolean(quote));
  }

  private toPromptContextQuote(
    line: { speakerLabel: string; text: string; timestamp: number },
    index: number
  ): PromptContextQuote | null {
    const text = this.truncateContextText(line.text) || line.text;
    if (!text) {
      return null;
    }

    return {
      speakerLabel: this.safeSpeakerLabel(line.speakerLabel, index),
      text,
      timestamp: this.normalizeTimestampToString(line.timestamp),
    };
  }

  private safeSpeakerLabel(label: string | undefined, index: number): string {
    if (typeof label === 'string') {
      const trimmed = label.trim();
      if (trimmed.length === 0) {
        return '';
      }
      if (/^participant\s+\d+$/i.test(trimmed)) {
        return this.truncateSpeakerLabel(trimmed);
      }
      return this.truncateSpeakerLabel(trimmed);
    }
    return index >= 0 ? `Participant ${index + 1}` : '';
  }

  private truncateSpeakerLabel(label: string): string {
    const trimmed = label.trim();
    if (trimmed.length <= 40) {
      return trimmed;
    }
    return `${trimmed.slice(0, 39)}…`;
  }

  private normalizeTimestampToString(value: unknown): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return new Date(value).toISOString();
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return new Date().toISOString();
      }
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) {
        return new Date(numeric).toISOString();
      }
      const parsed = new Date(trimmed);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
      return trimmed;
    }
    return new Date().toISOString();
  }

  private maybeBuildOnTrackSummary(
    sessionId: string,
    groupId: string,
    cacheKey: string,
    insights: Tier1Insights,
    context?: PromptContextPayload,
    onTrack?: boolean
  ): string | undefined {
    if (process.env.GUIDANCE_ONTRACK_SUMMARIES_ENABLED !== '1') {
      this.trackOnTrackSummarySuppressed('flag_disabled');
      return undefined;
    }
    if (!onTrack) {
      this.trackOnTrackSummarySuppressed('not_on_track');
      return undefined;
    }

    const intervalMs = Math.max(60000, parseInt(process.env.GUIDANCE_ONTRACK_SUMMARY_INTERVAL_MS || '300000', 10));
    const now = Date.now();
    const last = this.onTrackSummaryState.get(cacheKey);
    if (last && now - last.timestamp < intervalMs) {
      this.trackOnTrackSummarySuppressed('interval');
      return undefined;
    }

    const summary = this.buildOnTrackSummaryText(insights, context);
    if (!summary) {
      this.trackOnTrackSummarySuppressed('insufficient_context');
      return undefined;
    }

      if (last && last.summary === summary) {
        this.onTrackSummaryState.set(cacheKey, { summary, timestamp: now });
        this.trackOnTrackSummarySuppressed('dedupe');
        return undefined;
      }

      this.onTrackSummaryState.set(cacheKey, { summary, timestamp: now });
      return summary;
  }

  private buildOnTrackSummaryText(insights: Tier1Insights, context?: PromptContextPayload): string | undefined {
    const cohesion = Number.isFinite(insights.topicalCohesion) ? Math.round(insights.topicalCohesion * 100) : undefined;
    const density = Number.isFinite(insights.conceptualDensity) ? Math.round(insights.conceptualDensity * 100) : undefined;
    const rawMomentum = typeof insights.discussionMomentum === 'number' ? insights.discussionMomentum : undefined;
    const momentum = rawMomentum !== undefined && Number.isFinite(rawMomentum) ? Math.round(rawMomentum * 100) : undefined;

    const parts: string[] = [];
    if (context?.priorTopic) {
      parts.push(`focused on ${context.priorTopic}`);
    }
    if (typeof cohesion === 'number') {
      parts.push(`cohesion ${cohesion}%`);
    }
    if (typeof density === 'number') {
      parts.push(`depth ${density}%`);
    }
    if (typeof momentum === 'number' && momentum > 0) {
      parts.push(`momentum +${momentum}`);
    }

    const descriptor = parts.length > 0 ? parts.join(', ') : 'steady progress';
    const base = `Group is on track — ${descriptor}. Celebrate their momentum and keep checking in.`;

    return this.truncateSummaryText(base);
  }

  private truncateSummaryText(input: string): string {
    const trimmed = input.trim();
    if (trimmed.length <= this.onTrackSummaryLimit) {
      return trimmed;
    }
    return `${trimmed.slice(0, this.onTrackSummaryLimit - 1)}…`;
  }

  private trackOnTrackSummarySuppressed(reason: string): void {
    try { this.onTrackSummarySuppressed.inc({ reason }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
  }

  private computeAverage(values: Array<number | undefined | null>): number | undefined {
    const numericValues = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (numericValues.length === 0) {
      return undefined;
    }
    const total = numericValues.reduce((acc, val) => acc + val, 0);
    return this.clamp01(total / numericValues.length);
  }

  private async maybeEmitTier2ShiftAnalytics(sessionId: string, groupId: string, insights: Tier2Insights): Promise<void> {
    if (process.env.GUIDANCE_TIER2_SHIFT_ENABLED !== '1') {
      return;
    }

    let client;
    try {
      client = redisService.getClient();
    } catch (error) {
      try { this.guidanceRedisUnavailable.inc({ component: 'attention_gate' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
      if (process.env.API_DEBUG === '1') {
        logger.warn('Tier2 shift analytics unavailable (Redis client)', error instanceof Error ? error.message : String(error));
      }
      return;
    }
    const snapshotKey = `guidance:tier2:last:${sessionId}:${groupId}`;
    const ttlSeconds = (() => {
      const parsed = Number(process.env.SLI_SESSION_TTL_SECONDS);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
      return 3600;
    })();

    const collaborationScore = this.computeAverage([
      insights.collaborationPatterns?.turnTaking,
      insights.collaborationPatterns?.buildingOnIdeas,
      insights.collaborationPatterns?.conflictResolution,
      insights.collaborationPatterns?.inclusivity,
    ]);
    const learningScore = this.computeAverage([
      insights.learningSignals?.conceptualGrowth,
      insights.learningSignals?.questionQuality,
      insights.learningSignals?.metacognition,
      insights.learningSignals?.knowledgeApplication,
    ]);
    const emotionalTrajectory = insights.collectiveEmotionalArc?.trajectory
      || insights.groupEmotionalArc?.trajectory
      || null;

    const currentSnapshot = {
      timestamp: Date.now(),
      collaborationScore,
      learningScore,
      emotionalTrajectory,
    };

    let previousSnapshot: typeof currentSnapshot | null = null;
    try {
      const raw = await client.get(snapshotKey);
      if (raw) {
        previousSnapshot = JSON.parse(raw);
      }
    } catch (error) {
      try { this.guidanceRedisUnavailable.inc({ component: 'attention_gate' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
      if (process.env.API_DEBUG === '1') {
        logger.warn('Tier2 shift snapshot load failed (fail-closed)', error instanceof Error ? error.message : error);
      }
      // Fail-closed: skip emit but attempt to refresh snapshot below
      previousSnapshot = null;
    }

    try {
      if (ttlSeconds > 0) {
        await client.set(snapshotKey, JSON.stringify(currentSnapshot), 'EX', ttlSeconds);
      } else {
        await client.set(snapshotKey, JSON.stringify(currentSnapshot));
      }
    } catch (error) {
      try { this.guidanceRedisUnavailable.inc({ component: 'attention_gate' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
      if (process.env.API_DEBUG === '1') {
        logger.warn('Tier2 shift snapshot store failed', error instanceof Error ? error.message : error);
      }
    }

    if (!previousSnapshot) {
      return; // warm-up: require at least one prior window
    }

    const analyticsEvents: WsGuidanceAnalyticsEvent[] = [];

    if (typeof collaborationScore === 'number' && typeof previousSnapshot.collaborationScore === 'number') {
      const delta = collaborationScore - previousSnapshot.collaborationScore;
      if (delta <= -0.15) {
        analyticsEvents.push({
          category: 'tier2-shift',
          sessionId,
          metrics: {
            groupId,
            metric: 'collaborationPatterns',
            previous: Number(previousSnapshot.collaborationScore.toFixed(3)),
            current: Number(collaborationScore.toFixed(3)),
            delta: Number(delta.toFixed(3)),
            threshold: -0.15,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (typeof learningScore === 'number' && typeof previousSnapshot.learningScore === 'number') {
      const delta = learningScore - previousSnapshot.learningScore;
      if (delta >= 0.2) {
        analyticsEvents.push({
          category: 'tier2-shift',
          sessionId,
          metrics: {
            groupId,
            metric: 'learningSignals',
            previous: Number(previousSnapshot.learningScore.toFixed(3)),
            current: Number(learningScore.toFixed(3)),
            delta: Number(delta.toFixed(3)),
            threshold: 0.2,
          },
          timestamp: new Date().toISOString(),
        });
      }
    }

    if (previousSnapshot.emotionalTrajectory && emotionalTrajectory && previousSnapshot.emotionalTrajectory !== emotionalTrajectory) {
      analyticsEvents.push({
        category: 'tier2-shift',
        sessionId,
        metrics: {
          groupId,
          metric: 'emotionalTrajectory',
          previous: previousSnapshot.emotionalTrajectory,
          current: emotionalTrajectory,
          threshold: 1,
        },
        timestamp: new Date().toISOString(),
      });
    }

    if (analyticsEvents.length === 0) {
      return;
    }

    const throttleKey = `guidance:tier2:shift:last_emit:${sessionId}:${groupId}`;
    try {
      const throttleResult = await client.set(throttleKey, '1', 'PX', 600000, 'NX');
      if (throttleResult !== 'OK') {
        return; // throttled; do not emit
      }
    } catch (error) {
      try { this.guidanceRedisUnavailable.inc({ component: 'attention_gate' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
      if (process.env.API_DEBUG === '1') {
        logger.warn('Tier2 shift throttle failed (fail-closed)', error instanceof Error ? error.message : error);
      }
      return; // fail-closed per requirements
    }

    try {
      const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
      const guidanceService = getNamespacedWebSocketService()?.getGuidanceService();
      if (!guidanceService) {
        return;
      }
      analyticsEvents.forEach((event) => guidanceService.emitGuidanceAnalytics(event));
    } catch (error) {
      logger.warn('Tier2 shift analytics emit failed:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * Check if AI analysis should be triggered and execute if ready
   */
  async checkAndTriggerAIAnalysis(groupId: string, sessionId: string, teacherId: string): Promise<void> {
    try {
      // Fast gate: if session is ending/ended, skip all triggers immediately
      try {
        const r = redisService.getClient();
        const ending = await r.get(`ws:session:ending:${sessionId}`);
        const status = await r.get(`ws:session:status:${sessionId}`);
        if (ending === '1' || status === 'ended') {
          // Count suppressions for observability (reuse or create counter)
          try {
            const name = 'ai_triggers_suppressed_ending_total';
            const existing = client.register.getSingleMetric(name) as client.Counter<string> | undefined;
            const ctr = existing || new client.Counter({ name, help: 'AI triggers suppressed due to session ending/ended' });
            ctr.inc();
          } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
          if (process.env.API_DEBUG === '1') {
            try { logger.debug('🛑 Skipping AI analysis triggers (ending/ended)', { sessionId, groupId }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
          }
          return; // Hard stop
        }
      } catch {
        // If gating check fails, continue best-effort
      }

      const tier1Transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', groupId, sessionId);
      const tier2Transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier2', groupId, sessionId);

      // Build session context for prompt anchoring (best-effort)
      let sessionContext: { subject?: string; topic?: string; goals?: string[]; description?: string } | undefined;
      try {
        const { getCompositionRoot } = await import('../app/composition-root');
        const detailRepo = getCompositionRoot().getSessionDetailRepository();
        const detail = await detailRepo.getOwnedSessionDetail(sessionId, teacherId);
        const subject = (detail as any)?.subject || undefined;
        const goal = (detail as any)?.goal || undefined;
        const title = (detail as any)?.title || undefined;
        const description = (detail as any)?.description || undefined;
        sessionContext = {
          subject: typeof subject === 'string' ? subject : undefined,
          topic: typeof title === 'string' ? title : undefined,
          goals: goal ? [String(goal)] : [],
          description: typeof description === 'string' ? description : undefined,
        };
      } catch {
        // Fallback: keep undefined; prompt builders tolerate missing context
      }

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
        try { this.tier1SuppressedWarmup.inc(); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
      }
      if (!withinWarmup && eligibleForTier1) {
        await this.triggerTier1Analysis(groupId, sessionId, teacherId, tier1Transcripts, sessionContext);
      }

      if (this.shouldTriggerTier2Analysis(tier2Transcripts)) {
        await this.triggerTier2Analysis(groupId, sessionId, teacherId, tier2Transcripts, sessionContext);
      }
    } catch (error) {
      logger.error(`❌ AI analysis check failed for group ${groupId}:`, error);
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
    const minChars = parseInt(process.env.AI_TIER2_GROUP_MIN_CHARS || '400', 10);
    const minTranscripts = parseInt(process.env.AI_TIER2_GROUP_MIN_TRANSCRIPTS || '6', 10);
    return transcripts.length >= minTranscripts && combinedLength > minChars;
  }

  /**
   * Trigger Tier 1 analysis and broadcast insights via namespaced sessions service
   */
  public async triggerTier1Analysis(
    groupId: string,
    sessionId: string,
    teacherId: string,
    transcripts: string[],
    sessionContext?: { subject?: string; topic?: string; goals?: string[]; description?: string }
  ): Promise<void> {
    const startTime = Date.now();
    try {
      logger.debug(`🧠 Triggering Tier 1 analysis for group ${groupId}`);
      // Apply extended window on first Tier1 analysis per session:group if configured
      const firstWindowSec = parseInt(process.env.GUIDANCE_TIER1_FIRST_WINDOW_SECONDS || '60', 10);
      const firstKey = `${sessionId}:${groupId}`;
      const isFirstTier1 = !this.firstTier1Completed.has(firstKey) && firstWindowSec > 0;
      // Default Tier1 window seconds derived from AI_TIER1_WINDOW_MS to keep prompt label/env in sync
      const defaultWindowSec = (() => {
        const ms = parseInt(process.env.AI_TIER1_WINDOW_MS || '30000', 10);
        const sec = Math.floor((Number.isFinite(ms) ? ms : 30000) / 1000);
        return Math.max(5, sec); // clamp to sensible lower bound
      })();
      const windowSize = isFirstTier1 ? firstWindowSec : defaultWindowSec;

      const rawContextWindows = aiAnalysisBufferService.getContextWindows(sessionId, groupId);
      const evidenceWindows = this.buildEvidenceWindowsFromBuffer(rawContextWindows);

      const insights = await aiAnalysisPort.analyzeTier1(transcripts, {
        groupId,
        sessionId,
        focusAreas: ['topical_cohesion', 'conceptual_density'],
        windowSize,
        includeMetadata: true,
        evidenceWindows,
        sessionContext,
      });

      if (isFirstTier1) {
        this.firstTier1Completed.add(firstKey);
      }

      const combinedTranscript = transcripts.join(' ');
      const charCount = combinedTranscript.length;
      const lexicalDiversity = this.computeLexicalDiversity(transcripts);
      const effectiveWindowSeconds = Math.max(1, windowSize);
      const cps = charCount / effectiveWindowSeconds;
      const analysisTimestampMs = (() => {
        if (insights?.analysisTimestamp) {
          const parsed = Date.parse(insights.analysisTimestamp);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
        return Date.now();
      })();
      const sessionTtlSeconds = (() => {
        const raw = Number(process.env.SLI_SESSION_TTL_SECONDS);
        if (Number.isFinite(raw) && raw > 0) {
          return Math.floor(raw);
        }
        return 3600;
      })();

      let energyLevel = this.clamp01((0.5 + lexicalDiversity) / 2);
      try {
        const scripts = redisService.getGuidanceScripts();
        const energyStats = await scripts.energyWelford({
          key: `guidance:energy:stats:${sessionId}:${groupId}`,
          sample: cps,
          ttlSeconds: sessionTtlSeconds,
        });
        let energyZ = 0;
        if (energyStats.count >= 3 && charCount >= 200) {
          const sigma = energyStats.variance > 0 ? Math.sqrt(energyStats.variance) : 0;
          if (sigma > 0.01) {
            energyZ = (cps - energyStats.mean) / sigma;
          }
        }
        const logistic = this.logistic(energyZ);
        energyLevel = this.clamp01((logistic + lexicalDiversity) / 2);
      } catch (error) {
        try { this.guidanceRedisUnavailable.inc({ component: 'attention_gate' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
        if (process.env.API_DEBUG === '1') {
          logger.warn('Energy baseline update failed; using fallback', error instanceof Error ? error.message : error);
        }
        const logistic = this.logistic(0);
        energyLevel = this.clamp01((logistic + lexicalDiversity) / 2);
      }
      insights.energyLevel = energyLevel;
      const existingMetadata = { ...(insights.metadata || {}) } as any;
      const rawScores = { ...(existingMetadata.rawScores ?? {}) } as Record<string, number>;
      rawScores.lexicalDiversity = lexicalDiversity;
      insights.metadata = {
        ...existingMetadata,
        rawScores,
      };

      const topicalCohesion = typeof insights.topicalCohesion === 'number' ? this.clamp01(insights.topicalCohesion) : undefined;
      const conceptualDensity = typeof insights.conceptualDensity === 'number' ? this.clamp01(insights.conceptualDensity) : undefined;
      if (typeof topicalCohesion === 'number') {
        insights.topicalCohesion = topicalCohesion;
      }
      if (typeof conceptualDensity === 'number') {
        insights.conceptualDensity = conceptualDensity;
      }
      const onTrackScore = typeof topicalCohesion === 'number' && typeof conceptualDensity === 'number'
        ? this.clamp01(Math.min(topicalCohesion, conceptualDensity))
        : undefined;
      const offTopicHeat = this.clamp01(
        typeof insights.offTopicHeat === 'number'
          ? insights.offTopicHeat
          : typeof onTrackScore === 'number'
            ? 1 - onTrackScore
            : 0
      );
      insights.offTopicHeat = offTopicHeat;
      const confusionRisk = this.clamp01(typeof insights.confusionRisk === 'number' ? insights.confusionRisk : 0);
      insights.confusionRisk = confusionRisk;

      let discussionMomentum = 0;
      if (typeof topicalCohesion === 'number') {
        const alpha = 0.6;
        const state = this.discussionMomentumState.get(firstKey) || { ema: topicalCohesion, count: 0 };
        const previousEma = state.count === 0 ? topicalCohesion : state.ema;
        const newEma = state.count === 0 ? topicalCohesion : alpha * topicalCohesion + (1 - alpha) * state.ema;
        if (state.count >= 2) {
          discussionMomentum = Math.max(-1, Math.min(1, newEma - previousEma));
        } else {
          discussionMomentum = 0;
        }
        this.discussionMomentumState.set(firstKey, { ema: newEma, count: state.count + 1 });
      } else {
        this.discussionMomentumState.delete(firstKey);
        discussionMomentum = 0;
      }
      insights.discussionMomentum = discussionMomentum;

      // Tier1 gating: suppress on-track emits/prompts (env-controlled) and emit analytics instead
      const suppressOnTrack = process.env.GUIDANCE_TIER1_SUPPRESS_ONTRACK === '1';
      const threshold = Number.isFinite(Number(process.env.GUIDANCE_TIER1_ONTRACK_THRESHOLD))
        ? parseFloat(process.env.GUIDANCE_TIER1_ONTRACK_THRESHOLD as string)
        : 0.5;
      const returnThreshold = process.env.GUIDANCE_TIER1_RETURN_THRESHOLD ? parseFloat(process.env.GUIDANCE_TIER1_RETURN_THRESHOLD) : undefined;
      const confMin = Number.isFinite(Number(process.env.GUIDANCE_TIER1_CONF_MIN))
        ? parseFloat(process.env.GUIDANCE_TIER1_CONF_MIN as string)
        : 0.5;

      const confidence = typeof insights.confidence === 'number' ? insights.confidence : undefined;
      const hasMetrics = typeof onTrackScore === 'number';
      const meetsConfidence = typeof confidence === 'number' ? confidence >= confMin : true;
      let onTrack = false;
      if (hasMetrics && typeof topicalCohesion === 'number' && typeof conceptualDensity === 'number') {
        onTrack = topicalCohesion >= threshold && conceptualDensity >= threshold;
        if (onTrack && typeof returnThreshold === 'number') {
          const last = this.lastOnTrackState.get(firstKey);
          if (last === false) {
            onTrack = topicalCohesion >= returnThreshold && conceptualDensity >= returnThreshold;
          }
        }
      }

      if (meetsConfidence) {
        this.lastOnTrackState.set(firstKey, onTrack);
      }

      const shouldSuppress = suppressOnTrack && onTrack && meetsConfidence;

      const contextExtras = await this.buildPromptContext(
        evidenceWindows,
        insights?.confidence,
        insights.context,
        sessionContext,
        {
          topicalCohesion,
          conceptualDensity,
          offTopicHeat,
          discussionMomentum,
          confusionRisk,
        }
      );
      if (contextExtras.context) {
        insights.context = contextExtras.context;
      } else if (insights.context) {
        delete (insights as Partial<Tier1Insights>).context;
      }
      const onTrackSummary = this.maybeBuildOnTrackSummary(sessionId, groupId, firstKey, insights, contextExtras.context, onTrack);

      if (!shouldSuppress) {
        // Emit to guidance namespace for teacher UI subscribers
        try {
          const payload: Record<string, unknown> = {
            groupId,
            sessionId,
            insights,
            timestamp: new Date(analysisTimestampMs).toISOString(),
          };
          if (onTrackSummary) {
            payload.onTrackSummary = onTrackSummary;
            try { this.onTrackSummaryEmitted.inc({ sessionId, groupId }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
          }
          const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
          getNamespacedWebSocketService()?.getGuidanceService().emitTier1Insight(sessionId, payload);
        } catch (e) {
          logger.warn('Failed to emit Tier1 to guidance namespace:', e instanceof Error ? e.message : String(e));
        }
      }
      else {
        try { this.tier1SuppressedOnTrack.inc(); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
      }

      // Persist insights idempotently (non-blocking)
      try {
        const { aiInsightsPersistenceService } = await import('./ai-insights-persistence.service');
        await aiInsightsPersistenceService.persistTier1(sessionId, groupId, insights).catch(() => undefined);
      } catch (error) {
        logger.warn('ai-analysis trigger persistence failed for tier1 insights', {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
          groupId,
        });
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
              const extras: { context?: PromptContextPayload; onTrackSummary?: string } = {};
              if (contextExtras.context) {
                extras.context = contextExtras.context;
              }
              if (onTrackSummary) {
                extras.onTrackSummary = onTrackSummary;
              }
              const promptOptions = Object.keys(extras).length > 0 ? { extras } : undefined;
              const prompts = await teacherPromptService.generatePrompts(insights, {
                sessionId,
                groupId,
                teacherId,
                sessionPhase: 'development',
                subject: toSubjectArea(sessionContext?.subject),
                learningObjectives: sessionContext?.goals || [],
                groupSize: 4,
                sessionDuration: 45,
              }, promptOptions).catch(() => []);
              const pLatency = Date.now() - promptStart;
              try { this.promptLatency.observe({ tier: 'tier1' }, pLatency); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
              try { this.promptGenCounter.inc({ tier: 'tier1', status: Array.isArray(prompts) && prompts.length > 0 ? 'ok' : 'empty' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
              try { guidanceSystemHealthService.recordSuccess('promptGeneration', 'autoprompt_tier1', pLatency); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
              if (Array.isArray(prompts) && prompts.length > 0) {
                const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
                getNamespacedWebSocketService()?.getGuidanceService().emitTeacherRecommendations(sessionId, prompts, { generatedAt: promptStart, tier: 'tier1' });
              }
            }
          }
        } else {
          try { this.promptGenCounter.inc({ tier: 'tier1', status: 'suppressed' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try { this.promptGenCounter.inc({ tier: 'tier1', status: 'error' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
        try { guidanceSystemHealthService.recordFailure('promptGeneration', 'autoprompt_tier1', 0, msg); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
        logger.warn('Auto-prompt generation (Tier1) failed:', msg);
      }

      if (hasMetrics && typeof onTrackScore === 'number' && typeof topicalCohesion === 'number' && typeof conceptualDensity === 'number') {
        try {
          const weights = this.resolveAttentionWeights();
          const promptPressure = await this.computePromptPressure(sessionId, groupId, analysisTimestampMs, 'attention_gate');
          const momentumPenalty = typeof discussionMomentum === 'number'
            ? Math.max(0, -discussionMomentum)
            : 0;
          const baseScore = weights.offTopic * offTopicHeat + weights.confusion * confusionRisk + weights.momentum * momentumPenalty;
          const rawAttention = baseScore * promptPressure;
          const attentionScore = Math.round(this.clamp01(rawAttention) * 100);
          const deltaScoreEnv = Number(process.env.GUIDANCE_ATTENTION_DELTA_SCORE);
          const deltaMsEnv = Number(process.env.GUIDANCE_ATTENTION_DELTA_MS);
          const minScoreDelta = Number.isFinite(deltaScoreEnv) ? deltaScoreEnv : 5;
          const minTimeDeltaMs = Number.isFinite(deltaMsEnv) ? Math.floor(deltaMsEnv) : 30000;
          const forceEmit = process.env.GUIDANCE_ATTENTION_FORCE_EMIT === '1';

          let allowAttentionEmit = forceEmit;
          let gateError: unknown = null;
          if (!forceEmit) {
            try {
              const scripts = redisService.getGuidanceScripts();
              allowAttentionEmit = await scripts.attentionGate({
                key: `guidance:attention:last:${sessionId}:${groupId}`,
                score: attentionScore,
                timestampMs: analysisTimestampMs,
                minScoreDelta,
                minTimeDeltaMs,
                ttlSeconds: sessionTtlSeconds,
              });
            } catch (error) {
              allowAttentionEmit = true;
              gateError = error;
              try { this.guidanceRedisUnavailable.inc({ component: 'attention_gate' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
              if (process.env.API_DEBUG === '1') {
                logger.warn('Attention gate fail-open (Redis unavailable)', error instanceof Error ? error.message : error);
              }
            }
          }

          if (process.env.API_DEBUG === '1' || process.env.GUIDANCE_ATTENTION_DEBUG === '1') {
            const gateMeta = {
              sessionId,
              groupId,
              attentionScore,
              minScoreDelta,
              minTimeDeltaMs,
              forceEmit,
              allowAttentionEmit,
              gateError: gateError instanceof Error ? gateError.message : gateError,
              timestamp: new Date(analysisTimestampMs).toISOString(),
            };
            logger.debug('Guidance attention gate decision', gateMeta);
          }

          if (allowAttentionEmit) {
            try {
              const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
              const timestampIso = new Date(analysisTimestampMs).toISOString();
              const analyticsPayload = {
                category: 'attention' as const,
                sessionId,
                metrics: {
                  groupId,
                  onTrackScore,
                  topicalCohesion,
                  conceptualDensity,
                  offTopicHeat,
                  discussionMomentum,
                  confusionRisk,
                  energyLevel,
                  attentionScore,
                },
                timestamp: timestampIso,
              };
              getNamespacedWebSocketService()?.getGuidanceService().emitGuidanceAnalytics(analyticsPayload);
              try { this.guidanceAnalyticsEmits.inc(); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
            } catch (emitError) {
              logger.warn('Failed to emit guidance analytics:', emitError instanceof Error ? emitError.message : String(emitError));
            }
          }
        } catch (attentionError) {
          logger.warn('Attention analytics computation failed:', attentionError instanceof Error ? attentionError.message : String(attentionError));
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
        } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
        try { this.tier1EmitCounter.inc({ school }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
        if (lastTs) this.tier1TimeToInsight.observe({ school }, Date.now() - lastTs.getTime());
      } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
      logger.debug(`✅ Tier 1 analysis completed and broadcasted for group ${groupId}`);
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`❌ Tier 1 analysis failed for group ${groupId}:`, error);
      guidanceSystemHealthService.recordFailure('aiAnalysis', 'tier1_analysis', duration, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Trigger Tier 2 analysis and broadcast insights via namespaced sessions service
   */
  // Simple in-process concurrency guard for per-group Tier2
  private static tier2GroupRunning = 0;

  public async triggerTier2Analysis(
    groupId: string,
    sessionId: string,
    teacherId: string,
    transcripts: string[],
    sessionContext?: { subject?: string; topic?: string; goals?: string[]; description?: string }
  ): Promise<void> {
    const startTime = Date.now();
    try {
      const maxConc = parseInt(process.env.AI_TIER2_GROUP_MAX_CONCURRENCY || '2', 10);
      if (AIAnalysisTriggerService.tier2GroupRunning >= Math.max(1, maxConc)) {
        if (process.env.API_DEBUG === '1') {
          logger.debug('⏳ Skipping Tier2 (group) due to concurrency cap', { sessionId, groupId });
        }
        return;
      }
      AIAnalysisTriggerService.tier2GroupRunning++;

      logger.debug(`🧠 Triggering Tier 2 analysis for session ${sessionId}, group ${groupId}`);
      const insights = await aiAnalysisPort.analyzeTier2(transcripts, {
        sessionId,
        groupId,
        groupIds: [groupId],
        analysisDepth: 'standard',
        includeMetadata: true,
        sessionContext,
      });

      // Session-level tier events removed (guidance namespace is canonical)
      const tier2Passive = process.env.GUIDANCE_TIER2_PASSIVE === '1';
      if (!tier2Passive) {
        // Emit to guidance namespace
        try {
          const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
          const timestampIso = (() => {
            const raw = (insights as any)?.analysisTimestamp;
            const parsed = raw ? Date.parse(raw) : NaN;
            return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
          })();
          getNamespacedWebSocketService()?.getGuidanceService().emitTier2Insight(sessionId, {
            scope: 'group',
            sessionId,
            groupId,
            insights,
            timestamp: timestampIso,
          });
        } catch (e) {
          logger.warn('Failed to emit Tier2 to guidance namespace:', e instanceof Error ? e.message : String(e));
        }
      }

      // Persist insights idempotently (non-blocking)
      try {
        const { aiInsightsPersistenceService } = await import('./ai-insights-persistence.service');
        await aiInsightsPersistenceService.persistTier2(sessionId, insights, groupId).catch(() => undefined);
      } catch (error) {
        logger.warn('ai-analysis trigger persistence failed for tier2 insights', {
          error: error instanceof Error ? error.message : String(error),
          sessionId,
          groupId,
        });
      }

      try {
        await this.maybeEmitTier2ShiftAnalytics(sessionId, groupId, insights);
      } catch (error) {
        if (process.env.API_DEBUG === '1') {
          logger.warn('Tier2 shift analytics handling failed', error instanceof Error ? error.message : error);
        }
      }

      // Auto-generate teacher prompts at session level (best-effort; flag-controlled)
      try {
        const tier2Passive = process.env.GUIDANCE_TIER2_PASSIVE === '1';
        if (process.env.GUIDANCE_AUTO_PROMPTS === '0' || tier2Passive) {
          // feature flag off or passive Tier2 (suppressed)
          if (tier2Passive) {
            try { this.promptGenCounter.inc({ tier: 'tier2', status: 'suppressed' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
          }
        } else {
          const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
          if (isUuid(sessionId) && isUuid(teacherId) && isUuid(groupId)) {
            const tier2Windows = this.buildEvidenceWindowsFromBuffer(
              aiAnalysisBufferService.getContextWindows(sessionId, groupId)
            );
            const tier2Metrics = {
              topicalCohesion:
                typeof insights?.collaborationPatterns?.buildingOnIdeas === 'number'
                  ? this.clamp01(insights.collaborationPatterns.buildingOnIdeas)
                  : undefined,
              conceptualDensity:
                typeof insights?.argumentationQuality?.synthesis === 'number'
                  ? this.clamp01(insights.argumentationQuality.synthesis)
                  : undefined,
              confusionRisk:
                typeof insights?.learningSignals?.conceptualGrowth === 'number'
                  ? this.clamp01(1 - insights.learningSignals.conceptualGrowth)
                  : undefined,
            };
            const contextExtras = await this.buildPromptContext(
              tier2Windows,
              insights?.confidence,
              undefined,
              sessionContext,
              tier2Metrics
            );
            const { teacherPromptService } = await import('./teacher-prompt.service');
            const promptStart = Date.now();
            const extras: { context?: PromptContextPayload; onTrackSummary?: string } = {};
            if (contextExtras.context) {
              extras.context = contextExtras.context;
            }
            const promptOptions = Object.keys(extras).length > 0 ? { extras } : undefined;
            const prompts = await teacherPromptService.generatePrompts(insights, {
              sessionId,
              groupId,
              teacherId,
              sessionPhase: 'development',
              subject: toSubjectArea(sessionContext?.subject),
              learningObjectives: sessionContext?.goals || [],
              groupSize: 4,
              sessionDuration: 45,
            }, promptOptions).catch(() => []);
            const pLatency = Date.now() - promptStart;
              try { this.promptLatency.observe({ tier: 'tier2' }, pLatency); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
              try { this.promptGenCounter.inc({ tier: 'tier2', status: Array.isArray(prompts) && prompts.length > 0 ? 'ok' : 'empty' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
              try { guidanceSystemHealthService.recordSuccess('promptGeneration', 'autoprompt_tier2', pLatency); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
              if (Array.isArray(prompts) && prompts.length > 0) {
                const { getNamespacedWebSocketService } = await import('./websocket/namespaced-websocket.service');
                getNamespacedWebSocketService()?.getGuidanceService().emitTeacherRecommendations(sessionId, prompts, { generatedAt: promptStart, tier: 'tier2' });
              }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try { this.promptGenCounter.inc({ tier: 'tier2', status: 'error' }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
        try { guidanceSystemHealthService.recordFailure('promptGeneration', 'autoprompt_tier2', 0, msg); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
        logger.warn('Auto-prompt generation (Tier2) failed:', msg);
      }
      await aiAnalysisBufferService.markBufferAnalyzed('tier2', groupId, sessionId).catch(() => undefined);

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
        } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
        try { this.tier2EmitCounter.inc({ school }); } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
        if (lastTs) this.tier2TimeToInsight.observe({ school }, Date.now() - lastTs.getTime());
      } catch (error) {
   logger.warn('ai-analysis trigger suppressed error', {
     error: error instanceof Error ? error.message : String(error),
   });
 }
      logger.debug(`✅ Tier 2 (group) analysis completed and broadcasted for session ${sessionId} group ${groupId}`);
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(`❌ Tier 2 (group) analysis failed for session ${sessionId} group ${groupId}:`, error);
      guidanceSystemHealthService.recordFailure('aiAnalysis', 'tier2_analysis', duration, error instanceof Error ? error.message : 'Unknown error');
    } finally {
      if (AIAnalysisTriggerService.tier2GroupRunning > 0) AIAnalysisTriggerService.tier2GroupRunning--;
    }
  }

}

export const aiAnalysisTriggerService = new AIAnalysisTriggerService();
