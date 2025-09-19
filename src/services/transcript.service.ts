import { redisService } from './redis.service';
import { databricksService } from './databricks.service';
import { databricksConfig } from '../config/databricks.config';

export interface TranscriptSegment { id: string; text: string; startTs: number; endTs: number }

export class TranscriptService {
  private key(sessionId: string, groupId: string) {
    return `transcr:session:${sessionId}:group:${groupId}`;
  }

  async read(sessionId: string, groupId: string, since?: number, until?: number): Promise<TranscriptSegment[]> {
    const key = this.key(sessionId, groupId);
    const raw = await redisService.get(key);
    let segments: TranscriptSegment[] = [];
    if (raw) {
      try { segments = JSON.parse(raw); } catch { segments = []; }
    }

    // DB fallback if Redis empty or not covering requested time range
    const canDb = process.env.NODE_ENV !== 'test' && process.env.DATABRICKS_ENABLED !== 'false' && !!databricksConfig.token;
    if (canDb && (!segments.length || since != null || until != null)) {
      const rows = await this.queryDb(sessionId, groupId, since, until);
      const mapped: TranscriptSegment[] = rows.map((r: any) => ({ id: String(r.id), text: String(r.content || ''), startTs: new Date(r.start_time).getTime(), endTs: new Date(r.end_time).getTime() }));
      // Merge dedup by id
      const byId = new Map<string, TranscriptSegment>();
      for (const s of [...segments, ...mapped]) byId.set(s.id, s);
      segments = Array.from(byId.values());
    }

    // Filter by requested time window
    if (since != null) segments = segments.filter((s) => s.endTs >= since);
    if (until != null) segments = segments.filter((s) => s.startTs <= until);

    // Ensure order and simple time-based merge of adjacent overlapping windows
    segments.sort((a, b) => a.startTs - b.startTs);
    const merged: TranscriptSegment[] = [];
    for (const seg of segments) {
      const last = merged[merged.length - 1];
      if (!last) { merged.push(seg); continue; }
      const overlaps = seg.startTs <= last.endTs; // overlap/adjacent
      if (overlaps) {
        merged[merged.length - 1] = {
          id: last.id,
          startTs: Math.min(last.startTs, seg.startTs),
          endTs: Math.max(last.endTs, seg.endTs),
          text: `${last.text} ${seg.text}`.trim(),
        };
      } else {
        merged.push(seg);
      }
    }
    return merged;
  }

  private async queryDb(sessionId: string, groupId: string, since?: number, until?: number): Promise<any[]> {
    const where: string[] = ['session_id = ?', 'group_id = ?'];
    const params: any[] = [sessionId, groupId];
    if (typeof since === 'number') { where.push('end_time >= ?'); params.push(new Date(since)); }
    if (typeof until === 'number') { where.push('start_time <= ?'); params.push(new Date(until)); }
    const sql = `SELECT id, content, start_time, end_time FROM ${databricksConfig.catalog}.sessions.transcriptions WHERE ${where.join(' AND ')} ORDER BY start_time`;
    try { return await databricksService.query(sql, params); } catch { return []; }
  }
}

export const transcriptService = new TranscriptService();
