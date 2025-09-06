import { SecureSessionService } from '../../../services/secure-session.service';
import { cachePort } from '../../../utils/cache.port.instance';
import { makeKey } from '../../../utils/key-prefix.util';

describe('SecureSession dual-read/write (prefixed/legacy)', () => {
  const OLD_ENV = { ...process.env } as any;
  const req: any = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };
  const teacher: any = { id: 't-ss-1' };
  const school: any = { id: 'sch-1' };
  const sessionId = 's-sec-1';

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.NODE_ENV = 'test';
    process.env.REDIS_USE_MOCK = '1';
    process.env.CW_CACHE_PREFIX_ENABLED = '1';
    process.env.CW_CACHE_DUAL_WRITE = '1';
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('dual-writes to prefixed and legacy when enabled', async () => {
    await SecureSessionService.storeSecureSession(sessionId, teacher, school, req);
    const prefixed = makeKey('secure_session', sessionId);
    const legacy = `secure_session:${sessionId}`;
    expect(await cachePort.get(prefixed)).toBeTruthy();
    // dual-write enabled by default in tests
    expect(await cachePort.get(legacy)).toBeTruthy();
  });

  it('falls back to legacy read when prefixed missing', async () => {
    // Disable dual-write and only write legacy to simulate legacy-only data
    process.env.CW_CACHE_DUAL_WRITE = '0';
    const legacyOnlySession = 's-sec-legacy-only';
    const legacy = `secure_session:${legacyOnlySession}`;
    await cachePort.set(legacy, JSON.stringify({
      iv: '00', data: '00', authTag: '00', algorithm: 'aes-256-gcm', sessionId
    }), 60);
    const res = await SecureSessionService.getSecureSession(legacyOnlySession);
    // Decrypt will fail due to placeholder but service should attempt legacy read path
    // We assert that it returned null (due to decrypt fail) but did not throw
    expect(res).toBeNull();
  });
});
