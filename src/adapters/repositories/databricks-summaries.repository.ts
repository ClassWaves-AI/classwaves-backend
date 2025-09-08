import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';
import type { SummariesRepositoryPort } from '../../services/ports/summaries.repository.port';
import type { GroupSummaryRecord, SessionSummaryRecord } from '../../types/ai-summaries.types';

export class DatabricksSummariesRepository implements SummariesRepositoryPort {
  async getSessionSummary(sessionId: string): Promise<SessionSummaryRecord | null> {
    const sql = `SELECT id, session_id, summary_json, analysis_timestamp, created_at
      FROM ${databricksConfig.catalog}.ai_insights.session_summaries
      WHERE session_id = ?
      ORDER BY analysis_timestamp DESC
      LIMIT 1`;
    return await databricksService.queryOne(sql, [sessionId]);
  }

  async getGroupSummary(sessionId: string, groupId: string): Promise<GroupSummaryRecord | null> {
    const sql = `SELECT id, session_id, group_id, summary_json, analysis_timestamp, created_at
      FROM ${databricksConfig.catalog}.ai_insights.group_summaries
      WHERE session_id = ? AND group_id = ?
      ORDER BY analysis_timestamp DESC
      LIMIT 1`;
    return await databricksService.queryOne(sql, [sessionId, groupId]);
  }

  async listGroupSummaries(sessionId: string): Promise<GroupSummaryRecord[]> {
    const sql = `SELECT id, session_id, group_id, summary_json, analysis_timestamp, created_at
      FROM ${databricksConfig.catalog}.ai_insights.group_summaries
      WHERE session_id = ?`;
    return await databricksService.query(sql, [sessionId]);
  }

  async upsertGroupSummary(params: { id: string; sessionId: string; groupId: string; summaryJson: string; analysisTimestamp: Date; }): Promise<void> {
    await databricksService.upsert('ai_insights.group_summaries', { id: params.id }, {
      id: params.id,
      session_id: params.sessionId,
      group_id: params.groupId,
      summary_json: params.summaryJson,
      analysis_timestamp: params.analysisTimestamp,
      created_at: new Date()
    });
  }

  async upsertSessionSummary(params: { id: string; sessionId: string; summaryJson: string; analysisTimestamp: Date; }): Promise<void> {
    await databricksService.upsert('ai_insights.session_summaries', { id: params.id }, {
      id: params.id,
      session_id: params.sessionId,
      summary_json: params.summaryJson,
      analysis_timestamp: params.analysisTimestamp,
      created_at: new Date()
    });
  }
}

export const summariesRepository: SummariesRepositoryPort = new DatabricksSummariesRepository();

