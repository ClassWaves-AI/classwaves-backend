import request from 'supertest';
import { FeatureFlags } from '@classwaves/shared';
import {
  ENABLE_LOCAL_DB_TESTS,
  ensureLocalPostgresInit,
  ensureLocalPostgresReset,
  loadPostgresApp,
} from './utils/postgres-test-helpers';

interface ProviderRuntime {
  name: string;
  expectedProvider: 'postgres' | 'databricks';
  enabled: boolean;
  setup(): any;
}

const providers: ProviderRuntime[] = [
  {
    name: 'postgres',
    expectedProvider: 'postgres',
    enabled: ENABLE_LOCAL_DB_TESTS,
    setup() {
      process.env.NODE_ENV = 'test';
      process.env.DB_PROVIDER = 'postgres';
      process.env[FeatureFlags.DB_USE_LOCAL_POSTGRES] = '1';
      ensureLocalPostgresReset();
      const app = loadPostgresApp();
      ensureLocalPostgresInit();
      return app;
    },
  },
  {
    name: 'databricks',
    expectedProvider: 'databricks',
    enabled: true,
    setup() {
      jest.resetModules();
      process.env.NODE_ENV = 'test';
      process.env.DB_PROVIDER = 'databricks';
      delete process.env[FeatureFlags.DB_USE_LOCAL_POSTGRES];
      delete process.env.CW_DB_USE_LOCAL_POSTGRES;
      delete process.env['cw.db.use_local_postgres'];
      process.env.DATABRICKS_MOCK = '1';
      // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
      return require('../../app').default;
    },
  },
];

const requiredComponents = [
  'sessionRepository',
  'groupRepository',
  'rosterRepository',
  'adminRepository',
];

const resetHealthControllerCaches = () => {
  const compositionPath = require.resolve('../../app/composition-root');
  delete require.cache[compositionPath];
  const controllerPath = require.resolve('../../controllers/health.controller');
  delete require.cache[controllerPath];
};

providers.forEach(({ name, enabled, setup, expectedProvider }) => {
  const describeFn = enabled ? describe : describe.skip;

  describeFn(`Provider matrix – ${name} parity`, () => {
    let app: any;

    beforeAll(() => {
      app = setup();
    });

    it('reports provider and component statuses via /api/v1/health/components', async () => {
      resetHealthControllerCaches();
      const { healthController } = require('../../controllers/health.controller');

      const res = {
        statusCode: 200,
        payload: undefined as any,
        status(code: number) {
          this.statusCode = code;
          return this;
        },
        json(body: any) {
          this.payload = body;
          return this;
        },
      } as any;

      await healthController.getComponentsHealth({} as any, res);

      expect(res.statusCode ?? 200).toBe(200);
      expect(res.payload?.success).toBe(true);
      expect(res.payload?.data?.provider).toBe(expectedProvider);
      requiredComponents.forEach((key) => {
        expect(res.payload?.data?.components?.[key]).toBeDefined();
      });
    });

    it('exposes provider label via /metrics', async () => {
      const response = await request(app).get('/metrics');
      expect(response.status).toBe(200);
      expect(response.text).toContain(`classwaves_app_info{db_provider="${expectedProvider}"}`);
      expect(response.text).toContain(`classwaves_health_component_status{provider="${expectedProvider}",component="sessionRepository",status="ok"} 1`);
    });
  });
});
