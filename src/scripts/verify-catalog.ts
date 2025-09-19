import axios from 'axios';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function verifyCatalog() {
  const host = 'https://dbc-d5db37cb-5441.cloud.databricks.com';
  const token = process.env.DATABRICKS_TOKEN;
  const warehouseId = '077a4c2149eade40';
  
  const axiosConfig = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  logger.debug('🔍 Verifying Unity Catalog structure via REST API...\n');

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

      // Check immediate status
      if (response.data.status?.state === 'SUCCEEDED') {
        return response.data.result;
      } else if (response.data.status?.state === 'FAILED') {
        logger.error('Query failed:', response.data.status?.error?.message);
        return null;
      }

      // Wait for completion if pending
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
          logger.error('Query failed:', statusResponse.data.status?.error?.message);
          return null;
        }
        
        attempts++;
      }

      logger.error('Query timeout');
      return null;
    } catch (error: any) {
      logger.error('API Error:', error.response?.data?.message || error.message);
      return null;
    }
  }

  // 1. Check catalogs
  logger.debug('📚 Checking catalogs...');
  const catalogsResult = await executeStatement('SHOW CATALOGS');
  if (catalogsResult) {
    const catalogs = catalogsResult.data_array.map((row: any[]) => row[0]);
    logger.debug('Available catalogs:', catalogs);
    logger.debug(`✅ 'classwaves' catalog exists: ${catalogs.includes('classwaves')}\n`);
  }

  // 2. Set catalog context
  logger.debug('📂 Setting catalog context to classwaves...');
  await executeStatement('USE CATALOG classwaves');

  // 3. Check schemas
  logger.debug('📁 Checking schemas in classwaves catalog...');
  const schemasResult = await executeStatement('SHOW SCHEMAS IN classwaves');
  if (schemasResult) {
    const schemas = schemasResult.data_array
      .map((row: any[]) => row[1] || row[0])
      .filter((s: string) => s !== 'information_schema');
    
    logger.debug('Found schemas:', schemas);
    
    const expectedSchemas = [
      'users', 'sessions', 'analytics', 'compliance', 
      'ai_insights', 'operational', 'admin', 'communication', 
      'audio', 'notifications'
    ];
    
    logger.debug('\nSchema verification:');
    for (const schema of expectedSchemas) {
      const exists = schemas.includes(schema);
      logger.debug(`  ${schema}: ${exists ? '✅' : '❌'}`);
    }
  }

  // 4. Check specific tables
  logger.debug('\n📋 Checking key tables...');
  const tableChecks = [
    { schema: 'users', table: 'schools' },
    { schema: 'users', table: 'teachers' },
    { schema: 'sessions', table: 'classroom_sessions' },
    { schema: 'analytics', table: 'session_metrics' },
    { schema: 'compliance', table: 'audit_log' },
    { schema: 'admin', table: 'school_settings' }
  ];

  for (const { schema, table } of tableChecks) {
    const result = await executeStatement(
      `DESCRIBE TABLE classwaves.${schema}.${table}`
    );
    
    if (result) {
      const columnCount = result.data_array.length;
      logger.debug(`  ✅ classwaves.${schema}.${table} - ${columnCount} columns`);
    } else {
      logger.debug(`  ❌ classwaves.${schema}.${table} - not found`);
    }
  }

  // 5. Check for data
  logger.debug('\n📊 Checking for demo data...');
  const dataChecks = [
    { table: 'users.schools', name: 'Demo schools' },
    { table: 'users.teachers', name: 'Demo teachers' },
    { table: 'admin.districts', name: 'Demo districts' }
  ];

  for (const { table, name } of dataChecks) {
    const result = await executeStatement(
      `SELECT COUNT(*) as count FROM classwaves.${table}`
    );
    
    if (result && result.data_array.length > 0) {
      const count = result.data_array[0][0];
      logger.debug(`  ${name}: ${count} records`);
    }
  }

  logger.debug('\n✨ Verification complete!');
}

verifyCatalog().catch(console.error);