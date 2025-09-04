import { aiInsightsPersistenceService } from '../../../services/ai-insights-persistence.service';

// Mock databricksService
jest.mock('../../../services/databricks.service', () => {
  return {
    databricksService: {
      queryOne: jest.fn(),
      insert: jest.fn(),
    },
  };
});

import { databricksService } from '../../../services/databricks.service';

describe('AIInsightsPersistenceService (idempotency)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('persists Tier1 once and skips duplicates by idempotency key', async () => {
    const sessionId = 'sess-123';
    const groupId = 'group-1';
    const insights: any = {
      topicalCohesion: 0.7,
      conceptualDensity: 0.55,
      analysisTimestamp: new Date().toISOString(),
      windowStartTime: new Date(Date.now() - 30000).toISOString(),
      windowEndTime: new Date().toISOString(),
      transcriptLength: 200,
      confidence: 0.9,
      insights: [],
      metadata: { processingTimeMs: 500, modelVersion: 'test' },
    };

    // First call: no existing row
    (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(null);

    const persisted1 = await aiInsightsPersistenceService.persistTier1(
      sessionId,
      groupId,
      insights
    );
    expect(persisted1).toBe(true);
    expect(databricksService.insert).toHaveBeenCalledTimes(1);

    // Second call with same params: simulate existing row now
    (databricksService.queryOne as jest.Mock).mockResolvedValueOnce({ id: 'existing' });
    const persisted2 = await aiInsightsPersistenceService.persistTier1(
      sessionId,
      groupId,
      insights
    );
    expect(persisted2).toBe(false);
    expect(databricksService.insert).toHaveBeenCalledTimes(1); // still only once
  });

  it('persists Tier2 once and skips duplicates by idempotency key', async () => {
    const sessionId = 'sess-456';
    const insights: any = {
      argumentationQuality: { score: 0.6, claimEvidence: 0.5, logicalFlow: 0.7, counterarguments: 0.4, synthesis: 0.6 },
      collectiveEmotionalArc: { trajectory: 'stable', averageEngagement: 0.5, energyPeaks: [], sentimentFlow: [] },
      collaborationPatterns: { turnTaking: 0.5, buildingOnIdeas: 0.6, conflictResolution: 0.5, inclusivity: 0.7 },
      learningSignals: { conceptualGrowth: 0.6, questionQuality: 0.5, metacognition: 0.5, knowledgeApplication: 0.6 },
      analysisTimestamp: new Date().toISOString(),
      sessionStartTime: new Date(Date.now() - 3 * 60_000).toISOString(),
      analysisEndTime: new Date().toISOString(),
      totalTranscriptLength: 1000,
      groupsAnalyzed: ['all'],
      confidence: 0.82,
      recommendations: [],
      metadata: { processingTimeMs: 1600, modelVersion: 'test' },
    };

    // First call: no existing row
    (databricksService.queryOne as jest.Mock).mockResolvedValueOnce(null);
    const persisted1 = await aiInsightsPersistenceService.persistTier2(sessionId, insights);
    expect(persisted1).toBe(true);
    expect(databricksService.insert).toHaveBeenCalledTimes(1);

    // Second call with same params: simulate existing row
    (databricksService.queryOne as jest.Mock).mockResolvedValueOnce({ id: 'exists' });
    const persisted2 = await aiInsightsPersistenceService.persistTier2(sessionId, insights);
    expect(persisted2).toBe(false);
    expect(databricksService.insert).toHaveBeenCalledTimes(1);
  });
});

