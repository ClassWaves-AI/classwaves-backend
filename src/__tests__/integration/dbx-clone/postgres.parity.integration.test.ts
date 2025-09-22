import request from 'supertest';
import type { Application } from 'express';
import { FeatureFlags, ErrorCodes } from '@classwaves/shared';
import { createPostgresDbAdapter } from '../../../adapters/db/postgres.adapter';
import {
  ensureLocalPostgresReset,
  loadPostgresApp,
  maybeDescribe,
} from '../utils/postgres-test-helpers';
import { getSchemaManifestHash } from '../../../utils/manifest.utils';

const SEED_SESSION_ID = '00000000-0000-0000-0000-000000010000';

maybeDescribe('DBX Clone Postgres parity', () => {
  let app: Application;
  const adapter = createPostgresDbAdapter();

  beforeAll(async () => {
    process.env[FeatureFlags.DBX_MANIFEST_ENABLED] = '1';
    process.env.CW_DBX_MANIFEST_ENABLED = '1';
    ensureLocalPostgresReset();
    app = loadPostgresApp();
    await adapter.connect();
  });

  afterAll(async () => {
    await adapter.disconnect();
  });

  it('reports postgres provider via metrics gauge', async () => {
    const response = await request(app).get('/metrics').expect(200);
    const manifestHash = getSchemaManifestHash();
    expect(manifestHash).toBeDefined();
    expect(response.text).toContain(
      `classwaves_app_info{db_provider="postgres",manifest_hash="${manifestHash}"} 1`
    );
  });

  it('finds the seeded development session via repository path', async () => {
    const session = await adapter.queryOne<{ title: string }>(
      'SELECT title FROM sessions.classroom_sessions WHERE id = ?',
      [SEED_SESSION_ID]
    );
    expect(session?.title).toBe('Dev Session');
  });

  it('upserts analytics JSON payloads using manifest mapped jsonb columns', async () => {
    const analyticsId = adapter.generateId();
    await adapter.upsert('ai_insights.session_guidance_analytics', ['id'], {
      id: analyticsId,
      session_id: SEED_SESSION_ID,
      teacher_id: '00000000-0000-0000-0000-000000000001',
      school_id: '11111111-1111-1111-1111-111111111111',
      created_at: new Date(),
      category_breakdown: [{ category: 'redirection', count: 2 }],
      usage_rate: 0.75,
    });

    const stored = await adapter.queryOne<{ category_breakdown: Array<{ category: string; count: number }> }>(
      'SELECT category_breakdown FROM ai_insights.session_guidance_analytics WHERE id = ?',
      [analyticsId]
    );
    expect(stored?.category_breakdown?.[0]?.category).toBe('redirection');
  });

  it('surfaces unauthorized access to protected session routes', async () => {
    const response = await request(app).get('/api/v1/sessions').expect(401);
    expect(response.body?.error?.code).toBe(ErrorCodes.AUTH_REQUIRED);
  });

  it('rejects invalid session creation payloads with validation errors', async () => {
    const response = await request(app)
      .post('/api/v1/auth/google')
      .send({})
      .expect(400);
    expect(response.body?.error?.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('enforces rate limiting on AI status endpoint after sustained access', async () => {
    const attempts = 40;
    let rateLimited = false;
    for (let i = 0; i < attempts; i += 1) {
      const res = await request(app).get('/api/v1/ai/status');
      if (res.status === 429) {
        rateLimited = true;
        break;
      }
    }
    expect(rateLimited).toBe(true);
  });
});
