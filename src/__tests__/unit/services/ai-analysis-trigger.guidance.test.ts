import { aiAnalysisTriggerService } from '../../../services/ai-analysis-trigger.service';
import { aiAnalysisBufferService } from '../../../services/ai-analysis-buffer.service';
import type { Tier2Insights } from '../../../types/ai-analysis.types';

jest.mock('../../../utils/ai-analysis.port.instance', () => ({
  aiAnalysisPort: {
    analyzeTier1: jest.fn(async (_transcripts: string[], _opts: any) => ({ analysisTimestamp: new Date().toISOString(), insights: [{ message: 'ok', severity: 'info' }] })),
    analyzeTier2: jest.fn(async (_transcripts: string[], _opts: any) => ({ analysisTimestamp: new Date().toISOString(), recommendations: [{ message: 'rec', priority: 'high' }] })),
  },
}));

jest.mock('../../../utils/event-bus.port.instance', () => ({
  eventBusPort: {
    emitToSession: jest.fn(),
  },
}));

const emitTier1Insight = jest.fn();
const emitTier2Insight = jest.fn();
const emitGuidanceAnalytics = jest.fn();

jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getGuidanceService: () => ({
      emitTier1Insight,
      emitTier2Insight,
      emitGuidanceAnalytics,
    })
  })
}));

// Avoid persistence side effects
jest.mock('../../../services/ai-insights-persistence.service', () => ({
  aiInsightsPersistenceService: {
    persistTier1: jest.fn(async () => {}),
    persistTier2: jest.fn(async () => {}),
  }
}));

import { redisService } from '../../../services/redis.service';
import { aiAnalysisPort } from '../../../utils/ai-analysis.port.instance';

