import fs from 'fs';
import os from 'os';
import path from 'path';

describe('MigrationTracker with Databricks mock', () => {
  const originalEnv = { ...process.env };

  beforeAll(() => {
    process.env.DATABRICKS_MOCK = '1';
    process.env.DATABRICKS_HOST = '';
    process.env.DATABRICKS_TOKEN = '';
    process.env.DATABRICKS_WAREHOUSE_ID = '';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('runs setup and records migrations using the mock adapter', async () => {
    jest.resetModules();
    const { MigrationTracker } = require('../../../../scripts/migration-tracker.js');
    const tracker = new MigrationTracker();
    await tracker.setupMigrationTracking();

    const migrationFile = path.join(os.tmpdir(), `mock-migration-${Date.now()}.sql`);
    fs.writeFileSync(
      migrationFile,
      `CREATE TABLE IF NOT EXISTS classwaves.ai_insights.mock_table (
        id STRING,
        context_reason STRING
      ) USING DELTA;
      ALTER TABLE classwaves.ai_insights.mock_table ADD COLUMNS (context_current_topic STRING);
      INSERT INTO classwaves.ai_insights.mock_table (id, context_reason, context_current_topic) VALUES ('test-1', 'reason', 'topic');
      `
    );

    try {
      await tracker.executeMigrationFile(migrationFile);
      await tracker.checkMigrationStatus();
    } finally {
      if (fs.existsSync(migrationFile)) {
        fs.unlinkSync(migrationFile);
      }
    }
  });
});
