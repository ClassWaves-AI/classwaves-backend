import { databricksService } from '../services/databricks.service';

async function ensureGroupIdOnAnalysisResults() {
  console.log('🔧 Ensuring group_id exists on classwaves.ai_insights.analysis_results...');
  const table = 'classwaves.ai_insights.analysis_results';

  try {
    const describe = await databricksService.query(`DESCRIBE ${table}`);
    const hasGroupId = Array.isArray(describe) && describe.some((r: any) => (r.col_name || r.colName) === 'group_id');
    if (!hasGroupId) {
      console.log('➕ Adding group_id STRING column...');
      await databricksService.query(`ALTER TABLE ${table} ADD COLUMNS (group_id STRING)`);
    } else {
      console.log('✅ group_id already exists');
    }

    // Create composite index if supported; fallback to OPTIMIZE/ ZORDER or comment if not
    try {
      await databricksService.query(
        `CREATE INDEX IF NOT EXISTS idx_ai_results_session_type_group_ts
         ON TABLE ${table} (session_id, analysis_type, group_id, analysis_timestamp)`
      );
      console.log('✅ Composite index ensured');
    } catch (e) {
      console.warn('⚠️ CREATE INDEX not supported in this workspace; consider OPTIMIZE/ZORDER on (session_id, analysis_type, group_id, analysis_timestamp)');
    }

    console.log('✅ Migration completed');
  } catch (e) {
    console.error('❌ Migration failed:', e);
    process.exitCode = 1;
  }
}

// Execute when run directly
if (require.main === module) {
  ensureGroupIdOnAnalysisResults().then(() => process.exit());
}

export { ensureGroupIdOnAnalysisResults };

