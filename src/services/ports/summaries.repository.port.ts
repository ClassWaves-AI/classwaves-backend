import type { GroupSummaryRecord, SessionSummaryRecord } from '../../types/ai-summaries.types';

export interface SummariesRepositoryPort {
  getSessionSummary(sessionId: string): Promise<SessionSummaryRecord | null>;
  getGroupSummary(sessionId: string, groupId: string): Promise<GroupSummaryRecord | null>;
  listGroupSummaries(sessionId: string): Promise<GroupSummaryRecord[]>;
  upsertGroupSummary(params: {
    id: string;
    sessionId: string;
    groupId: string;
    summaryJson: string;
    analysisTimestamp: Date;
  }): Promise<void>;
  upsertSessionSummary(params: {
    id: string;
    sessionId: string;
    summaryJson: string;
    analysisTimestamp: Date;
  }): Promise<void>;
}

