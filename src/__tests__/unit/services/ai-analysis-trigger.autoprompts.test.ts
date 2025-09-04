import { aiAnalysisTriggerService } from '../../../services/ai-analysis-trigger.service';

// Mocks
const emitTeacherRecommendations = jest.fn();

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
    generatePrompts: jest.fn(async () => ([{ id: 'p1', message: 'Try think-pair-share', priority: 'high', category: 'collaboration' }]))
  }
}));

describe('AIAnalysisTriggerService — auto prompt generation (Tier1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates and emits teacher prompts after Tier1 insights', async () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    // Call Tier1 directly with valid UUIDs to pass Zod in prompt service
    await aiAnalysisTriggerService.triggerTier1Analysis(uuid, uuid, uuid, ['enough text here']);
    expect(emitTeacherRecommendations).toHaveBeenCalled();
  });
});

