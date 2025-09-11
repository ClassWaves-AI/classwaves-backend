import type { GuidanceInsightsRepositoryPort, GuidanceTier1Snippet } from '../../services/ports/guidance-insights.repository.port';
import { databricksService } from '../../services/databricks.service';
import { databricksConfig } from '../../config/databricks.config';

/**
 * Databricks adapter for guidance insights lookups using analysis_results table.
 *
 * Projections only; no SELECT *.
 */
class DatabricksGuidanceInsightsRepository implements GuidanceInsightsRepositoryPort {
  async listTier1SnippetsBySession(sessionId: string, limit: number = 20): Promise<GuidanceTier1Snippet[]> {
    // Fetch latest Tier1 analyses for the session with minimal fields and join for group name
    const sql = `
      SELECT 
        r.analysis_timestamp as ts,
        get_json_object(r.result_data, '$.groupId') as group_json,
        g.name as group_name,
        get_json_object(r.result_data, '$.insights[0].message') as msg_json
      FROM ${databricksConfig.catalog}.ai_insights.analysis_results r
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_groups g
        ON g.id = get_json_object(r.result_data, '$.groupId')
      WHERE r.analysis_type = 'tier1'
        AND r.session_id = ?
      ORDER BY r.analysis_timestamp DESC
      LIMIT ?`;

    const rows = await databricksService.query(sql, [sessionId, limit]);
    return (rows || []).map((row: any) => {
      // JSON_EXTRACT returns quoted strings in many engines; strip quotes safely
      const rawGroupId = row.group_json ?? '';
      const rawMsg = row.msg_json ?? '';
      const groupId = String(rawGroupId).replace(/^"|"$/g, '');
      const text = String(rawMsg).replace(/^"|"$/g, '');
      return {
        timestamp: new Date(row.ts),
        groupId,
        groupName: row.group_name || undefined,
        text: text || 'Insight',
      } as GuidanceTier1Snippet;
    });
  }

  async getLatestTier2BySession(sessionId: string): Promise<any | null> {
    // Return minimal parsed object from latest Tier2
    const sql = `
      SELECT r.result_data, r.analysis_timestamp as ts
      FROM ${databricksConfig.catalog}.ai_insights.analysis_results r
      WHERE r.analysis_type = 'tier2'
        AND r.session_id = ?
      ORDER BY r.analysis_timestamp DESC
      LIMIT 1`;

    const row = await databricksService.queryOne(sql, [sessionId]);
    if (!row || !row.result_data) return null;
    try {
      const parsed = JSON.parse(row.result_data);
      // Attach timestamp for frontend convenience
      if (parsed && !parsed.timestamp) parsed.timestamp = new Date(row.ts).toISOString();
      return parsed;
    } catch {
      return null;
    }
  }

  async listTier1ByGroup(sessionId: string, groupId: string, limit: number = 20): Promise<GuidanceTier1Snippet[]> {
    const sql = `
      SELECT 
        r.analysis_timestamp as ts,
        get_json_object(r.result_data, '$.groupId') as group_json,
        g.name as group_name,
        get_json_object(r.result_data, '$.insights[0].message') as msg_json
      FROM ${databricksConfig.catalog}.ai_insights.analysis_results r
      LEFT JOIN ${databricksConfig.catalog}.sessions.student_groups g
        ON g.id = get_json_object(r.result_data, '$.groupId')
      WHERE r.analysis_type = 'tier1'
        AND r.session_id = ?
        AND get_json_object(r.result_data, '$.groupId') = ?
      ORDER BY r.analysis_timestamp DESC
      LIMIT ?`;

    const rows = await databricksService.query(sql, [sessionId, groupId, limit]);
    return (rows || []).map((row: any) => {
      const rawGroupId = row.group_json ?? '';
      const rawMsg = row.msg_json ?? '';
      const groupIdParsed = String(rawGroupId).replace(/^"|"$/g, '');
      const text = String(rawMsg).replace(/^"|"$/g, '');
      return {
        timestamp: new Date(row.ts),
        groupId: groupIdParsed,
        groupName: row.group_name || undefined,
        text: text || 'Insight',
      } as GuidanceTier1Snippet;
    });
  }
}

export const guidanceInsightsRepository: GuidanceInsightsRepositoryPort = new DatabricksGuidanceInsightsRepository();
