import crypto from 'crypto';
import type { DbProvider } from '@classwaves/shared';
import type { Tier1Insights, Tier2Insights } from '../types/ai-analysis.types';
import type { DbPort } from './ports/db.port';
import { getCompositionRoot } from '../app/composition-root';
import { databricksConfig } from '../config/databricks.config';
import { normalizeTableFqn } from '../adapters/db/fqn.utils';

/**
 * AI Insights Persistence Service
 * - Provides idempotent persistence for Tier1 and Tier2 AI analysis results
 * - Idempotency key derived from scope + session + group (if any) + analysis timestamp
 * - Uses database existence check to avoid duplicate writes on retries
 */
export class AIInsightsPersistenceService {
  private cachedDbPort: DbPort | null = null;
  private cachedProvider: DbProvider | null = null;
  private cachedTableRefs: { select: string; insert: string } | null = null;

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
    const db = this.getDbPort();
    const tableRefs = this.getTableRefs();

    // Fast path: skip if already present
    const exists = await db.queryOne<{ id: string }>(
      `SELECT id FROM ${tableRefs.select} WHERE id = ? LIMIT 1`,
      [key],
      { operation: 'analysis_results.select_existing' }
    );
    if (exists?.id) return false;

    const processingMs = Number(insights?.metadata?.processingTimeMs ?? 0);
    await db.insert(tableRefs.insert, {
      id: key,
      session_id: sessionId,
      analysis_type: 'tier1',
      analysis_timestamp: new Date(insights.analysisTimestamp),
      processing_time_ms: Number.isFinite(processingMs) && processingMs >= 0 ? Math.floor(processingMs) : 0,
      result_data: JSON.stringify({ ...insights, groupId }),
      confidence_score: insights.confidence,
      model_version: insights?.metadata?.modelVersion || 'databricks',
      group_id: groupId,
      created_at: new Date(),
    }, { operation: 'analysis_results.insert_tier1' });
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
    const db = this.getDbPort();
    const tableRefs = this.getTableRefs();

    const exists = await db.queryOne<{ id: string }>(
      `SELECT id FROM ${tableRefs.select} WHERE id = ? LIMIT 1`,
      [key],
      { operation: 'analysis_results.select_existing' }
    );
    if (exists?.id) return false;

    const processingMs = Number(insights?.metadata?.processingTimeMs ?? 0);
    await db.insert(tableRefs.insert, {
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
    }, { operation: 'analysis_results.insert_tier2' });
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

  private getDbPort(): DbPort {
    if (!this.cachedDbPort) {
      this.cachedDbPort = getCompositionRoot().getDbPort();
    }
    return this.cachedDbPort;
  }

  private getDbProvider(): DbProvider {
    if (!this.cachedProvider) {
      this.cachedProvider = getCompositionRoot().getDbProvider();
    }
    return this.cachedProvider;
  }

  private getTableRefs(): { select: string; insert: string } {
    if (this.cachedTableRefs) {
      return this.cachedTableRefs;
    }

    const provider = this.getDbProvider();
    const catalog = databricksConfig.catalog || 'classwaves';
    const select = provider === 'postgres' ? 'ai_insights.analysis_results' : `${catalog}.ai_insights.analysis_results`;
    const normalized = normalizeTableFqn(select);
    this.cachedTableRefs = { select, insert: `${normalized.schema}.${normalized.table}` };
    return this.cachedTableRefs;
  }
}

export const aiInsightsPersistenceService = new AIInsightsPersistenceService();
