import { DBSQLClient } from '@databricks/sql';
import dotenv from 'dotenv';

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
  
  console.log('Warehouse ID:', warehouseId);
  
  console.log('Configuration:');
  console.log('Server Hostname:', serverHostname);
  console.log('Token (first 10 chars):', token.substring(0, 10) + '...');
  console.log('Token format check:');
  console.log('- Starts with "dapi":', token.startsWith('dapi'));
  console.log('- Length:', token.length);
  console.log();

  for (const httpPath of paths) {
    console.log(`\nTrying path: ${httpPath}`);
    
    const client = new DBSQLClient();

    const connectOptions = {
      token: token,
      host: serverHostname,
      path: httpPath
    };

    try {
      await client.connect(connectOptions);
    console.log('✅ Client connected successfully');
    
    const session = await client.openSession();
    console.log('✅ Session opened successfully');
    
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

    console.log('✅ Query executed successfully');
    console.log('Result:', result);

      await session.close();
      await client.close();
      
      console.log('✅ All operations completed successfully');
      return; // Success, exit the loop
    } catch (e: any) {
      console.error('❌ Error:', e.message);
      if (e.response) {
        console.error('Response status:', e.response.status);
        console.error('Response statusText:', e.response.statusText);
        if (e.response.headers) {
          const errorMsg = e.response.headers.get('x-thriftserver-error-message');
          if (errorMsg) {
            console.error('Error message:', errorMsg);
          }
        }
      }
      await client.close();
    }
  }
}

minimalTest().catch(console.error);