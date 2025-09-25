import express from 'express';
import request from 'supertest';
import guidanceFixturesRoutes from '../../../routes/guidance-fixtures.routes';

jest.mock('../../../middleware/auth.middleware', () => ({
  __esModule: true,
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'admin-user-1', role: 'admin' };
    return next();
  },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../../middleware/admin-route-security.middleware', () => ({
  __esModule: true,
  requireAnyAdmin: (_req: any, _res: any, next: any) => next(),
  requireSuperAdmin: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../../routes/admin.routes', () => {
  const express = require('express');
  return express.Router();
});

import { readGuidanceMetricsBaseline } from '../../../guidance/metrics-baseline';

const FEATURE_FLAG_KEY = 'CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED';

describe('Dev Guidance Fixtures admin endpoints', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/dev/guidance/fixtures', guidanceFixturesRoutes);

  const originalFlag = process.env[FEATURE_FLAG_KEY];

  beforeAll(() => {
    process.env[FEATURE_FLAG_KEY] = '1';
  });

  afterAll(() => {
    if (typeof originalFlag === 'undefined') {
      delete process.env[FEATURE_FLAG_KEY];
    } else {
      process.env[FEATURE_FLAG_KEY] = originalFlag;
    }
  });

  afterEach(() => {
    process.env.NODE_ENV = 'test';
    process.env[FEATURE_FLAG_KEY] = '1';
  });

  it('rejects access when fixture tooling is disabled', async () => {
    delete process.env[FEATURE_FLAG_KEY];

    const res = await request(app).get('/api/v1/dev/guidance/fixtures');

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('REPLAY_DISABLED');
  });

  it('lists available fixtures with baseline state', async () => {
    const res = await request(app).get('/api/v1/dev/guidance/fixtures');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.fixtures)).toBe(true);
    expect(res.body.fixtures.length).toBeGreaterThan(0);

    const sample = res.body.fixtures[0];
    expect(sample).toHaveProperty('id');
    expect(sample).toHaveProperty('subject');
    expect(sample).toHaveProperty('hasBaseline');
  });

  it('returns fixture detail without transcript by default', async () => {
    const res = await request(app).get('/api/v1/dev/guidance/fixtures/ecosystem_on_track');

    expect(res.status).toBe(200);
    expect(res.body.fixture.metadata.id).toBe('ecosystem_on_track');
    expect(res.body.fixture).not.toHaveProperty('transcript');
    expect(res.body.hasBaseline).toBe(true);
  });

  it('includes transcript and baseline when requested via query', async () => {
    const res = await request(app)
      .get('/api/v1/dev/guidance/fixtures/ecosystem_on_track')
      .query({ includeTranscript: '1', includeBaseline: 'true' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.fixture.transcript)).toBe(true);
    expect(res.body.baseline).toBeTruthy();
  });

  it('exposes stored baseline snapshot via dedicated endpoint', async () => {
    const res = await request(app).get('/api/v1/dev/guidance/fixtures/ecosystem_on_track/baseline');

    expect(res.status).toBe(200);
    expect(res.body.fixtureId).toBe('ecosystem_on_track');
    expect(res.body.baseline.guidance_context_episode_count).toBeDefined();
  });

  it('persists identical baseline payloads without requiring force', async () => {
    const baseline = readGuidanceMetricsBaseline('ecosystem_on_track');
    if (!baseline) {
      throw new Error('Expected baseline fixture data for ecosystem_on_track');
    }

    const res = await request(app)
      .post('/api/v1/dev/guidance/fixtures/ecosystem_on_track/baseline')
      .send({ baseline, confirm: true });

    // Debug failing payloads if schema rejects
    if (res.status !== 200) {
      throw new Error(`Baseline update failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
  });

  it('rejects conflicting baseline updates without force flag', async () => {
    const baseline = readGuidanceMetricsBaseline('ecosystem_on_track');
    if (!baseline) {
      throw new Error('Expected baseline fixture data for ecosystem_on_track');
    }

    const mutated = JSON.parse(JSON.stringify(baseline));
    mutated.guidance_context_episode_count.sum += 1;

    const res = await request(app)
      .post('/api/v1/dev/guidance/fixtures/ecosystem_on_track/baseline')
      .send({ baseline: mutated, confirm: true });

    if (res.status !== 409) {
      throw new Error(`Expected mismatch response, got ${res.status} ${JSON.stringify(res.body)}`);
    }
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('BASELINE_MISMATCH');
    expect(Array.isArray(res.body.diffs)).toBe(true);
  });
});
