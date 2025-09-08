import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';

async function main() {
  console.log('Creating ai_insights group_summaries and session_summaries tables...');
  const catalog = databricksConfig.catalog;
  const schema = 'ai_insights';
  try {
    await databricksService.query(`CREATE SCHEMA IF NOT EXISTS ${catalog}.ai_insights`);

    await databricksService.query(`
      CREATE TABLE IF NOT EXISTS ${catalog}.ai_insights.group_summaries (
        id STRING NOT NULL,
        session_id STRING NOT NULL,
        group_id STRING NOT NULL,
        summary_json STRING NOT NULL,
        analysis_timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL
      ) USING DELTA
    `);
    // Delta Lake does not support traditional indexes; Unity Catalog may emulate; keep as no-op if unsupported
    try { await databricksService.query(`CREATE INDEX IF NOT EXISTS idx_group_summaries_session ON ${catalog}.ai_insights.group_summaries (session_id)`); } catch {}
    try { await databricksService.query(`CREATE INDEX IF NOT EXISTS idx_group_summaries_group ON ${catalog}.ai_insights.group_summaries (group_id)`); } catch {}

    await databricksService.query(`
      CREATE TABLE IF NOT EXISTS ${catalog}.ai_insights.session_summaries (
        id STRING NOT NULL,
        session_id STRING NOT NULL,
        summary_json STRING NOT NULL,
        analysis_timestamp TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL
      ) USING DELTA
    `);
    try { await databricksService.query(`CREATE INDEX IF NOT EXISTS idx_session_summaries_session ON ${catalog}.ai_insights.session_summaries (session_id)`); } catch {}

    console.log('✅ Summaries tables ensured.');
  } catch (error) {
    console.error('❌ Failed to create summaries tables:', error);
    process.exitCode = 1;
  } finally {
    try { await databricksService.disconnect(); } catch {}
  }
}

main();

