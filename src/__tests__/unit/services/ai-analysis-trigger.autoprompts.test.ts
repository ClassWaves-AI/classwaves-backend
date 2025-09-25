import { aiAnalysisTriggerService } from '../../../services/ai-analysis-trigger.service';
import * as client from 'prom-client';

// Mocks
const emitTeacherRecommendations = jest.fn();
const generatePromptsMock = jest
  .fn()
  .mockResolvedValue([
    {
      id: 'p1',
      sessionId: 'foo',
      teacherId: 'bar',
      category: 'collaboration',
      priority: 'high',
      message: 'Try think-pair-share',
      context: 'Focus back on the learning goal',
      suggestedTiming: 'immediate',
      generatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60000),
      sessionPhase: 'development',
      subject: 'general',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);
const defaultContextWindows = {
  aligned: [],
  current: [],
  tangent: [],
  drift: { alignmentDelta: 0, persistentMs: 0, priorAlignment: 0, currentAlignment: 0, lastAlignedAt: null },
  inputQuality: { sttConfidence: 0, coverage: 0, alignmentDelta: 0, episodeCount: 0 },
  feature: 'legacy',
};
const getContextWindowsMock = jest.fn().mockImplementation(() => ({
  aligned: [],
  current: [],
  tangent: [],
  drift: { ...defaultContextWindows.drift },
  inputQuality: { ...defaultContextWindows.inputQuality },
  feature: 'legacy',
}));
const markBufferAnalyzedMock = jest.fn().mockResolvedValue(undefined);
const getLastBufferedAtMock = jest.fn().mockReturnValue(new Date());

jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getGuidanceService: () => ({
      emitTeacherRecommendations,
    })
  })
}));

jest.mock('../../../utils/ai-analysis.port.instance', () => ({
  aiAnalysisPort: {
    analyzeTier1: jest.fn(async (_transcripts: string[], _opts: any) => ({ analysisTimestamp: new Date().toISOString(), insights: [] })),
  },
}));

jest.mock('../../../services/teacher-prompt.service', () => ({
  teacherPromptService: {
    generatePrompts: (...args: any[]) => generatePromptsMock(...args),
  }
}));

jest.mock('../../../services/ai-analysis-buffer.service', () => ({
  aiAnalysisBufferService: {
    getContextWindows: (...args: any[]) => getContextWindowsMock(...args),
    markBufferAnalyzed: (...args: any[]) => markBufferAnalyzedMock(...args),
    getLastBufferedAt: (...args: any[]) => getLastBufferedAtMock(...args),
  }
}));

