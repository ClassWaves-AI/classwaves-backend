import request from 'supertest';
import express from 'express';
import client from 'prom-client';
import { FeatureFlags } from '@classwaves/shared';

const ORIGINAL_ENV = { ...process.env };

const buildTestApp = async () => {
  const { devSuppress } = await import('../../utils/dev-suppress');
  const app = express();
  app.post('/side-effect', async (_req, res) => {
    try {
      await devSuppress('test_side_effect', async () => {
        throw new Error('forced side effect failure');
      });
      return res.json({ success: true });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
  return app;
};

describe('devSuppress integration', () => {
  beforeEach(() => {
    client.register.clear();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
    client.register.clear();
  });

  it('swallows non-critical side effects in development when flag enabled', async () => {
    process.env.NODE_ENV = 'development';
    process.env[FeatureFlags.DEV_TOLERATE_SIDE_EFFECTS] = '1';

    const app = await buildTestApp();

    const response = await request(app).post('/side-effect').send();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });

    const metrics = await client.register.metrics();
    expect(metrics).toMatch(/classwaves_side_effect_suppressed_total\{[^}]*label="test_side_effect"[^}]*environment="development"[^}]*\} 1/);
  });

  it('propagates failures in production even with flag enabled', async () => {
    process.env.NODE_ENV = 'production';
    process.env[FeatureFlags.DEV_TOLERATE_SIDE_EFFECTS] = '1';

    const app = await buildTestApp();

    const response = await request(app).post('/side-effect').send();
    expect(response.status).toBe(500);
    expect(response.body.success).toBe(false);

    const metrics = await client.register.metrics();
    expect(metrics).not.toMatch(/classwaves_side_effect_suppressed_total\{[^}]*label="test_side_effect"[^}]*environment="production"[^}]*\} 1/);
  });
});
