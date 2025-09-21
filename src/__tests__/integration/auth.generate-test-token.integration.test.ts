import request from 'supertest';

let app: import('express').Express;

describe('POST /api/v1/auth/generate-test-token dev auth fallback', () => {
  const originalSecret = process.env.E2E_TEST_SECRET;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const originalEncryptionSecret = process.env.SESSION_ENCRYPTION_SECRET;
  const originalRedisMock = process.env.REDIS_USE_MOCK;

  beforeAll(() => {
    process.env.E2E_TEST_SECRET = 'test-secret';
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-for-integration-only';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-for-integration-only';
    process.env.SESSION_ENCRYPTION_SECRET = process.env.SESSION_ENCRYPTION_SECRET ?? 'integration-session-secret';
    process.env.REDIS_USE_MOCK = '1';

    app = require('../../app').default;
  });

  afterAll(() => {
    if (originalSecret !== undefined) process.env.E2E_TEST_SECRET = originalSecret; else delete process.env.E2E_TEST_SECRET;
    if (originalJwtSecret !== undefined) process.env.JWT_SECRET = originalJwtSecret; else delete process.env.JWT_SECRET;
    if (originalRefreshSecret !== undefined) process.env.JWT_REFRESH_SECRET = originalRefreshSecret; else delete process.env.JWT_REFRESH_SECRET;
    if (originalEncryptionSecret !== undefined) process.env.SESSION_ENCRYPTION_SECRET = originalEncryptionSecret; else delete process.env.SESSION_ENCRYPTION_SECRET;
    if (originalRedisMock !== undefined) process.env.REDIS_USE_MOCK = originalRedisMock; else delete process.env.REDIS_USE_MOCK;
  });

  it('issues a super admin token that can access admin-only health components', async () => {
    const agent = request.agent(app);
    const tokenResponse = await agent
      .post('/api/v1/auth/generate-test-token')
      .send({
        secretKey: 'test-secret',
        role: 'super_admin',
        teacherId: 'integration-super-admin',
        schoolId: 'integration-school',
        email: 'integration.super.admin@classwaves.dev',
      })
      .expect(200);

    expect(tokenResponse.body?.success).toBe(true);
    expect(tokenResponse.body?.teacher?.role).toBe('super_admin');
    const accessToken: string | undefined = tokenResponse.body?.tokens?.accessToken;
    expect(accessToken).toBeDefined();
    expect(tokenResponse.body?.sessionId).toBeDefined();

    const componentsResponse = await agent
      .get('/api/v1/health/components')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(componentsResponse.body?.data?.provider).toBeDefined();
  });
});