describe('AIAnalysisTriggerService — dual emit to guidance', () => {
  const redisStore = new Map<string, string>();
  const mockGuidanceScripts = {
    energyWelford: jest.fn().mockResolvedValue({ mean: 1, variance: 1, count: 5 }),
    attentionGate: jest.fn().mockResolvedValue(true),
    promptStats: jest.fn().mockResolvedValue({ successRate: 0.5 }),
    autopromptCooldown: jest.fn().mockResolvedValue(true),
  };
  const mockRedisClient = {
    get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
    set: jest.fn(async function (this: unknown, key: string, value: string) {
      const args = Array.prototype.slice.call(arguments, 2);
      const hasNx = args.includes('NX');
      if (hasNx && redisStore.has(key)) {
        return null;
      }
      if (typeof value === 'string') {
        redisStore.set(key, value);
      }
      return 'OK';
    }),
    expire: jest.fn().mockResolvedValue(1),
    hgetall: jest.fn().mockResolvedValue({}),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redisStore.clear();
    process.env.GUIDANCE_TIER1_SUPPRESS_ONTRACK = '0';
    process.env.GUIDANCE_TIER2_SHIFT_ENABLED = '1';
    process.env.SLI_SESSION_TTL_SECONDS = '3600';
    jest.spyOn(redisService, 'getGuidanceScripts').mockReturnValue(mockGuidanceScripts as any);
    jest.spyOn(redisService, 'getClient').mockReturnValue(mockRedisClient as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.GUIDANCE_TIER1_SUPPRESS_ONTRACK;
    delete process.env.GUIDANCE_TIER2_SHIFT_ENABLED;
    delete process.env.SLI_SESSION_TTL_SECONDS;
    delete process.env.GUIDANCE_AUTO_PROMPTS;
    delete process.env.GUIDANCE_CONTEXT_ENRICHMENT;
    delete process.env.AI_GUIDANCE_DOMAIN_TERMS;
    delete process.env.AI_GUIDANCE_TITLECASE_TERMS;
    delete process.env.AI_GUIDANCE_TOPIC_STOPWORDS;
    delete process.env.AI_GUIDANCE_SUPPORTING_LINE_MAX_CHARS;
  });

  it('emits Tier1 insights to guidance namespace (canonical)', async () => {
    await aiAnalysisTriggerService.triggerTier1Analysis('g-1', 's-1', 't-1', ['one', 'two', 'three', 'four']);
    expect(emitTier1Insight).toHaveBeenCalled();
    const [, payload] = emitTier1Insight.mock.calls[0];
    expect(payload).toHaveProperty('groupId', 'g-1');
    expect(payload).toHaveProperty('sessionId', 's-1');
    // Session-level emission deprecated
  });

  it('emits Tier2 insights to guidance namespace', async () => {
    await aiAnalysisTriggerService.triggerTier2Analysis('g-2', 's-2', 't-2', new Array(10).fill('text'));
    expect(emitTier2Insight).toHaveBeenCalled();
    const [, payload] = emitTier2Insight.mock.calls[0];
    expect(payload).toHaveProperty('sessionId', 's-2');
  });

  it('produces paraphrased context anchored to the session goal', async () => {
    process.env.GUIDANCE_CONTEXT_ENRICHMENT = '1';
    process.env.GUIDANCE_AUTO_PROMPTS = '0';
    process.env.AI_GUIDANCE_DOMAIN_TERMS = 'Tier-2 analysis,Guidance v2,WaveListener engine,teacher insights,transcript evidence';
    process.env.AI_GUIDANCE_TITLECASE_TERMS = 'tier 2=Tier-2;guidance v2=Guidance v2;wave listener=WaveListener';
    process.env.AI_GUIDANCE_TOPIC_STOPWORDS = 'right,today,thing,things,like,kind,sort,essentially,uh,um,okay,alright';
    process.env.AI_GUIDANCE_SUPPORTING_LINE_MAX_CHARS = '80';

    const now = Date.now();
    const bufferSpy = jest.spyOn(aiAnalysisBufferService, 'getContextWindows').mockReturnValue({
      aligned: [
        { speakerLabel: 'Participant 1', text: 'We mapped Guidance v2 improvements for the WaveListener engine earlier.', timestamp: now - 60000 },
        { speakerLabel: 'Participant 2', text: 'Tier 2 analysis will confirm the new attention metric.', timestamp: now - 45000 },
      ],
      current: [
        { speakerLabel: 'Participant 3', text: 'Now we are chatting about weekend plans instead of the engine upgrades.', timestamp: now - 15000 },
        { speakerLabel: 'Participant 4', text: 'I am waiting for tier 2 analysis results before doing anything.', timestamp: now - 8000 },
      ],
      tangent: [
        { speakerLabel: 'Participant 3', text: 'Now we are chatting about weekend plans instead of the engine upgrades.', timestamp: now - 15000 },
        { speakerLabel: 'Participant 4', text: 'I am waiting for tier 2 analysis results before doing anything.', timestamp: now - 8000 },
      ],
      drift: { alignmentDelta: 0.22, persistentMs: 16000, priorAlignment: 0.65, currentAlignment: 0.43, lastAlignedAt: now - 45000 },
      inputQuality: { sttConfidence: 0.82, coverage: 0.7, alignmentDelta: 0.22, episodeCount: 2 },
      feature: 'legacy',
    } as any);

    (aiAnalysisPort.analyzeTier1 as jest.Mock).mockResolvedValueOnce({
      topicalCohesion: 0.35,
      conceptualDensity: 0.4,
      confidence: 0.72,
      offTopicHeat: 0.6,
      discussionMomentum: -0.1,
      confusionRisk: 0.3,
      energyLevel: 0.5,
      analysisTimestamp: new Date(now).toISOString(),
      windowStartTime: new Date(now - 30000).toISOString(),
      windowEndTime: new Date(now).toISOString(),
      transcriptLength: 320,
      insights: [],
    });

    await aiAnalysisTriggerService.triggerTier1Analysis(
      'group-context',
      'session-context',
      'teacher-context',
      ['students mention guidance v2 improvements repeatedly'],
      {
        goals: ['Guidance v2 improvements in WaveListener'],
      }
    );

    expect(emitTier1Insight).toHaveBeenCalled();
    const [, payload] = emitTier1Insight.mock.calls[emitTier1Insight.mock.calls.length - 1];
    const context = payload.insights?.context;
    expect(context).toBeDefined();
    expect(context?.reason).toContain('Guidance v2');
    expect(context?.reason).toContain('WaveListener');
    expect((context?.reason?.length || 0)).toBeGreaterThanOrEqual(70);
    expect(context?.transitionIdea).toContain('Guidance v2');
    expect(context?.supportingLines).toBeDefined();
    expect(context?.supportingLines?.length).toBeGreaterThan(0);
    context?.supportingLines?.forEach((line) => {
      expect(line.quote).not.toMatch(/["“”]/);
      expect(line.quote.length).toBeLessThanOrEqual(80);
    });

    bufferSpy.mockRestore();
  });

  it('emits attention analytics when metrics available', async () => {
    (aiAnalysisPort.analyzeTier1 as jest.Mock).mockResolvedValueOnce({
      topicalCohesion: 0.3,
      conceptualDensity: 0.5,
      offTopicHeat: 0.6,
      discussionMomentum: -0.2,
      confusionRisk: 0.4,
      energyLevel: 0.5,
      analysisTimestamp: new Date().toISOString(),
      windowStartTime: new Date().toISOString(),
      windowEndTime: new Date().toISOString(),
      transcriptLength: 200,
      confidence: 0.9,
      insights: [],
    });

    await aiAnalysisTriggerService.triggerTier1Analysis('g-attn', 's-attn', 't-attn', ['one', 'two', 'three']);

    expect(emitGuidanceAnalytics).toHaveBeenCalled();
    const analyticsEvent = emitGuidanceAnalytics.mock.calls.find(([event]) => event.category === 'attention');
    expect(analyticsEvent).toBeDefined();
    const payload = analyticsEvent?.[0];
    expect(payload).toMatchObject({ category: 'attention', sessionId: 's-attn' });
    expect(payload?.metrics).toMatchObject({
      groupId: 'g-attn',
      attentionScore: expect.any(Number),
      topicalCohesion: expect.any(Number),
      conceptualDensity: expect.any(Number),
    });
    expect(() => new Date(payload!.timestamp!).toISOString()).not.toThrow();
  });

  it('increments redis unavailable metric and falls back when prompt pressure lookup fails', async () => {
    const nowIso = new Date().toISOString();
    (aiAnalysisPort.analyzeTier1 as jest.Mock).mockResolvedValueOnce({
      onTrackScore: 65,
      topicalCohesion: 0.3,
      conceptualDensity: 0.5,
      offTopicHeat: 0.6,
      discussionMomentum: -0.2,
      confusionRisk: 0.4,
      energyLevel: 0.5,
      analysisTimestamp: nowIso,
      windowStartTime: nowIso,
      windowEndTime: nowIso,
      transcriptLength: 180,
      confidence: 0.9,
      insights: [],
    });

    const incSpy = jest.spyOn((aiAnalysisTriggerService as any).guidanceRedisUnavailable, 'inc');
    mockRedisClient.hgetall.mockRejectedValueOnce(new Error('redis offline'));

    await aiAnalysisTriggerService.triggerTier1Analysis('g-redis', 's-redis', 't-redis', ['one', 'two', 'three']);

    expect(incSpy).toHaveBeenCalledWith({ component: 'attention_gate' });
    const attentionCall = mockGuidanceScripts.attentionGate.mock.calls[0]?.[0];
    expect(attentionCall).toBeDefined();
    expect(typeof attentionCall.score).toBe('number');
    expect(attentionCall.score).toBeGreaterThan(0);
    incSpy.mockRestore();
  });

  it('emits tier2 shift analytics when thresholds exceeded', async () => {
    const baseInsights = {
      argumentationQuality: { score: 0.8, claimEvidence: 0.8, logicalFlow: 0.8, counterarguments: 0.8, synthesis: 0.8 },
      collectiveEmotionalArc: { trajectory: 'stable', averageEngagement: 0.7, energyPeaks: [], sentimentFlow: [] },
      collaborationPatterns: { turnTaking: 0.8, buildingOnIdeas: 0.8, conflictResolution: 0.8, inclusivity: 0.8 },
      learningSignals: { conceptualGrowth: 0.5, questionQuality: 0.5, metacognition: 0.5, knowledgeApplication: 0.5 },
      analysisTimestamp: new Date().toISOString(),
      sessionStartTime: new Date().toISOString(),
      analysisEndTime: new Date().toISOString(),
      totalTranscriptLength: 400,
      groupsAnalyzed: ['g-shift'],
      confidence: 0.9,
      recommendations: [],
    } as Tier2Insights;

    const shiftedInsights = {
      ...baseInsights,
      collectiveEmotionalArc: { ...baseInsights.collectiveEmotionalArc, trajectory: 'descending' as const },
      collaborationPatterns: { ...baseInsights.collaborationPatterns, inclusivity: 0.5, buildingOnIdeas: 0.5 },
      learningSignals: { ...baseInsights.learningSignals, conceptualGrowth: 0.9, questionQuality: 0.8 },
    } as Tier2Insights;

    (aiAnalysisPort.analyzeTier2 as jest.Mock)
      .mockResolvedValueOnce(baseInsights)
      .mockResolvedValueOnce(shiftedInsights);

    await aiAnalysisTriggerService.triggerTier2Analysis('g-shift', 's-shift', 't-shift', new Array(10).fill('text'));
    emitGuidanceAnalytics.mockClear();

    await aiAnalysisTriggerService.triggerTier2Analysis('g-shift', 's-shift', 't-shift', new Array(10).fill('text'));

    const shiftEvent = emitGuidanceAnalytics.mock.calls.find(([event]) => event.category === 'tier2-shift');
    expect(shiftEvent).toBeDefined();
    const shiftPayload = shiftEvent?.[0];
    expect(shiftPayload).toMatchObject({ category: 'tier2-shift', sessionId: 's-shift' });
    expect(shiftPayload?.metrics).toMatchObject({
      groupId: 'g-shift',
      metric: expect.any(String),
      previous: expect.any(Number),
      current: expect.any(Number),
      threshold: expect.any(Number),
    });
    expect(() => new Date(shiftPayload!.timestamp!).toISOString()).not.toThrow();
  });
});
