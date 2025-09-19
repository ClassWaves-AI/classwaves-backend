import { DBSQLClient } from '@databricks/sql';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function testDirectConnection() {
  logger.debug('🧪 Testing Direct Databricks connection...\n');
  
  const client = new DBSQLClient();
  
  try {
    logger.debug('Connecting with parameters:');
    logger.debug('Host:', process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, ''));
    logger.debug('Path:', `/sql/1.0/warehouses/${process.env.DATABRICKS_WAREHOUSE_ID}`);
    logger.debug('Token length:', process.env.DATABRICKS_TOKEN?.length);
    
    // Try different path formats
    const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID || '';
    const paths = [
      `/sql/1.0/warehouses/${warehouseId}`,
      `/sql/1.0/endpoints/${warehouseId}`,
      `/sql/protocolv1/o/0/${warehouseId}`,
    ];
    
    let connected = false;
    for (const path of paths) {
      logger.debug(`Trying path: ${path}`);
      try {
        await client.connect({
          host: process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '') || '',
          path: path,
          token: process.env.DATABRICKS_TOKEN || '',
          authType: 'access-token',
        } as any);
        logger.debug(`✅ Connected with path: ${path}`);
        connected = true;
        break;
      } catch (error: any) {
        logger.debug(`❌ Failed with path ${path}: ${error.message}`);
      }
    }
    
    if (!connected) {
      throw new Error('Could not connect with any path format');
    }
    
    logger.debug('✅ Connected!\n');
    
    const session = await client.openSession();
    logger.debug('✅ Session opened\n');
    
    try {
      // Test 1: Simple query
      logger.debug('Test 1: SELECT 1');
      const operation1 = await session.executeStatement('SELECT 1 as test');
      const result1 = await operation1.fetchAll();
      logger.debug('Result:', result1);
      await operation1.close();
      
      // Test 2: Show catalogs
      logger.debug('\nTest 2: SHOW CATALOGS');
      const operation2 = await session.executeStatement('SHOW CATALOGS');
      const result2 = await operation2.fetchAll();
      logger.debug('Catalogs:', result2);
      await operation2.close();
      
      // Test 3: Create catalog
      logger.debug('\nTest 3: CREATE CATALOG IF NOT EXISTS classwaves');
      const operation3 = await session.executeStatement('CREATE CATALOG IF NOT EXISTS classwaves');
      const result3 = await operation3.fetchAll();
      logger.debug('Create catalog result:', result3);
      await operation3.close();
      
    } catch (error: any) {
      logger.error('Query error:', error);
      logger.error('Error details:', error.response?.data || error.message);
    } finally {
      await session.close();
    }
    
  } catch (error: any) {
    logger.error('Connection error:', error);
    logger.error('Error details:', error.response?.data || error.message);
  } finally {
    await client.close();
    logger.debug('\n👋 Disconnected');
  }
}

if (require.main === module) {
  testDirectConnection().catch(console.error);
}