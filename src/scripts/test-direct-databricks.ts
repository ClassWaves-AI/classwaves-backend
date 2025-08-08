import { DBSQLClient } from '@databricks/sql';
import dotenv from 'dotenv';

dotenv.config();

async function testDirectConnection() {
  console.log('🧪 Testing Direct Databricks connection...\n');
  
  const client = new DBSQLClient();
  
  try {
    console.log('Connecting with parameters:');
    console.log('Host:', process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, ''));
    console.log('Path:', `/sql/1.0/warehouses/${process.env.DATABRICKS_WAREHOUSE_ID}`);
    console.log('Token length:', process.env.DATABRICKS_TOKEN?.length);
    
    // Try different path formats
    const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID || '';
    const paths = [
      `/sql/1.0/warehouses/${warehouseId}`,
      `/sql/1.0/endpoints/${warehouseId}`,
      `/sql/protocolv1/o/0/${warehouseId}`,
    ];
    
    let connected = false;
    for (const path of paths) {
      console.log(`Trying path: ${path}`);
      try {
        await client.connect({
          host: process.env.DATABRICKS_HOST?.replace(/^https?:\/\//, '') || '',
          path: path,
          token: process.env.DATABRICKS_TOKEN || '',
          authType: 'access-token',
        } as any);
        console.log(`✅ Connected with path: ${path}`);
        connected = true;
        break;
      } catch (error: any) {
        console.log(`❌ Failed with path ${path}: ${error.message}`);
      }
    }
    
    if (!connected) {
      throw new Error('Could not connect with any path format');
    }
    
    console.log('✅ Connected!\n');
    
    const session = await client.openSession();
    console.log('✅ Session opened\n');
    
    try {
      // Test 1: Simple query
      console.log('Test 1: SELECT 1');
      const operation1 = await session.executeStatement('SELECT 1 as test');
      const result1 = await operation1.fetchAll();
      console.log('Result:', result1);
      await operation1.close();
      
      // Test 2: Show catalogs
      console.log('\nTest 2: SHOW CATALOGS');
      const operation2 = await session.executeStatement('SHOW CATALOGS');
      const result2 = await operation2.fetchAll();
      console.log('Catalogs:', result2);
      await operation2.close();
      
      // Test 3: Create catalog
      console.log('\nTest 3: CREATE CATALOG IF NOT EXISTS classwaves');
      const operation3 = await session.executeStatement('CREATE CATALOG IF NOT EXISTS classwaves');
      const result3 = await operation3.fetchAll();
      console.log('Create catalog result:', result3);
      await operation3.close();
      
    } catch (error: any) {
      console.error('Query error:', error);
      console.error('Error details:', error.response?.data || error.message);
    } finally {
      await session.close();
    }
    
  } catch (error: any) {
    console.error('Connection error:', error);
    console.error('Error details:', error.response?.data || error.message);
  } finally {
    await client.close();
    console.log('\n👋 Disconnected');
  }
}

if (require.main === module) {
  testDirectConnection().catch(console.error);
}