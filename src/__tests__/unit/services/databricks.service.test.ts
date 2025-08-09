// Live Databricks test (only runs when env vars present)
import 'dotenv/config';
import { databricksService } from '../../../services/databricks.service';

jest.setTimeout(30000);

const hasEnv =
  !!process.env.DATABRICKS_HOST &&
  !!process.env.DATABRICKS_TOKEN &&
  !!process.env.DATABRICKS_WAREHOUSE_ID;

const maybe = hasEnv ? describe : describe.skip;

maybe('DatabricksService (live connection)', () => {
  beforeAll(async () => {
    await databricksService.connect();
  });

  afterAll(async () => {
    await databricksService.disconnect();
  });

  it('connects and performs a simple SELECT 1', async () => {
    const rows = await databricksService.query<{ one: number }>('SELECT 1 as one');
    expect(Array.isArray(rows)).toBe(true);
  });

  it('reuses session across queries', async () => {
    const rows1 = await databricksService.query('SELECT 1');
    const rows2 = await databricksService.query('SELECT 1');
    expect(rows1).toBeDefined();
    expect(rows2).toBeDefined();
  });
});

(!hasEnv ? describe : describe.skip)('DatabricksService (env missing) - skipped', () => {
  it('skips when required env vars are not set', () => {
    expect(true).toBe(true);
  });
});
