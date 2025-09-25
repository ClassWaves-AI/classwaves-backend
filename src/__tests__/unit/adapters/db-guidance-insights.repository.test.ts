import type { DbPort } from '../../../services/ports/db.port';
import { createDbGuidanceInsightsRepository } from '../../../adapters/repositories/db-guidance-insights.repository';

const dbFns = {
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

describe('DbGuidanceInsightsRepository', () => {
  const mockDb = dbFns as unknown as jest.Mocked<DbPort>;
  const repository = createDbGuidanceInsightsRepository(mockDb);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses tier1 snippets with JSON payload', async () => {
    const analysisTimestamp = new Date('2025-09-25T10:00:00Z');
    dbFns.query.mockResolvedValueOnce([
      {
        analysis_timestamp: analysisTimestamp,
        result_data: JSON.stringify({
          insights: [{ message: 'Strong collaboration' }],
          groupId: 'group-1',
        }),
        group_id: 'group-1',
        group_name: 'Team Alpha',
      },
      {
        analysis_timestamp: analysisTimestamp,
        result_data: JSON.stringify({ insights: [] }),
        group_id: null,
        group_name: null,
      },
    ]);

    const snippets = await repository.listTier1SnippetsBySession('session-1', 10);
    expect(dbFns.query).toHaveBeenCalledTimes(1);
    expect(snippets).toHaveLength(1);
    expect(snippets[0]).toMatchObject({
      groupId: 'group-1',
      groupName: 'Team Alpha',
      text: 'Strong collaboration',
    });
    expect(snippets[0].timestamp).toBeInstanceOf(Date);
  });

  it('parses tier1 snippets when result_data is already an object', async () => {
    const analysisTimestamp = new Date('2025-09-25T11:00:00Z');
    dbFns.query.mockResolvedValueOnce([
      {
        analysis_timestamp: analysisTimestamp,
        result_data: {
          insights: [{ message: 'Stay on topic' }],
          groupId: 'group-2',
        },
        group_id: null,
        group_name: 'Team Beta',
      },
    ]);

    const snippets = await repository.listTier1ByGroup('session-1', 'group-2', 5);
    expect(snippets).toHaveLength(1);
    expect(snippets[0]).toMatchObject({
      groupId: 'group-2',
      groupName: 'Team Beta',
      text: 'Stay on topic',
    });
  });

  it('returns latest tier2 with normalized timestamp', async () => {
    const ts = new Date('2025-09-25T12:30:00Z');
    dbFns.queryOne.mockResolvedValueOnce({
      analysis_timestamp: ts,
      result_data: JSON.stringify({ session_summary: { overall_effectiveness: 0.8 } }),
    });

    const tier2 = await repository.getLatestTier2BySession('session-1');
    expect(dbFns.queryOne).toHaveBeenCalledTimes(1);
    expect(tier2).toMatchObject({ session_summary: { overall_effectiveness: 0.8 }, timestamp: ts.toISOString() });
  });

  it('returns null when tier2 payload cannot be parsed', async () => {
    dbFns.queryOne.mockResolvedValueOnce({
      analysis_timestamp: new Date(),
      result_data: 'not-json',
    });
    const tier2 = await repository.getLatestTier2BySession('session-1');
    expect(tier2).toBeNull();
  });
});
