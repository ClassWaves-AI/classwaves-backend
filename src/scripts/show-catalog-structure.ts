import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function showCatalogStructure() {
  const host = 'https://dbc-d5db37cb-5441.cloud.databricks.com';
  const token = process.env.DATABRICKS_TOKEN;
  const warehouseId = '077a4c2149eade40';
  const catalog = 'classwaves';
  
  const axiosConfig = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  logger.debug('📚 ClassWaves Unity Catalog Structure\n');
  logger.debug('=' .repeat(60));
  logger.debug(`Catalog: ${catalog}`);
  logger.debug(`Host: ${host}`);
  logger.debug(`Warehouse: ${warehouseId}`);
  logger.debug('=' .repeat(60) + '\n');

  async function executeStatement(statement: string): Promise<any> {
    try {
      const response = await axios.post(
        `${host}/api/2.0/sql/statements`,
        {
          warehouse_id: warehouseId,
          statement: statement,
          wait_timeout: '30s'
        },
        axiosConfig
      );

      if (response.data.status?.state === 'SUCCEEDED') {
        return response.data.result;
      }

      const statementId = response.data.statement_id;
      let attempts = 0;
      
      while (attempts < 15) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const statusResponse = await axios.get(
          `${host}/api/2.0/sql/statements/${statementId}`,
          axiosConfig
        );

        const state = statusResponse.data.status?.state;
        
        if (state === 'SUCCEEDED') {
          return statusResponse.data.result;
        } else if (state === 'FAILED') {
          return null;
        }
        
        attempts++;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  // Set catalog context
  await executeStatement(`USE CATALOG ${catalog}`);

  // Get all schemas
  const schemasResult = await executeStatement('SHOW SCHEMAS');
  if (!schemasResult) return;

  const schemas = schemasResult.data_array
    .map((row: any[]) => row[1] || row[0])
    .filter((s: string) => s !== 'information_schema' && s !== 'default')
    .sort();

  logger.debug(`Found ${schemas.length} schemas:\n`);

  // For each schema, get tables
  for (const schema of schemas) {
    logger.debug(`📁 ${schema}`);
    
    const tablesResult = await executeStatement(`SHOW TABLES IN ${catalog}.${schema}`);
    
    if (tablesResult && tablesResult.data_array.length > 0) {
      const tables = tablesResult.data_array.map((row: any[]) => {
        // Row format: [catalog, schema, table, isTemporary]
        // Find the table name (usually third column)
        for (let i = 0; i < row.length; i++) {
          if (typeof row[i] === 'string' && row[i] !== catalog && row[i] !== schema) {
            return row[i];
          }
        }
        return row[2] || row[1] || row[0];
      });
      
      for (const table of tables) {
        // Get row count
        const countResult = await executeStatement(
          `SELECT COUNT(*) as count FROM ${catalog}.${schema}.${table}`
        );
        
        const rowCount = countResult ? countResult.data_array[0][0] : '?';
        logger.debug(`   📋 ${table} (${rowCount} rows)`);
      }
    } else {
      logger.debug(`   (no tables)`);
    }
    
    logger.debug('');
  }

  // Summary statistics
  logger.debug('=' .repeat(60));
  logger.debug('📊 Summary Statistics:');
  logger.debug('=' .repeat(60));
  
  const stats = [
    { table: 'users.schools', label: 'Schools' },
    { table: 'users.teachers', label: 'Teachers' },
    { table: 'users.students', label: 'Students' },
    { table: 'sessions.classroom_sessions', label: 'Sessions' },
    { table: 'sessions.student_groups', label: 'Groups' },
    { table: 'sessions.participants', label: 'Participants' },
    { table: 'compliance.audit_log', label: 'Audit Entries' }
  ];

  for (const { table, label } of stats) {
    const result = await executeStatement(
      `SELECT COUNT(*) as count FROM ${catalog}.${table}`
    );
    
    if (result && result.data_array.length > 0) {
      const count = result.data_array[0][0];
      logger.debug(`${label}: ${count}`);
    }
  }

  logger.debug('\n✨ Catalog structure display complete!');
}

showCatalogStructure().catch(console.error);