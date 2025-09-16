import crypto from 'crypto';
import { databricksService } from './databricks.service';
import type { Tier1Insights, Tier2Insights } from '../types/ai-analysis.types';

/**
 * AI Insights Persistence Service
 * - Provides idempotent persistence for Tier1 and Tier2 AI analysis results
 * - Idempotency key derived from scope + session + group (if any) + analysis timestamp
 * - Uses database existence check to avoid duplicate writes on retries
 */
export class AIInsightsPersistenceService {
  /**
   * Persist Tier1 insights for a group within a session, idempotently.
   * Returns true if persisted, false if a duplicate was detected.
   */
  async persistTier1(
    sessionId: string,
    groupId: string,
    insights: Tier1Insights
  ): Promise<boolean> {
    const key = this.buildIdempotencyKey('tier1', sessionId, groupId, insights.analysisTimestamp);

    // Fast path: skip if already present
    const exists = await databricksService.queryOne<{ id: string }>(
      `SELECT id FROM ${this.tablePath()} WHERE id = ? LIMIT 1`,
      [key]
    );
    if (exists?.id) return false;

    const processingMs = Number(insights?.metadata?.processingTimeMs ?? 0);
    await databricksService.insert('analysis_results', {
      id: key,
      session_id: sessionId,
      analysis_type: 'tier1',
      analysis_timestamp: new Date(insights.analysisTimestamp),
      processing_time_ms: Number.isFinite(processingMs) && processingMs >= 0 ? Math.floor(processingMs) : 0,
      result_data: JSON.stringify({ ...insights, groupId }),
      confidence_score: insights.confidence,
      model_version: insights?.metadata?.modelVersion || 'databricks',
      created_at: new Date(),
    });
    return true;
  }

  /**
   * Persist Tier2 insights for a session, idempotently.
   * Returns true if persisted, false if a duplicate was detected.
   */
  async persistTier2(
    sessionId: string,
    insights: Tier2Insights,
    groupId: string
  ): Promise<boolean> {
    const key = this.buildIdempotencyKey('tier2', sessionId, groupId, insights.analysisTimestamp);

    const exists = await databricksService.queryOne<{ id: string }>(
      `SELECT id FROM ${this.tablePath()} WHERE id = ? LIMIT 1`,
      [key]
    );
    if (exists?.id) return false;

    const processingMs = Number(insights?.metadata?.processingTimeMs ?? 0);
    await databricksService.insert('analysis_results', {
      id: key,
      session_id: sessionId,
      analysis_type: 'tier2',
      analysis_timestamp: new Date(insights.analysisTimestamp),
      processing_time_ms: Number.isFinite(processingMs) && processingMs >= 0 ? Math.floor(processingMs) : 0,
      result_data: JSON.stringify({ ...insights, groupId }),
      confidence_score: insights.confidence,
      model_version: insights?.metadata?.modelVersion || 'databricks',
      group_id: groupId,
      created_at: new Date(),
    });
    return true;
  }

  private buildIdempotencyKey(
    tier: 'tier1' | 'tier2',
    sessionId: string,
    groupId?: string,
    analysisTimestamp?: string
  ): string {
    const base = [tier, sessionId, groupId || '', analysisTimestamp || ''].join('|');
    return crypto.createHash('sha1').update(base).digest('hex');
  }

  private tablePath(): string {
    // Mirrors databricksService.getSchemaForTable('analysis_results') mapping
    // Avoid importing config directly to keep this focused and testable
    return `classwaves.ai_insights.analysis_results`;
  }
}

export const aiInsightsPersistenceService = new AIInsightsPersistenceService();
