import { aiAnalysisTriggerService } from '../../../services/ai-analysis-trigger.service';

const recordSuccess = jest.fn();
const recordFailure = jest.fn();

jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getGuidanceService: () => ({
      emitTeacherRecommendations: jest.fn(),
      emitTier1Insight: jest.fn(),
      emitTier2Insight: jest.fn(),
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
    generatePrompts: jest.fn(async () => ([{ id: 'px', message: 'Do think-pair-share', priority: 'high', category: 'collaboration' }]))
  }
}));

jest.mock('../../../services/guidance-system-health.service', () => ({
  guidanceSystemHealthService: {
    recordSuccess: (...args: any[]) => recordSuccess(...args),
    recordFailure: (...args: any[]) => recordFailure(...args),
  }
}));

describe('AIAnalysisTriggerService — prompt generation metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GUIDANCE_AUTO_PROMPTS = '1';
  });

  it('records success metrics for Tier1 prompt generation', async () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    await aiAnalysisTriggerService.triggerTier1Analysis(uuid, uuid, uuid, ['enough text here']);
    expect(recordSuccess).toHaveBeenCalledWith('promptGeneration', 'autoprompt_tier1', expect.any(Number));
  });
});

