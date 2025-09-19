import { config } from 'dotenv';
import { join } from 'path';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function getAllTableSchemas() {
  try {
    logger.debug('🔍 Getting all table schemas for ClassWaves...');
    
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
    
    // Function to execute SQL and get results
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
      
      if (!response.ok) {
        const error = await response.text();
        logger.error(`❌ HTTP Error:`, response.status, error);
        return [];
      }
      
      const result = await response.json() as any;
      
      if (result.result?.status?.sqlState || result.status?.statusCode === 'ERROR') {
        logger.error(`❌ SQL Error:`, result.result?.status || result.status);
        return [];
      }
      
      return result.result?.data_array || [];
    }
    
    // Tables we need to inspect
    const tables = [
      { name: 'classroom_sessions', catalog: 'classwaves', schema: 'sessions' },
      { name: 'student_groups', catalog: 'classwaves', schema: 'sessions' },
      { name: 'participants', catalog: 'classwaves', schema: 'sessions' },
      { name: 'students', catalog: 'classwaves', schema: 'users' },
      { name: 'teachers', catalog: 'classwaves', schema: 'users' },
      { name: 'schools', catalog: 'classwaves', schema: 'users' },
      { name: 'audit_log', catalog: 'classwaves', schema: 'compliance' }
    ];
    
    logger.debug('\n📊 TABLE SCHEMAS:\n');
    
    for (const table of tables) {
      logger.debug(`\n=== ${table.catalog}.${table.schema}.${table.name.toUpperCase()} ===`);
      
      try {
        const schemaData = await executeSQL(`DESCRIBE ${table.catalog}.${table.schema}.${table.name}`);
        
        if (schemaData.length > 0) {
          logger.debug(`\nColumns in ${table.name}:`);
          schemaData.forEach((row, index) => {
            const [colName, dataType, nullable] = row;
            logger.debug(`${index + 1}. ${colName} (${dataType})${nullable === 'YES' ? ' NULL' : ' NOT NULL'}`);
          });
          
          // Get sample count
          try {
            const countData = await executeSQL(`SELECT COUNT(*) as count FROM ${table.catalog}.${table.schema}.${table.name}`);
            const count = countData[0]?.[0] || 0;
            logger.debug(`📊 Row count: ${count}`);
          } catch (e) {
            logger.debug(`📊 Row count: Unable to get count`);
          }
        } else {
          logger.debug(`❌ No schema data found for ${table.name}`);
        }
      } catch (error) {
        logger.error(`❌ Error getting schema for ${table.name}:`, error);
      }
    }
    
    // Show catalogs and schemas structure
    logger.debug('\n\n=== CATALOG STRUCTURE ===');
    try {
      const catalogs = await executeSQL('SHOW CATALOGS');
      logger.debug('\nAvailable catalogs:');
      catalogs.forEach(row => {
        logger.debug(`- ${row[0]}`);
      });
      
      logger.debug('\nSchemas in classwaves catalog:');
      const schemas = await executeSQL('SHOW SCHEMAS IN classwaves');
      schemas.forEach(row => {
        logger.debug(`- classwaves.${row[0]}`);
      });
      
      // Show tables in each schema
      for (const schemaName of ['users', 'sessions', 'compliance']) {
        logger.debug(`\nTables in classwaves.${schemaName}:`);
        try {
          const schemaTables = await executeSQL(`SHOW TABLES IN classwaves.${schemaName}`);
          schemaTables.forEach(row => {
            logger.debug(`- ${row[1]}`); // table name is usually in second column
          });
        } catch (e) {
          logger.debug(`❌ Could not list tables in ${schemaName}`);
        }
      }
    } catch (error) {
      logger.error('❌ Error getting catalog structure:', error);
    }
    
    logger.debug('\n✅ Schema inspection complete!');
    
  } catch (error) {
    logger.error('❌ Error in schema inspection:', error);
  }
}

if (require.main === module) {
  getAllTableSchemas();
}

export { getAllTableSchemas };