import { redactObject, redactValue } from '../../../utils/logger';

describe('logger redaction', () => {
  it('redacts sensitive keys and values', () => {
    const input: any = {
      Authorization: 'Bearer abcdef123456',
      cookie: 'session=verysecret',
      password: 'supersecret',
      token: 'xyz',
      refreshToken: 'r-123',
      apiKey: 'k-999',
      email: 'user@example.com',
      nested: {
        authorization: 'Bearer another',
        'set-cookie': 'sid=foo',
      } as Record<string, any>,
    };

    const redacted = redactObject(input);
    expect(redacted.Authorization).toBe('[REDACTED]');
    expect(redacted.cookie).toBe('[REDACTED]');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.refreshToken).toBe('[REDACTED]');
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.email).toBe('[REDACTED]');
    expect((redacted as any).nested.authorization).toBe('[REDACTED]');
    expect((redacted as any).nested['set-cookie']).toBe('[REDACTED]');
  });

  it('redacts bearer and jwt-like strings via value helper', () => {
    expect(redactValue('Bearer token-here')).toBe('Bearer [REDACTED]');
    expect(redactValue('abc.def.ghi')).toBe('[REDACTED_JWT]');
    expect(redactValue('not-a-token')).toBe('not-a-token');
  });
});
