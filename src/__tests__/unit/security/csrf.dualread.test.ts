import { getCSRFToken, invalidateCSRFToken } from '../../../middleware/csrf.middleware';
import { cachePort } from '../../../utils/cache.port.instance';
import { makeKey } from '../../../utils/key-prefix.util';

describe('CSRF dual-read (prefixed/legacy)', () => {
  const OLD_ENV = { ...process.env };
  const sessionId = 'sess-csrf-1';
  const token = 'tok123';

  beforeEach(() => {
    process.env = { ...OLD_ENV };
    process.env.NODE_ENV = 'test';
    process.env.REDIS_USE_MOCK = '1';
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it('reads from prefixed key when prefix enabled', async () => {
    process.env.CW_CACHE_PREFIX_ENABLED = '1';
    const prefixed = makeKey('csrf', sessionId);
    await cachePort.set(prefixed, token, 60);
    const val = await getCSRFToken(sessionId);
    expect(val).toBe(token);
    await invalidateCSRFToken(sessionId);
  });

  it('falls back to legacy when prefix enabled but only legacy exists', async () => {
    process.env.CW_CACHE_PREFIX_ENABLED = '1';
    const legacy = `csrf:${sessionId}`;
    await cachePort.set(legacy, token, 60);
    const val = await getCSRFToken(sessionId);
    expect(val).toBe(token);
    await invalidateCSRFToken(sessionId);
  });
});

