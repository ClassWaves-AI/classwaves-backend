import { redisService } from './redis.service';
import { databricksConfig } from '../config/databricks.config';
import { getCompositionRoot } from '../app/composition-root';

export interface SegmentLike { id: string; text: string; startTs: number; endTs: number }

function canUseDb(): boolean {
  // Disable in test to avoid external dependencies
  if (process.env.NODE_ENV === 'test') return false;
  // Use configured DB provider
  try {
    const provider = getCompositionRoot().getDbProvider();
    if (provider === 'postgres') return true;
    // For Databricks provider, require token and not explicitly disabled
    if (provider === 'databricks') {
      if (process.env.DATABRICKS_ENABLED === 'false') return false;
      return !!databricksConfig.token;
    }
  } catch {
    // Fallback to previous behavior
    if (process.env.DATABRICKS_ENABLED === 'true') return true;
    if (process.env.DATABRICKS_ENABLED === 'false') return false;
    return !!databricksConfig.token;
  }
  return false;
}

function buildRow(sessionId: string, groupId: string, seg: SegmentLike) {
  const start = new Date(seg.startTs);
  const end = new Date(seg.endTs);
  const durSec = Math.max(0, Math.round((seg.endTs - seg.startTs) / 1000));
  return {
    id: seg.id,
    session_id: sessionId,
    group_id: groupId,
    speaker_id: String(groupId),
    speaker_type: 'group',
    speaker_name: '',
    content: seg.text,
    language_code: 'en',
    start_time: start,
    end_time: end,
    duration_seconds: durSec,
    confidence_score: 0,
    is_final: true,
    created_at: new Date(),
  };
}

export class TranscriptPersistenceService {
  private parseKey(key: string): { sessionId: string; groupId: string } | null {
    // Key pattern: transcr:session:{sid}:group:{gid}
    const m = key.match(/^transcr:session:([^:]+):group:(.+)$/);
    if (!m) return null;
    return { sessionId: m[1], groupId: m[2] };
  }

  async flushKey(key: string): Promise<number> {
    if (!canUseDb()) return 0;
    const ctx = this.parseKey(key);
    if (!ctx) return 0;
    const raw = await redisService.get(key);
    if (!raw) return 0;
    let segments: SegmentLike[] = [];
    try { segments = JSON.parse(raw); } catch { return 0; }
    if (!Array.isArray(segments) || segments.length === 0) return 0;

    // Deduce which IDs already exist in DB (batch by chunks)
    const ids = segments.map(s => s.id).filter(Boolean);
    const newIds = await this.filterMissingIds(ids);
    if (newIds.length === 0) return 0;
    const idSet = new Set(newIds);
    const toInsert = segments.filter(s => idSet.has(s.id)).map(s => buildRow(ctx.sessionId, ctx.groupId, s));
    // Insert in batches using DB port (transactional for efficiency)
    const db = getCompositionRoot().getDbPort();
    const table = this.resolveTableFqn('sessions.transcriptions');
    const BATCH = 100;
    await db.withTransaction(async (tx) => {
      for (let i = 0; i < toInsert.length; i += BATCH) {
        const slice = toInsert.slice(i, i + BATCH);
        for (const row of slice) {
          await tx.insert(table, row, { operation: 'insert_transcription' });
        }
      }
    });
    return toInsert.length;
  }

  async filterMissingIds(ids: string[]): Promise<string[]> {
    if (!canUseDb()) return [];
    if (ids.length === 0) return [];
    const unique = Array.from(new Set(ids));
    const missing: string[] = [];
    const CHUNK = 200;
    const db = getCompositionRoot().getDbPort();
    const table = this.resolveTableFqn('sessions.transcriptions');
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');
      const sql = `SELECT id FROM ${table} WHERE id IN (${placeholders})`;
      const rows = await db.query<{ id: string }>(sql, chunk, { operation: 'select_transcription_ids' });
      const existing = new Set(rows.map(r => String(r.id)));
      for (const id of chunk) if (!existing.has(String(id))) missing.push(id);
    }
    return missing;
  }

  async flushSession(sessionId: string): Promise<number> {
    if (!canUseDb()) return 0;
    const pattern = `transcr:session:${sessionId}:group:*`;
    const keys = await redisService.keys(pattern);
    let total = 0;
    for (const k of keys) total += await this.flushKey(k);
    return total;
  }

  async flushAll(): Promise<number> {
    if (!canUseDb()) return 0;
    const keys = await redisService.keys('transcr:session:*:group:*');
    let total = 0;
    for (const k of keys) total += await this.flushKey(k);
    return total;
  }

  private resolveTableFqn(base: string): string {
    try {
      const provider = getCompositionRoot().getDbProvider();
      if (provider === 'databricks') {
        // Databricks expects catalog-prefixed FQN
        return `${databricksConfig.catalog}.${base}`;
      }
      // Postgres uses schema.table
      return base;
    } catch {
      // Fallback to base
      return base;
    }
  }
}

export const transcriptPersistenceService = new TranscriptPersistenceService();
