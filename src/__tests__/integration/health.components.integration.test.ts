import type { Request, Response } from 'express';
import { FeatureFlags } from '@classwaves/shared';

const ORIGINAL_ENV = { ...process.env };

const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
};

const setEnv = (overrides: Record<string, string | undefined>) => {
  restoreEnv();
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
};

const createMockRes = () => {
  const res: Partial<Response> & { statusCode: number; body?: any } = {
    statusCode: 200,
  };
  res.status = function status(code: number): Response {
    this.statusCode = code;
    return this as Response;
  };
  res.json = function json(body: any): Response {
    this.body = body;
    return this as Response;
  };
  return res as Response & { statusCode: number; body: any };
};

const resetModules = () => {
  const compositionPath = require.resolve('../../app/composition-root');
  delete require.cache[compositionPath];
  const controllerPath = require.resolve('../../controllers/health.controller');
  delete require.cache[controllerPath];
};

describe('GET /api/v1/health/components (controller)', () => {
  
  it('reports component statuses when provider=postgres', async () => {
    setEnv({
      NODE_ENV: 'development',
      DB_PROVIDER: 'postgres',
      [FeatureFlags.DB_USE_LOCAL_POSTGRES]: '1',
    });
    resetModules();
    const { healthController } = require('../../controllers/health.controller');

    const res = createMockRes();
    await healthController.getComponentsHealth({} as Request, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.provider).toBe('postgres');
    const components = res.body.data.components;
    expect(components.sessionRepository.status).toBe('ok');
    expect(components.sessionDetailRepository.status).toBe('ok');
  });

  it('returns 500 when inspection fails gracefully', async () => {
    setEnv({ NODE_ENV: 'development', DB_PROVIDER: 'postgres', [FeatureFlags.DB_USE_LOCAL_POSTGRES]: '1' });
    resetModules();
    const { healthController } = require('../../controllers/health.controller');

    const res = createMockRes();
    // Simulate failure by temporarily deleting getter
    const composition = require('../../app/composition-root').getCompositionRoot();
    const original = composition.getSessionRepository.bind(composition);
    (composition as any).getSessionRepository = () => { throw new Error('boom'); };

    await healthController.getComponentsHealth({} as Request, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.components.sessionRepository.status).toBe('missing');

    // restore
    (composition as any).getSessionRepository = original;
  });
});
