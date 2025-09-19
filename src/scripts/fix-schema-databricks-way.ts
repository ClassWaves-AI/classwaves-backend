import { config } from 'dotenv';
import { join } from 'path';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function fixSchemaDatabricksWay() {
  try {
    logger.debug('🔧 Fixing schema the Databricks Delta way...');
    
    const host = process.env.DATABRICKS_HOST;
    const token = process.env.DATABRICKS_TOKEN;
    const warehouse = process.env.DATABRICKS_WAREHOUSE_ID;
    
    if (!host || !token || !warehouse) {
      throw new Error('Missing required Databricks environment variables');
    }
    
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };
    
    // Function to execute SQL statement
    async function executeSQL(sql: string, description: string): Promise<boolean> {
      logger.debug(`\n📝 ${description}...`);
      logger.debug(`SQL: ${sql}`);
      
      const response = await fetch(`${host}/api/2.0/sql/statements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          warehouse_id: warehouse,
          statement: sql,
          wait_timeout: '50s'
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        logger.error(`❌ HTTP Error - ${description}:`, response.status, error);
        return false;
      }
      
      const result = await response.json() as any;
      
      if (result.status?.state === 'FAILED') {
        logger.error(`❌ SQL Failed - ${description}:`, result.status.error);
        return false;
      }
      
      if (result.status?.state === 'SUCCEEDED') {
        logger.debug(`✅ ${description} succeeded`);
        return true;
      }
      
      logger.warn(`⚠️ Unexpected state for ${description}:`, result.status?.state);
      return false;
    }
    
    logger.debug('\n=== STEP 1: Add columns without constraints ===');
    
    // Step 1: Add columns without NOT NULL or DEFAULT
    const addColumnCommands = [
      {
        sql: `ALTER TABLE classwaves.sessions.student_groups ADD COLUMN is_ready BOOLEAN`,
        description: 'Add is_ready column to student_groups (nullable)'
      },
      {
        sql: `ALTER TABLE classwaves.sessions.participants ADD COLUMN is_group_leader BOOLEAN`,
        description: 'Add is_group_leader column to participants (nullable)'
      }
    ];
    
    for (const command of addColumnCommands) {
      await executeSQL(command.sql, command.description);
    }
    
    logger.debug('\n=== STEP 2: Update existing rows with default values ===');
    
    // Step 2: Update existing rows to have default values
    const updateCommands = [
      {
        sql: `UPDATE classwaves.sessions.student_groups SET is_ready = false WHERE is_ready IS NULL`,
        description: 'Set is_ready = false for existing student_groups'
      },
      {
        sql: `UPDATE classwaves.sessions.participants SET is_group_leader = false WHERE is_group_leader IS NULL`,
        description: 'Set is_group_leader = false for existing participants'
      }
    ];
    
    for (const command of updateCommands) {
      await executeSQL(command.sql, command.description);
    }
    
    logger.debug('\n=== STEP 3: Verify schema ===');
    
    // Step 3: Verify the columns were added
    await executeSQL(
      'SELECT COUNT(*) as total_groups, COUNT(is_ready) as groups_with_is_ready FROM classwaves.sessions.student_groups',
      'Verify is_ready column in student_groups'
    );
    
    await executeSQL(
      'SELECT COUNT(*) as total_participants, COUNT(is_group_leader) as participants_with_leader_flag FROM classwaves.sessions.participants',
      'Verify is_group_leader column in participants'
    );
    
    logger.debug('\n✅ Schema should now be fixed for Databricks Delta tables!');
    
  } catch (error) {
    logger.error('❌ Error fixing schema:', error);
  }
}

if (require.main === module) {
  fixSchemaDatabricksWay();
}

export { fixSchemaDatabricksWay };