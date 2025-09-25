import type { GuidanceInsightsRepositoryPort, GuidanceTier1Snippet } from '../../services/ports/guidance-insights.repository.port';
import type { DbPort } from '../../services/ports/db.port';
import { normalizeTableFqn } from '../db/fqn.utils';

const { identifier: ANALYSIS_TABLE } = normalizeTableFqn('ai_insights.analysis_results');
const { identifier: GROUP_TABLE } = normalizeTableFqn('sessions.student_groups');

interface Tier1Row {
  analysis_timestamp: Date | string;
  result_data: unknown;
  group_id?: string | null;
  group_name?: string | null;
}

interface Tier2Row {
  analysis_timestamp: Date | string;
  result_data: unknown;
}

function normalizeTimestamp(value: Date | string): Date {
  if (value instanceof Date) return value;
  const asDate = new Date(value);
  return Number.isNaN(asDate.getTime()) ? new Date() : asDate;
}

function parseResultData<T = any>(value: unknown): T | null {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'object') {
    return value as T;
  }
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return null;
  }
}

function extractTier1Snippet(row: Tier1Row): GuidanceTier1Snippet | null {
  const parsed = parseResultData<any>(row.result_data) ?? {};
  const insights = Array.isArray(parsed?.insights) ? parsed.insights : [];
  const firstInsight = insights[0];
  const text = typeof firstInsight?.message === 'string' && firstInsight.message.trim() !== ''
    ? firstInsight.message.trim()
    : undefined;

  const rawGroupId = row.group_id ?? parsed?.groupId ?? parsed?.group_id;
  if (!rawGroupId) return null;

  return {
    timestamp: normalizeTimestamp(row.analysis_timestamp),
    groupId: String(rawGroupId),
    groupName: row.group_name ?? undefined,
    text: text ?? 'Insight',
  };
}

function clampLimit(limit?: number, fallback: number = 20): number {
  const numeric = Number(limit ?? fallback);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.min(Math.floor(numeric), 100);
}

class DbGuidanceInsightsRepository implements GuidanceInsightsRepositoryPort {
  constructor(private readonly db: DbPort) {}

  async listTier1SnippetsBySession(sessionId: string, limit?: number): Promise<GuidanceTier1Snippet[]> {
    const rows = await this.db.query<Tier1Row>(
      `
        SELECT
          r.analysis_timestamp,
          r.result_data,
          r.group_id,
          g.name AS group_name
        FROM ${ANALYSIS_TABLE} r
        LEFT JOIN ${GROUP_TABLE} g ON g.id = r.group_id
        WHERE r.session_id = ?
          AND r.analysis_type = 'tier1'
        ORDER BY r.analysis_timestamp DESC
        LIMIT ?
      `,
      [sessionId, clampLimit(limit)],
      { operation: 'guidance.list_tier1_session' }
    );

    const snippets: GuidanceTier1Snippet[] = [];
    for (const row of rows) {
      const snippet = extractTier1Snippet(row);
      if (snippet) snippets.push(snippet);
    }
    return snippets;
  }

  async getLatestTier2BySession(sessionId: string): Promise<any | null> {
    const row = await this.db.queryOne<Tier2Row>(
      `
        SELECT
          r.analysis_timestamp,
          r.result_data
        FROM ${ANALYSIS_TABLE} r
        WHERE r.session_id = ?
          AND r.analysis_type = 'tier2'
        ORDER BY r.analysis_timestamp DESC
        LIMIT 1
      `,
      [sessionId],
      { operation: 'guidance.latest_tier2_session' }
    );

    if (!row) return null;
    const parsed = parseResultData<any>(row.result_data);
    if (!parsed) return null;
    if (!parsed.timestamp) {
      parsed.timestamp = normalizeTimestamp(row.analysis_timestamp).toISOString();
    }
    return parsed;
  }

  async listTier1ByGroup(sessionId: string, groupId: string, limit?: number): Promise<GuidanceTier1Snippet[]> {
    const rows = await this.db.query<Tier1Row>(
      `
        SELECT
          r.analysis_timestamp,
          r.result_data,
          r.group_id,
          g.name AS group_name
        FROM ${ANALYSIS_TABLE} r
        LEFT JOIN ${GROUP_TABLE} g ON g.id = r.group_id
        WHERE r.session_id = ?
          AND r.group_id = ?
          AND r.analysis_type = 'tier1'
        ORDER BY r.analysis_timestamp DESC
        LIMIT ?
      `,
      [sessionId, groupId, clampLimit(limit)],
      { operation: 'guidance.list_tier1_group' }
    );

    const snippets: GuidanceTier1Snippet[] = [];
    for (const row of rows) {
      const snippet = extractTier1Snippet(row);
      if (!snippet) continue;
      snippets.push(snippet);
    }
    return snippets;
  }
}

export function createDbGuidanceInsightsRepository(db: DbPort): GuidanceInsightsRepositoryPort {
  return new DbGuidanceInsightsRepository(db);
}
