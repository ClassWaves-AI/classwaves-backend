import type { Tier1Options, Tier1Insights, Tier2Options, Tier2Insights } from '../types/ai-analysis.types';
import type { GroupSummary, SessionSummary } from '../types/ai-summaries.types';

export interface AIAnalysisPort {
  analyzeTier1(groupTranscripts: string[], options: Tier1Options): Promise<Tier1Insights>;
  analyzeTier2(sessionTranscripts: string[], options: Tier2Options): Promise<Tier2Insights>;
  summarizeGroup(groupTranscripts: string[], options: { sessionId: string; groupId: string }): Promise<GroupSummary>;
  summarizeSession(groupSummaries: GroupSummary[], options: { sessionId: string }): Promise<SessionSummary>;
}
