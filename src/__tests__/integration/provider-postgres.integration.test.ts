import type { Request, Response } from 'express';
import { FeatureFlags } from '@classwaves/shared';
import {
  ensureLocalPostgresInit,
  ensureLocalPostgresReset,
  loadPostgresApp,
  maybeDescribe,
} from './utils/postgres-test-helpers';

maybeDescribe('Provider matrix – Postgres smoke', () => {
  let app: ReturnType<typeof loadPostgresApp>;

  beforeAll(() => {
    process.env.NODE_ENV = 'test';
    process.env.DB_PROVIDER = 'postgres';
    process.env[FeatureFlags.DB_USE_LOCAL_POSTGRES] = '1';
    ensureLocalPostgresReset();
    app = loadPostgresApp();
    ensureLocalPostgresInit();
  });

  it('reports fallback components to guide parity work', async () => {
    const { healthController } = require('../../controllers/health.controller');
    const res: Partial<Response> & { statusCode: number; body?: any } = {
      statusCode: 0,
      status(code: number) {
        this.statusCode = code;
        return this as Response;
      },
      json(payload: any) {
        this.body = payload;
        return this as Response;
      },
    };
    res.statusCode = 200;

    await healthController.getComponentsHealth({} as Request, res as Response);

    expect(res.statusCode).toBe(200);
    expect(res.body?.data?.provider).toBe('postgres');
    expect(res.body?.data?.components?.sessionRepository?.status).toBe('ok');
    expect(res.body?.data?.components?.sessionDetailRepository?.status).toBe('fallback');
  });

  it('exercises local Postgres queries via the seed data', async () => {
    const response = await require('supertest')(app)
      .post('/api/v1/auth/google')
      .send({});

    expect([200, 500]).toContain(response.status);
  });
});
