import request from 'supertest';
import { FeatureFlags } from '@classwaves/shared';

const ORIGINAL_ENV = { ...process.env };

const resetMetricsRegistry = () => {
  const prom = require('prom-client') as typeof import('prom-client');
  prom.register.clear();
};

const loadApp = () => {
  jest.resetModules();
  resetMetricsRegistry();
  return require('../../app').default;
};

describe('Auth Controller – dev fallback', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env[FeatureFlags.AUTH_DEV_FALLBACK_ENABLED];
    delete process.env.FORCE_DEV_AUTH;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  afterAll(() => {
    process.env = { ...ORIGINAL_ENV };
    resetMetricsRegistry();
  });

  it('returns degraded auth response when fallback flag enabled in non-production', async () => {
    process.env.NODE_ENV = 'development';
    process.env[FeatureFlags.AUTH_DEV_FALLBACK_ENABLED] = '1';
    process.env.GOOGLE_CLIENT_ID = 'fake-google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'fake-google-secret';

    const app = loadApp();
    const response = await request(app).post('/api/v1/auth/google').send({});

    expect(response.status).toBe(200);
    expect(response.body.degradedMode).toBe(true);
    expect(response.body.teacher?.email).toBe('test.teacher@testschool.edu');
    expect(response.headers['set-cookie']).toBeDefined();

    const metrics = await request(app).get('/metrics');
    expect(metrics.text).toContain('classwaves_auth_dev_fallback_total{reason="flag_enabled"} 1');
  });

  it('keeps fallback disabled in production even when flag set', async () => {
    process.env.NODE_ENV = 'production';
    process.env[FeatureFlags.AUTH_DEV_FALLBACK_ENABLED] = '1';
    process.env.GOOGLE_CLIENT_ID = 'fake-google-client';
    process.env.GOOGLE_CLIENT_SECRET = 'fake-google-secret';

    const app = loadApp();
    const response = await request(app).post('/api/v1/auth/google').send({});

    expect(response.status).not.toBe(200);
    expect(response.body.degradedMode).not.toBe(true);

    const metrics = await request(app).get('/metrics');
    expect(metrics.text).not.toContain('classwaves_auth_dev_fallback_total{reason="flag_enabled"} 1');
    expect(metrics.text).not.toContain('classwaves_auth_dev_fallback_total{reason="missing_config"} 1');
    expect(metrics.text).not.toContain('classwaves_auth_dev_fallback_total{reason="forced_env"} 1');
  });
});
