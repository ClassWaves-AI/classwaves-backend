import { makeKey } from '../../../utils/key-prefix.util';

describe('makeKey', () => {
  const OLD_ENV = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'testenv';
  });
  afterAll(() => {
    process.env.NODE_ENV = OLD_ENV;
  });

  it('builds a prefixed key with sanitized segments', () => {
    const key = makeKey('analytics', 'session', 'session:123', 'user email@example.com');
    expect(key.startsWith('cw:testenv:')).toBe(true);
    // Expect colons/spaces/@ to be replaced with underscores in segments
    expect(key).toBe('cw:testenv:analytics:session:session_123:user_email_example.com');
  });

  it('skips undefined/null segments and handles numbers', () => {
    const key = makeKey('query_cache', 'detail', undefined, 42, null);
    expect(key).toBe('cw:testenv:query_cache:detail:42');
  });
});

