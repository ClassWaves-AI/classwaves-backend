import {
  ENABLE_LOCAL_DB_TESTS,
  ensureLocalPostgresInit,
  ensureLocalPostgresReset,
  loadPostgresApp,
  maybeDescribe,
} from './utils/postgres-test-helpers';

const SESSION_ID = '00000000-0000-0000-0000-000000010000';
const TEACHER_ID = '00000000-0000-0000-0000-000000000001';

maybeDescribe('Session detail repository (postgres)', () => {
  beforeAll(() => {
    ensureLocalPostgresReset();
    loadPostgresApp();
    ensureLocalPostgresInit();
  });

  it('returns seeded session detail for the owner', async () => {
    const { getCompositionRoot } = require('../../app/composition-root');
    const repo = getCompositionRoot().getSessionDetailRepository();

    const detail = await repo.getOwnedSessionDetail(SESSION_ID, TEACHER_ID);

    expect(detail).toBeTruthy();
    expect(detail.id).toBe(SESSION_ID);
    expect(detail.teacher_id).toBe(TEACHER_ID);
    expect(detail.title).toBeDefined();
  });

  it('returns null when teacher does not own the session', async () => {
    const { getCompositionRoot } = require('../../app/composition-root');
    const repo = getCompositionRoot().getSessionDetailRepository();

    const detail = await repo.getOwnedSessionDetail(SESSION_ID, '00000000-0000-0000-0000-00000000BEEF');

    expect(detail).toBeNull();
  });
});
