import { DBSQLClient } from '@databricks/sql';
import dotenv from 'dotenv';

dotenv.config();

async function testWarehouseFormats() {
  const token = process.env.DATABRICKS_TOKEN || '';
  const serverHostname = process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '') || '';
  const originalWarehouseId = process.env.DATABRICKS_WAREHOUSE_ID || '';
  
  console.log('Original Warehouse ID:', originalWarehouseId);
  console.log('Server Hostname:', serverHostname);
  console.log();
  
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
  
  console.log('Testing different warehouse ID formats:');
  
  for (const warehouseId of warehouseIdFormats) {
    console.log(`\nTrying warehouse ID: ${warehouseId}`);
    
    const client = new DBSQLClient();
    const httpPath = `/sql/1.0/warehouses/${warehouseId}`;
    
    try {
      await client.connect({
        token: token,
        host: serverHostname,
        path: httpPath
      });
      
      console.log('✅ Connected successfully!');
      
      try {
        const session = await client.openSession();
        console.log('✅ Session opened successfully!');
        
        const operation = await session.executeStatement('SELECT 1');
        const result = await operation.fetchAll();
        await operation.close();
        
        console.log('✅ Query executed successfully!');
        console.log('Result:', result);
        
        await session.close();
        await client.close();
        
        console.log(`\n🎉 SUCCESS! The correct warehouse ID format is: ${warehouseId}`);
        return;
      } catch (e: any) {
        console.error('❌ Session/Query error:', e.message);
      }
      
      await client.close();
    } catch (e: any) {
      console.error('❌ Connection error:', e.message);
      if (e.response?.headers) {
        const errorMsg = e.response.headers.get('x-thriftserver-error-message');
        if (errorMsg) {
          console.error('Server error:', errorMsg);
        }
      }
    }
  }
  
  console.log('\n❌ None of the warehouse ID formats worked.');
}

testWarehouseFormats().catch(console.error);