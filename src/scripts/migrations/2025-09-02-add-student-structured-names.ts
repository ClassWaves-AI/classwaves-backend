import { DatabricksService } from '../../services/databricks.service';
import { logger } from '../../utils/logger';

const db = new DatabricksService();

async function migrate() {
  logger.debug('🔄 Migration: Add structured name fields to users.students');
  try {
    await db.connect();

    const alters = [
      `ALTER TABLE classwaves.users.students ADD COLUMNS (given_name STRING COMMENT 'Student given/first name')`,
      `ALTER TABLE classwaves.users.students ADD COLUMNS (family_name STRING COMMENT 'Student family/last name')`,
      `ALTER TABLE classwaves.users.students ADD COLUMNS (preferred_name STRING COMMENT 'Student preferred name')`,
    ];

    for (const sql of alters) {
      try {
        await db.query(sql);
        logger.debug('✅ Applied:', sql);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('ALREADY_EXISTS') || msg.toLowerCase().includes('already exists')) {
          logger.debug('ℹ️  Column already exists, skipping:', sql);
        } else if (msg.includes('PARSE_SYNTAX_ERROR') && sql.includes('ADD COLUMNS')) {
          logger.warn('⚠️ Syntax error applying ALTER; check warehouse SQL compatibility:', msg);
        } else {
          logger.warn('⚠️ Skipped/failed:', sql, '-', msg);
        }
      }
    }

    logger.debug('🎉 Migration completed');
  } catch (e) {
    logger.error('❌ Migration error:', e);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

if (require.main === module) {
  migrate();
}

export { migrate };