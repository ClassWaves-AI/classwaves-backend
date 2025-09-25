const mockDbPort = {
  query: jest.fn(),
  queryOne: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  upsert: jest.fn(),
  tableHasColumns: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  withTransaction: jest.fn(),
  generateId: jest.fn(),
};

jest.mock('../../../app/composition-root', () => {
  return {
    getCompositionRoot: () => ({
      getDbPort: () => mockDbPort,
      getDbProvider: () => 'postgres',
    }),
  };
});

import { aiInsightsPersistenceService } from '../../../services/ai-insights-persistence.service';

describe('AIInsightsPersistenceService (idempotency)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbPort.query.mockReset();
    mockDbPort.queryOne.mockReset();
    mockDbPort.insert.mockReset();
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
    mockDbPort.queryOne.mockResolvedValueOnce(null);

    const persisted1 = await aiInsightsPersistenceService.persistTier1(
      sessionId,
      groupId,
      insights
    );
    expect(persisted1).toBe(true);
    expect(mockDbPort.insert).toHaveBeenCalledTimes(1);
    expect(mockDbPort.insert).toHaveBeenCalledWith(
      'ai_insights.analysis_results',
      expect.objectContaining({
        id: expect.any(String),
        session_id: sessionId,
        analysis_type: 'tier1',
        group_id: groupId,
      }),
      expect.objectContaining({ operation: 'analysis_results.insert_tier1' })
    );

    // Second call with same params: simulate existing row now
    mockDbPort.queryOne.mockResolvedValueOnce({ id: 'existing' });
    const persisted2 = await aiInsightsPersistenceService.persistTier1(
      sessionId,
      groupId,
      insights
    );
    expect(persisted2).toBe(false);
    expect(mockDbPort.insert).toHaveBeenCalledTimes(1); // still only once
  });

  it('persists Tier2 once and skips duplicates by idempotency key (group-scoped)', async () => {
    const sessionId = 'sess-456';
    const groupId = 'group-xyz';
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
    mockDbPort.queryOne.mockResolvedValueOnce(null);
    const persisted1 = await aiInsightsPersistenceService.persistTier2(sessionId, insights, groupId);
    expect(persisted1).toBe(true);
    expect(mockDbPort.insert).toHaveBeenCalledTimes(1);
    expect(mockDbPort.insert).toHaveBeenLastCalledWith(
      'ai_insights.analysis_results',
      expect.objectContaining({
        analysis_type: 'tier2',
        group_id: groupId,
      }),
      expect.objectContaining({ operation: 'analysis_results.insert_tier2' })
    );

    // Second call with same params: simulate existing row
    mockDbPort.queryOne.mockResolvedValueOnce({ id: 'exists' });
    const persisted2 = await aiInsightsPersistenceService.persistTier2(sessionId, insights, groupId);
    expect(persisted2).toBe(false);
    expect(mockDbPort.insert).toHaveBeenCalledTimes(1);
  });
});
