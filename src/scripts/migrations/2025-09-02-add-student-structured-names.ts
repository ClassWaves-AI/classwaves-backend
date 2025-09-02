import { DatabricksService } from '../../services/databricks.service';

const db = new DatabricksService();

async function migrate() {
  console.log('🔄 Migration: Add structured name fields to users.students');
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
        console.log('✅ Applied:', sql);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('ALREADY_EXISTS') || msg.toLowerCase().includes('already exists')) {
          console.log('ℹ️  Column already exists, skipping:', sql);
        } else if (msg.includes('PARSE_SYNTAX_ERROR') && sql.includes('ADD COLUMNS')) {
          console.warn('⚠️ Syntax error applying ALTER; check warehouse SQL compatibility:', msg);
        } else {
          console.warn('⚠️ Skipped/failed:', sql, '-', msg);
        }
      }
    }

    console.log('🎉 Migration completed');
  } catch (e) {
    console.error('❌ Migration error:', e);
    process.exit(1);
  } finally {
    await db.disconnect();
  }
}

if (require.main === module) {
  migrate();
}

export { migrate };
