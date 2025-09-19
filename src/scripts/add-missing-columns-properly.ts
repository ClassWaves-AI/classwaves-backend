import { config } from 'dotenv';
import { join } from 'path';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function addMissingColumnsProperly() {
  try {
    logger.debug('🔧 Adding missing columns properly...');
    
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
    
    // Function to execute SQL statement with detailed error reporting
    async function executeSQL(sql: string, description: string) {
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
      
      // Check for SQL execution errors
      if (result.result?.status?.sqlState) {
        logger.error(`❌ SQL Error - ${description}:`, result.result.status);
        return false;
      }
      
      if (result.status?.statusCode === 'ERROR') {
        logger.error(`❌ Execution Error - ${description}:`, result.status);
        return false;
      }
      
      logger.debug(`✅ ${description} completed successfully`);
      return true;
    }
    
    // Add missing columns with proper syntax
    const commands = [
      {
        sql: `ALTER TABLE classwaves.sessions.student_groups ADD COLUMN is_ready BOOLEAN DEFAULT FALSE`,
        description: 'Add is_ready column to student_groups'
      },
      {
        sql: `ALTER TABLE classwaves.sessions.participants ADD COLUMN is_group_leader BOOLEAN DEFAULT FALSE`,
        description: 'Add is_group_leader column to participants'
      }
    ];
    
    logger.debug('\n=== Adding missing columns ===');
    
    for (const command of commands) {
      const success = await executeSQL(command.sql, command.description);
      if (!success) {
        logger.debug(`⚠️ Failed: ${command.description}`);
        
        // Try to see if column already exists
        const tableName = command.sql.includes('student_groups') ? 'student_groups' : 'participants';
        const catalog = command.sql.includes('student_groups') ? 'classwaves.sessions' : 'classwaves.sessions';
        
        logger.debug(`\nChecking if column already exists in ${tableName}...`);
        await executeSQL(`DESCRIBE ${catalog}.${tableName}`, `Check ${tableName} schema`);
      }
    }
    
    // Verify final schemas
    logger.debug('\n=== Verifying final schemas ===');
    await executeSQL('DESCRIBE classwaves.sessions.student_groups', 'Verify student_groups final schema');
    await executeSQL('DESCRIBE classwaves.sessions.participants', 'Verify participants final schema');
    
  } catch (error) {
    logger.error('❌ Error adding missing columns:', error);
  }
}

if (require.main === module) {
  addMissingColumnsProperly();
}

export { addMissingColumnsProperly };