import { DBSQLClient } from '@databricks/sql';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function testDatabricksSDK() {
  logger.debug('Testing Databricks connection with different configurations...\n');
  
  const token = process.env.DATABRICKS_TOKEN || '';
  const host = process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '') || '';
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID || '';
  
  // The warehouse ID in Databricks UI is often shown as a hex string
  // Let's try to find the correct format
  const warehouseHex = warehouseId.length === 15 ? 
    // If it's 15 digits, it might need to be converted to hex
    '0' + Number(warehouseId).toString(16) : 
    warehouseId;
    
  logger.debug('Environment:');
  logger.debug('- Host:', host);
  logger.debug('- Warehouse ID (original):', warehouseId);
  logger.debug('- Warehouse ID (hex):', warehouseHex);
  logger.debug('- Token prefix:', token.substring(0, 10) + '...');
  
  const client = new DBSQLClient();
  
  try {
    // Try the standard connection format as per Databricks docs
    const connectionOptions = {
      host: host,
      path: `/sql/1.0/warehouses/${warehouseHex}`,
      token: token,
      // Additional options that might help
      authType: 'access-token' as any,
      // Try with explicit protocol
      options: {
        'http_protocol': 'https',
        'http_port': 443,
      }
    };
    
    logger.debug('Connecting with options:', {
      ...connectionOptions,
      token: connectionOptions.token.substring(0, 10) + '...'
    });
    
    await client.connect(connectionOptions);
    logger.debug('✅ Connected to Databricks\n');
    
    // Now let's try to use the session
    const session = await client.openSession();
    logger.debug('✅ Session opened\n');
    
    // First, let's check what catalogs we have access to
    logger.debug('Checking available catalogs...');
    const catalogOp = await session.executeStatement(
      'SHOW CATALOGS',
      {
        runAsync: false
      }
    );
    
    const catalogs = await catalogOp.fetchAll();
    await catalogOp.close();
    
    logger.debug('Available catalogs:', catalogs);
    
    // Try creating our catalog
    logger.debug('Creating classwaves catalog...');
    const createCatalogOp = await session.executeStatement(
      'CREATE CATALOG IF NOT EXISTS classwaves',
      {
        runAsync: false
      }
    );
    
    await createCatalogOp.fetchAll();
    await createCatalogOp.close();
    
    logger.debug('✅ Catalog creation completed\n');
    
    await session.close();
    await client.close();
    
    logger.debug('✅ All operations completed successfully!');
    logger.debug(`\nUse this warehouse ID in your .env file: ${warehouseHex}`);
    
  } catch (error: any) {
    logger.error('❌ Error:', error.message);
    
    if (error.response) {
      logger.error('\nResponse details:');
      logger.error('- Status:', error.response.status);
      logger.error('- Status Text:', error.response.statusText);
      
      if (error.response.headers) {
        const errorMsg = error.response.headers.get('x-thriftserver-error-message');
        if (errorMsg) {
          logger.error('- Server Error:', errorMsg);
        }
        
        const requestId = error.response.headers.get('x-request-id');
        if (requestId) {
          logger.error('- Request ID:', requestId);
        }
      }
      
      if (error.response.data) {
        logger.error('- Response Data:', error.response.data);
      }
    }
    
    await client.close();
  }
}

testDatabricksSDK().catch(console.error);
