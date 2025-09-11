import { getCompositionRoot } from '../app/composition-root';
import { databricksService } from './databricks.service';
import { databricksConfig } from '../config/databricks.config';
import { createHash } from 'crypto';
import { getSummaryGeneratedCounter, getSummaryFailedCounter, getSummaryLatencyHistogram } from '../metrics/summary.metrics';

export class SummarySynthesisService {
  private maxGroupConcurrency = parseInt(process.env.SUMMARY_GROUP_CONCURRENCY || '4', 10);
  private async computeGuidanceCounts(sessionId: string): Promise<{ highPriorityCount: number; tier2Count: number }> {
    try {
      const row = await databricksService.queryOne<{ hp: any; t2: any }>(
        `SELECT 
           COALESCE(SUM(CASE WHEN priority_level = 'high' THEN 1 ELSE 0 END), 0) AS hp,
           COALESCE((SELECT COUNT(1) FROM ${databricksConfig.catalog}.ai_insights.analysis_results ar 
                     WHERE ar.session_id = ? AND ar.analysis_type = 'tier2'), 0) AS t2
         FROM ${databricksConfig.catalog}.ai_insights.teacher_guidance_metrics gm
         WHERE gm.session_id = ?`,
         [sessionId, sessionId]
      );
      const toInt = (v: any) => {
        if (v === null || v === undefined) return 0;
        const n = parseInt(String(v), 10);
        return Number.isFinite(n) ? n : 0;
      };
      return { highPriorityCount: toInt(row?.hp), tier2Count: toInt(row?.t2) };
    } catch {
      return { highPriorityCount: 0, tier2Count: 0 };
    }
  }

  async summarizeGroup(sessionId: string, groupId: string): Promise<void> {
    const start = Date.now();
    try {
      const transcripts = await this.fetchGroupTranscripts(sessionId, groupId);
      if (transcripts.length === 0) {
        throw new Error('NO_TRANSCRIPTS');
      }
      const ai = getCompositionRoot().getAIAnalysisPort();
      const summary = await ai.summarizeGroup(transcripts, { sessionId, groupId });
      const id = this.buildId('group', sessionId, groupId, summary?.analysisTimestamp);
      await getCompositionRoot().getSummariesRepository().upsertGroupSummary({
        id,
        sessionId,
        groupId,
        summaryJson: JSON.stringify(summary),
        analysisTimestamp: new Date(summary?.analysisTimestamp || new Date().toISOString())
      });
      try { getSummaryGeneratedCounter().inc({ type: 'group' }); } catch {}
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)) || 'unknown_error';
      try { getSummaryFailedCounter().inc({ type: 'group', reason }); } catch {}
      throw error;
    } finally {
      try { getSummaryLatencyHistogram().observe({ type: 'group' }, Date.now() - start); } catch {}
    }
  }

  async summarizeSessionFromGroups(sessionId: string): Promise<void> {
    const start = Date.now();
    try {
      const repo = getCompositionRoot().getSummariesRepository();
      const groups = await repo.listGroupSummaries(sessionId);
      if (!groups || groups.length === 0) {
        throw new Error('NO_GROUP_SUMMARIES');
      }
      const groupSummaries = groups.map(g => ({ groupId: g.group_id, ...(safeParse(g.summary_json) || {}) }));
      const ai = getCompositionRoot().getAIAnalysisPort();
      const sessionSummary = await ai.summarizeSession(groupSummaries as any, { sessionId });

      // Freeze-time guidance counts (high priority prompts, tier2 count)
      try {
        const counts = await this.computeGuidanceCounts(sessionId);
        const guidanceInsights: any = (sessionSummary as any).guidanceInsights || {};
        (sessionSummary as any).guidanceInsights = {
          ...guidanceInsights,
          meta: {
            ...(guidanceInsights.meta || {}),
            highPriorityCount: counts.highPriorityCount,
            tier2Count: counts.tier2Count,
            generatedAt: new Date().toISOString()
          }
        };
      } catch {}
      const id = this.buildId('session', sessionId, undefined, sessionSummary?.analysisTimestamp);
      await repo.upsertSessionSummary({
        id,
        sessionId,
        summaryJson: JSON.stringify(sessionSummary),
        analysisTimestamp: new Date(sessionSummary?.analysisTimestamp || new Date().toISOString())
      });
      try { getSummaryGeneratedCounter().inc({ type: 'session' }); } catch {}
    } catch (error) {
      const reason = (error instanceof Error ? error.message : String(error)) || 'unknown_error';
      try { getSummaryFailedCounter().inc({ type: 'session', reason }); } catch {}
      throw error;
    } finally {
      try { getSummaryLatencyHistogram().observe({ type: 'session' }, Date.now() - start); } catch {}
    }
  }

  async runSummariesForSession(sessionId: string): Promise<void> {
    // get all groups for the session
    const groups = await getCompositionRoot().getGroupRepository().getGroupsBasic(sessionId);
    const ids: string[] = Array.isArray(groups) ? (groups as any[]).map(g => g.id) : [];
    // Concurrency control
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += this.maxGroupConcurrency) chunks.push(ids.slice(i, i + this.maxGroupConcurrency));
    for (const batch of chunks) {
      await Promise.all(batch.map(gid => this.summarizeGroup(sessionId, gid).catch(e => {
        // do not fail the entire batch on one group failure
        return undefined;
      })));
    }
    // After groups, do session summary
    await this.summarizeSessionFromGroups(sessionId);
  }

  private async fetchGroupTranscripts(sessionId: string, groupId: string): Promise<string[]> {
    const sql = `SELECT content FROM ${databricksConfig.catalog}.sessions.transcriptions WHERE session_id = ? AND group_id = ? ORDER BY start_time ASC`;
    const rows = await databricksService.query<{ content: string }>(sql, [sessionId, groupId]);
    return rows.map(r => r.content).filter(Boolean);
  }

  private buildId(scope: 'group' | 'session', sessionId: string, groupId?: string, analysisTimestamp?: string): string {
    const base = [scope, sessionId, groupId || '', analysisTimestamp || ''].join('|');
    return createHash('sha1').update(base).digest('hex');
  }
}

function safeParse(json: string): any | null {
  try { return JSON.parse(json); } catch { return null; }
}

export const summarySynthesisService = new SummarySynthesisService();
