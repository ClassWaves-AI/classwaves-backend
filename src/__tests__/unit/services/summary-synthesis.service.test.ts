import { SummarySynthesisService } from '../../../services/summary-synthesis.service';

jest.mock('../../../app/composition-root', () => {
  // Provide a minimal in-memory repository and AI port for tests
  const groups = ['g1', 'g2'];
  const stored: { group: Record<string, any>; session?: any } = { group: {} };
  const summariesRepo = {
    getSessionSummary: async (sessionId: string) => stored.session ? ({
      id: 'ss1', session_id: sessionId, summary_json: JSON.stringify(stored.session), analysis_timestamp: new Date(), created_at: new Date()
    }) as any : null,
    getGroupSummary: async (sessionId: string, groupId: string) => stored.group[groupId] ? ({
      id: 'gs1', session_id: sessionId, group_id: groupId, summary_json: JSON.stringify(stored.group[groupId]), analysis_timestamp: new Date(), created_at: new Date()
    }) as any : null,
    listGroupSummaries: async (sessionId: string) => Object.entries(stored.group).map(([gid, json]) => ({
      id: 'gs-' + gid, session_id: sessionId, group_id: gid, summary_json: JSON.stringify(json), analysis_timestamp: new Date(), created_at: new Date()
    })) as any,
    upsertGroupSummary: async ({ groupId, summaryJson }: any) => { stored.group[groupId] = JSON.parse(summaryJson); },
    upsertSessionSummary: async ({ summaryJson }: any) => { stored.session = JSON.parse(summaryJson); },
  };
  const aiPort = {
    summarizeGroup: async (transcripts: string[], { sessionId, groupId }: any) => ({ overview: `Summary for ${groupId}`, metadata: { transcriptCount: transcripts.length }, analysisTimestamp: new Date().toISOString() }),
    summarizeSession: async (groupSummaries: any[], { sessionId }: any) => ({ themes: ['theme1'], group_breakdown: groupSummaries.map(g => ({ groupId: g.groupId, summarySnippet: g.overview })), analysisTimestamp: new Date().toISOString() }),
  };
  const groupRepo = { getGroupsBasic: async (sessionId: string) => groups.map(id => ({ id })) };
  const sessionRepo = { getOwnedSessionBasic: async (id: string, t: string) => ({ id }) };
  return {
    getCompositionRoot: () => ({
      getSummariesRepository: () => summariesRepo,
      getAIAnalysisPort: () => aiPort,
      getGroupRepository: () => groupRepo,
      getSessionRepository: () => sessionRepo,
    })
  };
});

jest.mock('../../../services/databricks.service', () => {
  return {
    databricksService: {
      query: async (sql: string, params: any[]) => {
        // Return two transcripts per group
        const groupId = params[1];
        return [
          { content: `Transcript A for ${groupId}` },
          { content: `Transcript B for ${groupId}` },
        ];
      },
    }
  };
});

describe('SummarySynthesisService', () => {
  it('generates group and session summaries and stores them', async () => {
    const svc = new SummarySynthesisService();
    await svc.runSummariesForSession('s1');
    // Verify repository calls via composition root mock
    const { getCompositionRoot } = require('../../../app/composition-root');
    const repo = getCompositionRoot().getSummariesRepository();
    const g1 = await repo.getGroupSummary('s1', 'g1');
    const g2 = await repo.getGroupSummary('s1', 'g2');
    expect(g1).toBeTruthy();
    expect(g2).toBeTruthy();
    const ss = await repo.getSessionSummary('s1');
    expect(ss).toBeTruthy();
  });
});

