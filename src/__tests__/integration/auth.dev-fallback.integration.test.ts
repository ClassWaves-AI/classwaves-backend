import request from 'supertest';
import type { Application } from 'express';
import { FeatureFlags } from '@classwaves/shared';

const ORIGINAL_ENV = { ...process.env };

describe('Auth dev fallback', () => {
  let app: Application;

  beforeAll(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.DATABRICKS_MOCK = '1';
    process.env.REDIS_USE_MOCK = '1';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
    process.env.SESSION_ENCRYPTION_SECRET = process.env.SESSION_ENCRYPTION_SECRET || 'test-session-secret';
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REDIRECT_URI;
    process.env[FeatureFlags.AUTH_DEV_FALLBACK_ENABLED] = '1';
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    app = require('../../app').default as Application;
  });

  afterAll(() => {
    jest.resetModules();
    Object.keys(process.env).forEach((key) => {
      delete (process.env as NodeJS.ProcessEnv)[key];
    });
    Object.assign(process.env, ORIGINAL_ENV);
  });

  it('returns dev fallback response when Google configuration is missing', async () => {
    const response = await request(app)
      .post('/api/v1/auth/google')
      .set('Content-Type', 'application/json')
      .send({ devFallback: true });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.degradedMode).toBe(true);
    expect(response.body.tokens?.accessToken).toBeTruthy();

    const metrics = await request(app).get('/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.text).toContain('classwaves_auth_dev_fallback_total{environment="test",trigger="missing_google_config"} 1');
  });

  it('does not allow dev fallback when NODE_ENV=production', async () => {
    const previousEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const response = await request(app)
      .post('/api/v1/auth/google')
      .set('Content-Type', 'application/json')
      .send({ devFallback: true });

    expect(response.status).toBe(400);

    process.env.NODE_ENV = previousEnv;
  });
});