describe('AIAnalysisTriggerService — auto prompt generation (Tier1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GUIDANCE_TIER1_SUPPRESS_ONTRACK = '0';
    process.env.GUIDANCE_CONTEXT_ENRICHMENT = '0';
    process.env.GUIDANCE_ONTRACK_SUMMARIES_ENABLED = '0';
  });

  afterEach(() => {
    delete process.env.GUIDANCE_TIER1_SUPPRESS_ONTRACK;
    delete process.env.GUIDANCE_CONTEXT_ENRICHMENT;
    delete process.env.GUIDANCE_ONTRACK_SUMMARIES_ENABLED;
    delete process.env.GUIDANCE_CONTEXT_REDACT_EXACT_QUOTES;
    delete process.env.CW_GUIDANCE_EPISODES_ENABLED;
    delete process.env.AI_GUIDANCE_ALIGNMENT_MIN_DELTA;
    delete process.env.AI_GUIDANCE_DRIFT_PERSISTENCE_MS;
  });

  it('generates and emits teacher prompts after Tier1 insights', async () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    // Call Tier1 directly with valid UUIDs to pass Zod in prompt service
    await aiAnalysisTriggerService.triggerTier1Analysis(uuid, uuid, uuid, ['enough text here']);
    expect(emitTeacherRecommendations).toHaveBeenCalled();
  });

  it('passes structured context extras and on-track summary to prompt generation when enabled', async () => {
    const { aiAnalysisPort } = require('../../../utils/ai-analysis.port.instance');
    (aiAnalysisPort.analyzeTier1 as jest.Mock).mockResolvedValueOnce({
      analysisTimestamp: new Date().toISOString(),
      insights: [],
      topicalCohesion: 0.82,
      conceptualDensity: 0.8,
      confidence: 0.92,
      discussionMomentum: 0.1,
      context: {
        reason: 'Recent discussion: tangent',
        quotes: [
          {
            speakerLabel: 'Participant 99',
            text: 'Provider supplied quote.',
            timestamp: new Date().toISOString(),
          },
        ],
        confidence: 0.9,
      },
    });

    getContextWindowsMock.mockReturnValueOnce({
      aligned: [
        { speakerLabel: 'Participant 1', text: 'Discussing photosynthesis and plant cells.', timestamp: Date.now() - 4000 },
      ],
      current: [
        { speakerLabel: 'Participant 2', text: 'Chatting about weekend soccer practice instead.', timestamp: Date.now() - 2000 },
      ],
      tangent: [
        { speakerLabel: 'Participant 2', text: 'Chatting about weekend soccer practice instead.', timestamp: Date.now() - 2000 },
      ],
      drift: { alignmentDelta: 0.2, persistentMs: 12000, priorAlignment: 0.6, currentAlignment: 0.4, lastAlignedAt: Date.now() - 4000 },
      inputQuality: { sttConfidence: 0.8, coverage: 0.6, alignmentDelta: 0.2, episodeCount: 2 },
      feature: 'legacy',
    });

    process.env.GUIDANCE_CONTEXT_ENRICHMENT = '1';
    process.env.GUIDANCE_ONTRACK_SUMMARIES_ENABLED = '1';

    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    await aiAnalysisTriggerService.triggerTier1Analysis(uuid, uuid, uuid, ['enough text here']);

    expect(generatePromptsMock).toHaveBeenCalled();
    const analyzeCall = (aiAnalysisPort.analyzeTier1 as jest.Mock).mock.calls[0];
    expect(analyzeCall?.[1]?.evidenceWindows).toMatchObject({
      aligned: expect.any(Array),
      tangent: expect.any(Array),
    });

    const [, , options] = generatePromptsMock.mock.calls[0];
    expect(options).toBeDefined();
    expect(options?.extras?.context?.reason).toEqual(expect.any(String));
    expect(options?.extras?.why).toEqual(
      expect.objectContaining({
        alignmentDelta: expect.any(Number),
        driftSeconds: expect.any(Number),
        inputQuality: expect.any(Number),
      })
    );
    expect(options?.extras?.context?.quotes?.length ?? 0).toBeGreaterThan(0);
    expect(options?.extras?.context?.supportingLines?.length ?? 0).toBeGreaterThan(0);
    expect(options?.extras?.onTrackSummary).toMatch(/on track/i);
  });

  it('builds paraphrased context heuristics when provider omits context', async () => {
    const { aiAnalysisPort } = require('../../../utils/ai-analysis.port.instance');
    (aiAnalysisPort.analyzeTier1 as jest.Mock).mockResolvedValueOnce({
      analysisTimestamp: new Date().toISOString(),
      insights: [],
      topicalCohesion: 0.42,
      conceptualDensity: 0.38,
      confidence: 0.6,
    });

    const alignedText = 'Students compared photosynthesis steps using diagrams.';
    const tangentText = 'They planned weekend soccer drills and strategy plays together.';
    getContextWindowsMock.mockReturnValueOnce({
      aligned: [{ speakerLabel: 'Participant 1', text: alignedText, timestamp: Date.now() - 4000 }],
      current: [
        { speakerLabel: 'Participant 2', text: tangentText, timestamp: Date.now() - 2000 },
        { speakerLabel: 'Participant 3', text: 'Another tangent about soccer uniforms and positions.', timestamp: Date.now() - 1000 },
      ],
      tangent: [
        { speakerLabel: 'Participant 2', text: tangentText, timestamp: Date.now() - 2000 },
        { speakerLabel: 'Participant 3', text: 'Another tangent about soccer uniforms and positions.', timestamp: Date.now() - 1000 },
      ],
      drift: { alignmentDelta: 0.18, persistentMs: 9000, priorAlignment: 0.55, currentAlignment: 0.37, lastAlignedAt: Date.now() - 4000 },
      inputQuality: { sttConfidence: 0.78, coverage: 0.5, alignmentDelta: 0.18, episodeCount: 2 },
      feature: 'legacy',
    });

    process.env.GUIDANCE_CONTEXT_ENRICHMENT = '1';
    process.env.GUIDANCE_CONTEXT_REDACT_EXACT_QUOTES = '1';

    const contextMetricBefore = client.register.getSingleMetric('guidance_context_paraphrase_total') as client.Counter<string> | undefined;
    const counterBeforeMetric = contextMetricBefore ? await contextMetricBefore.get() : undefined;
    const counterBefore = counterBeforeMetric?.values
      .filter((value) => value.labels.result === 'success')
      .reduce((sum, value) => sum + (value.value ?? 0), 0)
      ?? 0;

    const uuid = '123e4567-e89b-12d3-a456-426614174999';
    await aiAnalysisTriggerService.triggerTier1Analysis(uuid, uuid, uuid, ['enough text here']);

    const [, , options] = generatePromptsMock.mock.calls[0];
    const context = options?.extras?.context;
    expect(context).toBeDefined();
    expect(context?.reason).toBeDefined();
    expect(context?.reason?.length ?? 0).toBeLessThanOrEqual(160);
    expect(context?.priorTopic).toBeDefined();
    expect(context?.currentTopic).toBeDefined();
    expect(context?.supportingLines).toBeDefined();
    expect(context?.supportingLines?.length ?? 0).toBeLessThanOrEqual(3);
    expect(context?.quotes?.length ?? 0).toBeLessThanOrEqual(3);
    context?.supportingLines?.forEach((line: any) => {
      expect(line.quote).not.toMatch(/["“”]/);
      expect(line.quote).not.toBe(tangentText);
      expect(line.quote).not.toBe(alignedText);
    });
    context?.quotes?.forEach((line: any) => {
      expect(line.text).not.toMatch(/["“”]/);
      expect(line.text).not.toBe(tangentText);
      expect(line.text).not.toBe(alignedText);
    });

    const contextMetricAfter = client.register.getSingleMetric('guidance_context_paraphrase_total') as client.Counter<string> | undefined;
    const counterAfterMetric = contextMetricAfter ? await contextMetricAfter.get() : undefined;
    const counterAfter = counterAfterMetric?.values
      .filter((value) => value.labels.result === 'success')
      .reduce((sum, value) => sum + (value.value ?? 0), 0)
      ?? 0;
    expect(counterAfter).toBeGreaterThanOrEqual(counterBefore);
  });

  it('suppresses prompts when drift persistence is below threshold in episodes mode', async () => {
    const { aiAnalysisPort } = require('../../../utils/ai-analysis.port.instance');
    (aiAnalysisPort.analyzeTier1 as jest.Mock).mockResolvedValueOnce({
      analysisTimestamp: new Date().toISOString(),
      topicalCohesion: 0.4,
      conceptualDensity: 0.38,
      confidence: 0.9,
      insights: [],
    });

    process.env.CW_GUIDANCE_EPISODES_ENABLED = '1';
    process.env.AI_GUIDANCE_DRIFT_PERSISTENCE_MS = '15000';
    process.env.AI_GUIDANCE_ALIGNMENT_MIN_DELTA = '0.12';

    getContextWindowsMock.mockReturnValueOnce({
      aligned: [{ speakerLabel: 'Participant 1', text: 'Recalling last lesson objectives.', timestamp: Date.now() - 5000 }],
      current: [{ speakerLabel: 'Participant 2', text: 'Talking about weekend games.', timestamp: Date.now() - 1000 }],
      tangent: [{ speakerLabel: 'Participant 2', text: 'Talking about weekend games.', timestamp: Date.now() - 1000 }],
      drift: { alignmentDelta: 0.2, persistentMs: 4000, priorAlignment: 0.55, currentAlignment: 0.35, lastAlignedAt: Date.now() - 5000 },
      inputQuality: { sttConfidence: 0.8, coverage: 0.3, alignmentDelta: 0.2, episodeCount: 2 },
      feature: 'episodes',
    });

    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    await aiAnalysisTriggerService.triggerTier1Analysis(uuid, uuid, uuid, ['enough text here']);

    expect(generatePromptsMock).not.toHaveBeenCalled();
    expect(emitTeacherRecommendations).not.toHaveBeenCalled();
  });

  it('emits prompts when drift persistence and alignment thresholds are satisfied in episodes mode', async () => {
    const { aiAnalysisPort } = require('../../../utils/ai-analysis.port.instance');
    (aiAnalysisPort.analyzeTier1 as jest.Mock).mockResolvedValueOnce({
      analysisTimestamp: new Date().toISOString(),
      topicalCohesion: 0.45,
      conceptualDensity: 0.4,
      confidence: 0.85,
      insights: [],
    });

    process.env.CW_GUIDANCE_EPISODES_ENABLED = '1';
    process.env.AI_GUIDANCE_DRIFT_PERSISTENCE_MS = '12000';
    process.env.AI_GUIDANCE_ALIGNMENT_MIN_DELTA = '0.12';

    getContextWindowsMock.mockReturnValueOnce({
      aligned: [{ speakerLabel: 'Participant 1', text: 'Connecting the concept to the goal.', timestamp: Date.now() - 25000 }],
      current: [{ speakerLabel: 'Participant 2', text: 'Side conversation on unrelated sports.', timestamp: Date.now() - 1000 }],
      tangent: [{ speakerLabel: 'Participant 2', text: 'Side conversation on unrelated sports.', timestamp: Date.now() - 1000 }],
      drift: { alignmentDelta: 0.2, persistentMs: 18000, priorAlignment: 0.6, currentAlignment: 0.4, lastAlignedAt: Date.now() - 25000 },
      inputQuality: { sttConfidence: 0.82, coverage: 0.55, alignmentDelta: 0.2, episodeCount: 2 },
      feature: 'episodes',
    });

    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    await aiAnalysisTriggerService.triggerTier1Analysis(uuid, uuid, uuid, ['enough text here']);

    expect(generatePromptsMock).toHaveBeenCalled();
    expect(emitTeacherRecommendations).toHaveBeenCalled();
  });
});
