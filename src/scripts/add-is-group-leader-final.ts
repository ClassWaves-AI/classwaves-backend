import { config } from 'dotenv';
import { join } from 'path';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function addIsGroupLeaderColumn() {
  try {
    logger.debug('🔧 Adding is_group_leader column to participants table...');
    
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
    
    // Add is_group_leader column to participants table
    const response = await fetch(`${host}/api/2.0/sql/statements`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        warehouse_id: warehouse,
        statement: `ALTER TABLE classwaves.sessions.participants ADD COLUMNS (is_group_leader BOOLEAN DEFAULT FALSE)`,
        wait_timeout: '50s'
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      logger.error('❌ HTTP Error:', response.status, error);
      return;
    }
    
    const result = await response.json() as any;
    
    if (result.result?.status?.sqlState || result.status?.statusCode === 'ERROR') {
      logger.error('❌ SQL Error:', result.result?.status || result.status);
      return;
    }
    
    logger.debug('✅ Successfully added is_group_leader column to participants table');
    
  } catch (error) {
    logger.error('❌ Error adding is_group_leader column:', error);
  }
}

if (require.main === module) {
  addIsGroupLeaderColumn();
}

export { addIsGroupLeaderColumn };