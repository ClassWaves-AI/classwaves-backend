import { FeatureFlags } from '@classwaves/shared';

const ORIGINAL_ENV = { ...process.env };

describe('CompositionRoot DB provider selection', () => {
  afterEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to Databricks when no overrides provided', () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'development' };
    const { getCompositionRoot } = require('../../../app/composition-root');
    const composition = getCompositionRoot();
    expect(composition.getDbProvider()).toBe('databricks');
  });

  it('selects Postgres when DB_PROVIDER=postgres in development', () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'development', DB_PROVIDER: 'postgres' };
    const { getCompositionRoot } = require('../../../app/composition-root');
    const composition = getCompositionRoot();
    expect(composition.getDbProvider()).toBe('postgres');
  });

  it('ignores Postgres provider outside dev/test environments', () => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production', DB_PROVIDER: 'postgres' };
    const { getCompositionRoot } = require('../../../app/composition-root');
    const composition = getCompositionRoot();
    expect(composition.getDbProvider()).toBe('databricks');
  });

  it('enables Postgres when cw.db.use_local_postgres flag is set', () => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      [FeatureFlags.DB_USE_LOCAL_POSTGRES]: '1',
    } as NodeJS.ProcessEnv;
    const { getCompositionRoot } = require('../../../app/composition-root');
    const composition = getCompositionRoot();
    expect(composition.getDbProvider()).toBe('postgres');
  });
});
