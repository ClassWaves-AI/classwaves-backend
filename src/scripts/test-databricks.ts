import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';

dotenv.config();

async function testConnection() {
  console.log('🧪 Testing Databricks connection...\n');
  
  try {
    // Test 1: Basic connection
    console.log('Test 1: Connecting to Databricks...');
    await databricksService.connect();
    console.log('✅ Connection successful!\n');
    
    // Test 2: List catalogs
    console.log('Test 2: Listing available catalogs...');
    try {
      const catalogs = await databricksService.query('SHOW CATALOGS');
      console.log('Available catalogs:', catalogs);
    } catch (error: any) {
      console.log('❌ Error listing catalogs:', error.message);
    }
    
    // Test 3: Check if classwaves catalog exists
    console.log('\nTest 3: Checking if classwaves catalog exists...');
    try {
      const result = await databricksService.query("SHOW CATALOGS LIKE 'classwaves'");
      console.log('Result:', result);
      
      if (result && result.length > 0) {
        console.log('✅ Catalog classwaves exists');
        
        // Use the catalog
        await databricksService.query('USE CATALOG classwaves');
        console.log('✅ Using catalog classwaves');
        
        // List schemas
        const schemas = await databricksService.query('SHOW SCHEMAS');
        console.log('Available schemas in classwaves:', schemas);
      } else {
        console.log('❌ Catalog classwaves does not exist');
        
        // Try to create it
        console.log('\nAttempting to create catalog classwaves...');
        try {
          await databricksService.query('CREATE CATALOG IF NOT EXISTS classwaves');
          console.log('✅ Catalog created successfully');
        } catch (error: any) {
          console.log('❌ Error creating catalog:', error.message);
        }
      }
    } catch (error: any) {
      console.log('❌ Error checking catalog:', error.message);
    }
    
    // Test 4: Simple query
    console.log('\nTest 4: Running a simple SELECT query...');
    try {
      const result = await databricksService.query('SELECT 1 as test, current_timestamp() as time');
      console.log('Query result:', result);
    } catch (error: any) {
      console.log('❌ Error running query:', error.message);
    }
    
    // Test 5: Show current catalog and schema
    console.log('\nTest 5: Checking current catalog and schema...');
    try {
      const currentCatalog = await databricksService.query('SELECT current_catalog()');
      const currentSchema = await databricksService.query('SELECT current_schema()');
      console.log('Current catalog:', currentCatalog);
      console.log('Current schema:', currentSchema);
    } catch (error: any) {
      console.log('❌ Error checking current context:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error);
  } finally {
    await databricksService.disconnect();
    console.log('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  testConnection().catch(console.error);
}