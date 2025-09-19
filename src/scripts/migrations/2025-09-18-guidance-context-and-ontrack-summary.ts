import { DatabricksService } from '../../services/databricks.service';
import { logger } from '../../utils/logger';

const db = new DatabricksService();

async function migrate() {
  logger.debug('🔄 Migration: Add guidance context and on-track summary columns');
  try {
    await db.connect();

    const alters = [
      `ALTER TABLE classwaves.ai_insights.teacher_guidance_metrics ADD COLUMNS (context_reason STRING COMMENT 'Reason the AI surfaced this prompt')`,
      `ALTER TABLE classwaves.ai_insights.teacher_guidance_metrics ADD COLUMNS (context_prior_topic STRING COMMENT 'Prior aligned topic snapshot')`,
      `ALTER TABLE classwaves.ai_insights.teacher_guidance_metrics ADD COLUMNS (context_current_topic STRING COMMENT 'Current tangent topic snapshot')`,
      `ALTER TABLE classwaves.ai_insights.teacher_guidance_metrics ADD COLUMNS (context_transition_idea STRING COMMENT 'Suggested bridge back to goal')`,
      `ALTER TABLE classwaves.ai_insights.teacher_guidance_metrics ADD COLUMNS (context_supporting_lines ARRAY<STRUCT<speaker STRING, quote STRING, timestamp TIMESTAMP>> COMMENT 'Sanitized transcript evidence for prompt context')`,
      `ALTER TABLE classwaves.ai_insights.teacher_guidance_metrics ADD COLUMNS (bridging_prompt STRING COMMENT 'Teacher-facing bridge copy for quick actions')`,
      `ALTER TABLE classwaves.ai_insights.teacher_guidance_metrics ADD COLUMNS (context_confidence DOUBLE COMMENT 'Confidence score for context assembly (0-1)')`,
      `ALTER TABLE classwaves.ai_insights.teacher_guidance_metrics ADD COLUMNS (on_track_summary STRING COMMENT 'Positive on-track summary surfaced to teachers')`,
    ];

    for (const sql of alters) {
      try {
        await db.query(sql);
        logger.debug('✅ Applied:', sql);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('ALREADY_EXISTS') || message.toLowerCase().includes('already exists')) {
          logger.debug('ℹ️  Column already exists, skipping:', sql);
        } else if (message.includes('PARSE_SYNTAX_ERROR') && sql.includes('ADD COLUMNS')) {
          logger.warn('⚠️ Syntax error applying ALTER; verify warehouse SQL compatibility:', message);
        } else {
          logger.warn('⚠️ Failed to apply migration step:', message);
        }
      }
    }

    logger.debug('🎉 Migration completed');
  } catch (error) {
    logger.error('❌ Migration error:', error);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

if (require.main === module) {
  migrate();
}

export { migrate };