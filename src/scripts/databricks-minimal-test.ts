import { DBSQLClient } from '@databricks/sql';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function minimalTest() {
  const token = process.env.DATABRICKS_TOKEN || '';
  const serverHostname = process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '') || '';
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID || '';
  
  // Try both paths
  const paths = [
    `/sql/1.0/warehouses/${warehouseId}`,
    `/sql/1.0/endpoints/${warehouseId}`
  ];
  
  logger.debug('Warehouse ID:', warehouseId);
  
  logger.debug('Configuration:');
  logger.debug('Server Hostname:', serverHostname);
  logger.debug('Token (first 10 chars):', token.substring(0, 10) + '...');
  logger.debug('Token format check:');
  logger.debug('- Starts with "dapi":', token.startsWith('dapi'));
  logger.debug('- Length:', token.length);

  for (const httpPath of paths) {
    logger.debug(`\nTrying path: ${httpPath}`);
    
    const client = new DBSQLClient();

    const connectOptions = {
      token: token,
      host: serverHostname,
      path: httpPath
    };

    try {
      await client.connect(connectOptions);
    logger.debug('✅ Client connected successfully');
    
    const session = await client.openSession();
    logger.debug('✅ Session opened successfully');
    
    // Try the simplest possible query
    const queryOperation = await session.executeStatement(
      'SELECT 1',
      {
        runAsync: true,
        maxRows: 10000 // This is one possible difference
      }
    );
    
    const result = await queryOperation.fetchAll();
    await queryOperation.close();

    logger.debug('✅ Query executed successfully');
    logger.debug('Result:', result);

      await session.close();
      await client.close();
      
      logger.debug('✅ All operations completed successfully');
      return; // Success, exit the loop
    } catch (e: any) {
      logger.error('❌ Error:', e.message);
      if (e.response) {
        logger.error('Response status:', e.response.status);
        logger.error('Response statusText:', e.response.statusText);
        if (e.response.headers) {
          const errorMsg = e.response.headers.get('x-thriftserver-error-message');
          if (errorMsg) {
            logger.error('Error message:', errorMsg);
          }
        }
      }
      await client.close();
    }
  }
}

minimalTest().catch(console.error);
