import { databricksService } from '../services/databricks.service';
import { logger } from '../utils/logger';

async function ensureGroupIdOnAnalysisResults() {
  logger.debug('🔧 Ensuring group_id exists on classwaves.ai_insights.analysis_results...');
  const table = 'classwaves.ai_insights.analysis_results';

  try {
    const describe = await databricksService.query(`DESCRIBE ${table}`);
    const hasGroupId = Array.isArray(describe) && describe.some((r: any) => (r.col_name || r.colName) === 'group_id');
    if (!hasGroupId) {
      logger.debug('➕ Adding group_id STRING column...');
      await databricksService.query(`ALTER TABLE ${table} ADD COLUMNS (group_id STRING)`);
    } else {
      logger.debug('✅ group_id already exists');
    }

    // Create composite index if supported; fallback to OPTIMIZE/ ZORDER or comment if not
    try {
      await databricksService.query(
        `CREATE INDEX IF NOT EXISTS idx_ai_results_session_type_group_ts
         ON TABLE ${table} (session_id, analysis_type, group_id, analysis_timestamp)`
      );
      logger.debug('✅ Composite index ensured');
    } catch (e) {
      logger.warn('⚠️ CREATE INDEX not supported in this workspace; consider OPTIMIZE/ZORDER on (session_id, analysis_type, group_id, analysis_timestamp)');
    }

    logger.debug('✅ Migration completed');
  } catch (e) {
    logger.error('❌ Migration failed:', e);
    process.exitCode = 1;
  }
}

// Execute when run directly
if (require.main === module) {
  ensureGroupIdOnAnalysisResults().then(() => process.exit());
}

export { ensureGroupIdOnAnalysisResults };
