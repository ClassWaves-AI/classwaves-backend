import { aiAnalysisTriggerService } from '../../../services/ai-analysis-trigger.service';

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

jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getGuidanceService: () => ({
      emitTier1Insight,
      emitTier2Insight,
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

describe('AIAnalysisTriggerService — dual emit to guidance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    await aiAnalysisTriggerService.triggerTier2Analysis('s-2', 't-2', new Array(10).fill('text'));
    expect(emitTier2Insight).toHaveBeenCalled();
    const [, payload] = emitTier2Insight.mock.calls[0];
    expect(payload).toHaveProperty('sessionId', 's-2');
  });
});
