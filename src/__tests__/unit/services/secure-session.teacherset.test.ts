import { SecureSessionService } from '../../../services/secure-session.service';
import { cachePort } from '../../../utils/cache.port.instance';
import { makeKey } from '../../../utils/key-prefix.util';
import { redisService } from '../../../services/redis.service';

describe('teacher_sessions dual-read/write', () => {
  const OLD_ENV = { ...process.env };
  const req: any = { ip: '127.0.0.1', headers: { 'user-agent': 'jest' } };
  const teacher: any = { id: 't-dset-1' };
  const school: any = { id: 'sch-1' };
  const sessionId = 's-dset-1';

  beforeEach(() => {
    process.env = { ...OLD_ENV } as any;
    process.env.NODE_ENV = 'test';
    process.env.REDIS_USE_MOCK = '1';
    process.env.CW_CACHE_PREFIX_ENABLED = '1';
    process.env.CW_CACHE_DUAL_WRITE = '1';
    // Clear sets between tests
    const client = redisService.getClient() as any;
    const pref = makeKey('teacher_sessions', teacher.id);
    const leg = `teacher_sessions:${teacher.id}`;
    client.del(pref).catch(() => {});
    client.del(leg).catch(() => {});
  });

  afterAll(() => {
    process.env = OLD_ENV as any;
  });

  it('sadd/expire writes to prefixed and legacy when dual-write enabled', async () => {
    await SecureSessionService.storeSecureSession(sessionId, teacher, school, req);
    const client = redisService.getClient() as any;
    const prefixedSet = makeKey('teacher_sessions', teacher.id);
    const legacySet = `teacher_sessions:${teacher.id}`;
    const prefixedMembers = await client.smembers(prefixedSet);
    const legacyMembers = await client.smembers(legacySet);
    expect(prefixedMembers).toContain(sessionId);
    expect(legacyMembers).toContain(sessionId);
    // TTL for sets is not tracked in the in-memory mock; membership checks suffice
  });

  it('fallback reads legacy set and normalizes into prefixed on enforce limits', async () => {
    // Only legacy set has a session
    process.env.CW_CACHE_DUAL_WRITE = '0';
    const client = redisService.getClient() as any;
    const legacySet = `teacher_sessions:${teacher.id}`;
    const prefixedSet = makeKey('teacher_sessions', teacher.id);
    await client.sadd(legacySet, 's-legacy-only');
    await client.sadd(legacySet, 's-legacy-expired');
    // Also ensure the secure_session:* exists so enforcement keeps it
    await cachePort.set(makeKey('secure_session', 's-legacy-only'), JSON.stringify({
      iv: '00', data: '00', authTag: '00', algorithm: 'aes-256-gcm', sessionId: 's-legacy-only'
    }), 60);
    // Invoke private method via any-cast
    await (SecureSessionService as any).enforceSessionLimits(teacher.id);
    const normalizedMembers = await client.smembers(prefixedSet);
    expect(normalizedMembers).toContain('s-legacy-only');
    expect(normalizedMembers).not.toContain('s-legacy-expired');
  });

  it('srem removes from prefixed and legacy on invalidate', async () => {
    process.env.CW_CACHE_DUAL_WRITE = '1';
    await SecureSessionService.storeSecureSession(sessionId, teacher, school, req);
    await SecureSessionService.invalidateSession(sessionId, 'test');
    const client = redisService.getClient() as any;
    const prefixedSet = makeKey('teacher_sessions', teacher.id);
    const legacySet = `teacher_sessions:${teacher.id}`;
    expect(await client.sismember(prefixedSet, sessionId)).toBe(0);
    // In dual-write mode, legacy should also be cleaned
    expect(await client.sismember(legacySet, sessionId)).toBe(0);
  });
});
