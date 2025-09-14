import { databricksService } from '../../services/databricks.service';

const teacherCache = new Map<string, string | null>();

export async function getTeacherIdForSessionCached(sessionId: string): Promise<string | null> {
  if (teacherCache.has(sessionId)) return teacherCache.get(sessionId)!;
  try {
    const row = await databricksService.queryOne<{ teacher_id?: string }>(
      `SELECT teacher_id FROM classwaves.sessions.classroom_sessions WHERE id = ? LIMIT 1`,
      [sessionId]
    );
    const tid = (row as any)?.teacher_id || null;
    teacherCache.set(sessionId, tid);
    return tid;
  } catch {
    teacherCache.set(sessionId, null);
    return null;
  }
}

export function _clearTeacherIdCacheForTest() {
  teacherCache.clear();
}

