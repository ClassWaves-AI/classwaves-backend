import { config } from 'dotenv';
import { join } from 'path';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function checkGroupSchema() {
  try {
    logger.debug('🔍 Checking group table schemas...');
    
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
    async function executeSQL(sql: string, description: string) {
      logger.debug(`\n📝 ${description}...`);
      
      const response = await fetch(`${host}/api/2.0/sql/statements`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          warehouse_id: warehouse,
          statement: sql,
          wait_timeout: '30s'
        })
      });
      
      if (!response.ok) {
        const error = await response.text();
        logger.error(`❌ Failed to ${description}:`, response.status, error);
        return null;
      }
      
      const result = await response.json() as any;
      return result;
    }
    
    // Check student_groups table schema
    logger.debug('\n=== STUDENT_GROUPS TABLE SCHEMA ===');
    const groupsSchema = await executeSQL(
      'DESCRIBE classwaves.sessions.student_groups',
      'Get student_groups schema'
    );
    
    if (groupsSchema?.result?.data_array) {
      logger.debug('\nColumns in student_groups table:');
      groupsSchema.result.data_array.forEach((row: any[], index: number) => {
        logger.debug(`${index + 1}. ${row[0]} (${row[1]}) ${row[2] ? '- ' + row[2] : ''}`);
      });
    }
    
    // Check participants table schema
    logger.debug('\n=== PARTICIPANTS TABLE SCHEMA ===');
    const participantsSchema = await executeSQL(
      'DESCRIBE classwaves.sessions.participants',
      'Get participants schema'
    );
    
    if (participantsSchema?.result?.data_array) {
      logger.debug('\nColumns in participants table:');
      participantsSchema.result.data_array.forEach((row: any[], index: number) => {
        logger.debug(`${index + 1}. ${row[0]} (${row[1]}) ${row[2] ? '- ' + row[2] : ''}`);
      });
    }
    
    // Check if tables have data
    logger.debug('\n=== TABLE ROW COUNTS ===');
    const groupCount = await executeSQL(
      'SELECT COUNT(*) as count FROM classwaves.sessions.student_groups',
      'Count groups'
    );
    
    const participantCount = await executeSQL(
      'SELECT COUNT(*) as count FROM classwaves.sessions.participants',
      'Count participants'
    );
    
    if (groupCount?.result?.data_array?.[0]?.[0] !== undefined) {
      logger.debug(`Groups: ${groupCount.result.data_array[0][0]}`);
    }
    
    if (participantCount?.result?.data_array?.[0]?.[0] !== undefined) {
      logger.debug(`Participants: ${participantCount.result.data_array[0][0]}`);
    }
    
  } catch (error) {
    logger.error('❌ Error checking schema:', error);
  }
}

if (require.main === module) {
  checkGroupSchema();
}

export { checkGroupSchema };