import { DBSQLClient } from '@databricks/sql';
import dotenv from 'dotenv';

dotenv.config();

async function testDatabricksSDK() {
  console.log('Testing Databricks connection with different configurations...\n');
  
  const token = process.env.DATABRICKS_TOKEN || '';
  const host = process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '') || '';
  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID || '';
  
  // The warehouse ID in Databricks UI is often shown as a hex string
  // Let's try to find the correct format
  const warehouseHex = warehouseId.length === 15 ? 
    // If it's 15 digits, it might need to be converted to hex
    '0' + Number(warehouseId).toString(16) : 
    warehouseId;
    
  console.log('Environment:');
  console.log('- Host:', host);
  console.log('- Warehouse ID (original):', warehouseId);
  console.log('- Warehouse ID (hex):', warehouseHex);
  console.log('- Token prefix:', token.substring(0, 10) + '...');
  console.log();
  
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
    
    console.log('Connecting with options:', {
      ...connectionOptions,
      token: connectionOptions.token.substring(0, 10) + '...'
    });
    
    await client.connect(connectionOptions);
    console.log('✅ Connected to Databricks\n');
    
    // Now let's try to use the session
    const session = await client.openSession();
    console.log('✅ Session opened\n');
    
    // First, let's check what catalogs we have access to
    console.log('Checking available catalogs...');
    const catalogOp = await session.executeStatement(
      'SHOW CATALOGS',
      {
        runAsync: false
      }
    );
    
    const catalogs = await catalogOp.fetchAll();
    await catalogOp.close();
    
    console.log('Available catalogs:', catalogs);
    console.log();
    
    // Try creating our catalog
    console.log('Creating classwaves catalog...');
    const createCatalogOp = await session.executeStatement(
      'CREATE CATALOG IF NOT EXISTS classwaves',
      {
        runAsync: false
      }
    );
    
    await createCatalogOp.fetchAll();
    await createCatalogOp.close();
    
    console.log('✅ Catalog creation completed\n');
    
    await session.close();
    await client.close();
    
    console.log('✅ All operations completed successfully!');
    console.log(`\nUse this warehouse ID in your .env file: ${warehouseHex}`);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    
    if (error.response) {
      console.error('\nResponse details:');
      console.error('- Status:', error.response.status);
      console.error('- Status Text:', error.response.statusText);
      
      if (error.response.headers) {
        const errorMsg = error.response.headers.get('x-thriftserver-error-message');
        if (errorMsg) {
          console.error('- Server Error:', errorMsg);
        }
        
        const requestId = error.response.headers.get('x-request-id');
        if (requestId) {
          console.error('- Request ID:', requestId);
        }
      }
      
      if (error.response.data) {
        console.error('- Response Data:', error.response.data);
      }
    }
    
    await client.close();
  }
}

testDatabricksSDK().catch(console.error);