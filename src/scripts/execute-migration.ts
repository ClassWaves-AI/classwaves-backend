import { config } from 'dotenv';
import { join } from 'path';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function proceduralMigration() {
  let host: string | undefined, token: string | undefined, warehouse: string | undefined;

  try {
    logger.debug('🚀 Starting procedural Databricks schema migration...');
    
    host = process.env.DATABRICKS_HOST;
    token = process.env.DATABRICKS_TOKEN;
    warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
    
    if (!host || !token || !warehouse) {
      throw new Error('Missing required Databricks environment variables');
    }
  } catch (error: any) {
    logger.error('❌ Configuration error:', error);
    process.exit(1);
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };

  async function executeSQL(sql: string): Promise<any[]> {
    const response = await fetch(`${host}/api/2.0/sql/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        warehouse_id: warehouse,
        statement: sql,
        wait_timeout: '50s'
      })
    });
    
    const result = await response.json() as any;

    if (!response.ok || result.status?.state === 'FAILED') {
      const errorMessage = result.status?.error?.message || await response.text();
      logger.error(`❌ SQL Error executing: "${sql.substring(0, 100)}..."`);
      logger.error(`❌ Details: ${errorMessage}`);
      throw new Error(`SQL execution failed: ${errorMessage}`);
    }
    
    logger.debug(`✅ Executed: "${sql.substring(0, 70)}..."`);
    return result.result?.data_array || [];
  }

  async function getTableSchema(catalog: string, schema: string, table: string): Promise<string[]> {
    try {
      const schemaData = await executeSQL(`DESCRIBE ${catalog}.${schema}.${table}`);
      return schemaData.map((row: any[]) => row[0]); // Return just column names
    } catch (e: unknown) {
      if (e instanceof Error && e.message.includes("TABLE_OR_VIEW_NOT_FOUND")) {
        return []; // Table doesn't exist, so schema is empty
      }
      throw e; // Re-throw other errors
    }
  }

  try {
    // === Step 1: Enable Column Mapping ===
    logger.debug('\n--- Step 1: Enabling Column Mapping ---');
    await executeSQL("ALTER TABLE classwaves.sessions.student_groups SET TBLPROPERTIES ('delta.columnMapping.mode' = 'name')");
    await executeSQL("ALTER TABLE classwaves.sessions.classroom_sessions SET TBLPROPERTIES ('delta.columnMapping.mode' = 'name')");
    // Also enable on transcriptions table just in case it's needed
    await executeSQL("ALTER TABLE classwaves.sessions.transcriptions SET TBLPROPERTIES ('delta.columnMapping.mode' = 'name')");
    
    // === Step 2: Drop the 'participants' table ===
    logger.debug("\n--- Step 2: Dropping 'participants' table ---");
    await executeSQL("DROP TABLE IF EXISTS classwaves.sessions.participants");

    // === Step 3: Modify 'student_groups' table ===
    logger.debug("\n--- Step 3: Modifying 'student_groups' table ---");
    const studentGroupsSchema = await getTableSchema('classwaves', 'sessions', 'student_groups');
    if (studentGroupsSchema.includes('participation_balance')) {
      await executeSQL("ALTER TABLE classwaves.sessions.student_groups DROP COLUMN participation_balance");
    }
    if (!studentGroupsSchema.includes('conceptual_density')) {
      await executeSQL("ALTER TABLE classwaves.sessions.student_groups ADD COLUMN conceptual_density DECIMAL(5,2) COMMENT 'Lexical richness of group discussion.'");
    }
    if (!studentGroupsSchema.includes('topical_cohesion')) {
        await executeSQL("ALTER TABLE classwaves.sessions.student_groups ADD COLUMN topical_cohesion DECIMAL(5,2) COMMENT 'Metric for how focused the group discussion is.'");
    }
    if (!studentGroupsSchema.includes('argumentation_quality')) {
        await executeSQL("ALTER TABLE classwaves.sessions.student_groups ADD COLUMN argumentation_quality DECIMAL(5,2) COMMENT 'Score for quality of arguments.'");
    }

    // === Step 4: Modify 'classroom_sessions' table ===
    logger.debug("\n--- Step 4: Modifying 'classroom_sessions' table ---");
    const sessionsSchema = await getTableSchema('classwaves', 'sessions', 'classroom_sessions');
    if (sessionsSchema.includes('participation_rate')) {
      await executeSQL("ALTER TABLE classwaves.sessions.classroom_sessions DROP COLUMN participation_rate");
    }
    if (sessionsSchema.includes('engagement_score')) {
      await executeSQL("ALTER TABLE classwaves.sessions.classroom_sessions DROP COLUMN engagement_score");
    }

    // === Step 5: Modify 'transcriptions' table ===
    logger.debug("\n--- Step 5: Modifying 'transcriptions' table ---");
    const transcriptionsSchema = await getTableSchema('classwaves', 'sessions', 'transcriptions');
    if (transcriptionsSchema.includes('participant_id')) {
      await executeSQL("ALTER TABLE classwaves.sessions.transcriptions DROP COLUMN participant_id");
    }
    if (transcriptionsSchema.includes('student_id')) {
        await executeSQL("ALTER TABLE classwaves.sessions.transcriptions DROP COLUMN student_id");
    }
    
    logger.debug('\n✅✅✅ Procedural migration completed successfully! ✅✅✅');
    
  } catch (error: unknown) {
    logger.error('\n❌❌❌ A critical error occurred during migration. The process has been halted. ❌❌❌');
    if (error instanceof Error) {
        logger.error('Error details:', error.message);
    } else {
        logger.error('An unknown error occurred:', error);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  proceduralMigration();
}