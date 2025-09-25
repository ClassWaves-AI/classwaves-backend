import { getCompositionRoot } from '../../app/composition-root';

const teacherCache = new Map<string, string | null>();

export async function getTeacherIdForSessionCached(sessionId: string): Promise<string | null> {
  if (teacherCache.has(sessionId)) return teacherCache.get(sessionId)!;
  try {
    const repo = getCompositionRoot().getSessionRepository();
    const basic = await repo.getBasic(sessionId);
    const tid = (basic as any)?.teacher_id || null;
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
