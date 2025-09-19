import { DBSQLClient } from '@databricks/sql';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function testWarehouseFormats() {
  const token = process.env.DATABRICKS_TOKEN || '';
  const serverHostname = process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '') || '';
  const originalWarehouseId = process.env.DATABRICKS_WAREHOUSE_ID || '';
  
  logger.debug('Original Warehouse ID:', originalWarehouseId);
  logger.debug('Server Hostname:', serverHostname);
  
  // Try different warehouse ID formats
  const warehouseIdFormats = [
    originalWarehouseId,
    originalWarehouseId.toLowerCase(),
    // Convert numeric ID to hex
    Number(originalWarehouseId).toString(16),
    // Pad with zeros to make it 16 chars (common format)
    Number(originalWarehouseId).toString(16).padStart(16, '0'),
    // Try as a UUID-like format
    `${originalWarehouseId.slice(0,8)}-${originalWarehouseId.slice(8,12)}-${originalWarehouseId.slice(12)}`,
  ];
  
  logger.debug('Testing different warehouse ID formats:');
  
  for (const warehouseId of warehouseIdFormats) {
    logger.debug(`\nTrying warehouse ID: ${warehouseId}`);
    
    const client = new DBSQLClient();
    const httpPath = `/sql/1.0/warehouses/${warehouseId}`;
    
    try {
      await client.connect({
        token: token,
        host: serverHostname,
        path: httpPath
      });
      
      logger.debug('✅ Connected successfully!');
      
      try {
        const session = await client.openSession();
        logger.debug('✅ Session opened successfully!');
        
        const operation = await session.executeStatement('SELECT 1');
        const result = await operation.fetchAll();
        await operation.close();
        
        logger.debug('✅ Query executed successfully!');
        logger.debug('Result:', result);
        
        await session.close();
        await client.close();
        
        logger.debug(`\n🎉 SUCCESS! The correct warehouse ID format is: ${warehouseId}`);
        return;
      } catch (e: any) {
        logger.error('❌ Session/Query error:', e.message);
      }
      
      await client.close();
    } catch (e: any) {
      logger.error('❌ Connection error:', e.message);
      if (e.response?.headers) {
        const errorMsg = e.response.headers.get('x-thriftserver-error-message');
        if (errorMsg) {
          logger.error('Server error:', errorMsg);
        }
      }
    }
  }
  
  logger.debug('\n❌ None of the warehouse ID formats worked.');
}

testWarehouseFormats().catch(console.error);
