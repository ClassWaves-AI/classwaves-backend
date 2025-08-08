import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';

dotenv.config();

async function checkMainSchema() {
  console.log('🔍 Checking classwaves.main schema specifically...\n');
  
  try {
    await databricksService.connect();
    console.log('✅ Connected to Databricks\n');
    
    // Set context explicitly
    console.log('Setting context to classwaves.main...');
    await databricksService.query('USE CATALOG classwaves');
    await databricksService.query('USE SCHEMA main');
    
    // Verify current context
    const currentCatalog = await databricksService.query('SELECT current_catalog()');
    const currentSchema = await databricksService.query('SELECT current_schema()');
    console.log(`Current catalog: ${currentCatalog[0]['current_catalog()']}`);
    console.log(`Current schema: ${currentSchema[0]['current_schema()']}`);
    
    // List tables in current schema
    console.log('\n📋 Tables in classwaves.main:');
    const tables = await databricksService.query('SHOW TABLES IN classwaves.main');
    
    if (tables && tables.length > 0) {
      console.log(`Found ${tables.length} tables:`);
      tables.forEach((table: any, index: number) => {
        console.log(`${index + 1}. Table info:`, table);
      });
      
      // Try to check a specific table
      console.log('\n🔍 Checking schools table specifically:');
      try {
        const schoolsExists = await databricksService.query('DESCRIBE TABLE classwaves.main.schools');
        console.log('✅ schools table exists with columns:', schoolsExists.length);
      } catch (error: any) {
        console.log('❌ schools table not found:', error.message);
      }
      
    } else {
      console.log('❌ No tables found in classwaves.main');
      
      // Try creating a simple test table
      console.log('\n🧪 Attempting to create a test table...');
      try {
        await databricksService.query(`
          CREATE TABLE IF NOT EXISTS classwaves.main.test_table (
            id STRING,
            name STRING,
            created_at TIMESTAMP
          ) USING DELTA
        `);
        console.log('✅ Test table created successfully');
        
        // Verify it exists
        const testTableExists = await databricksService.query('SHOW TABLES IN classwaves.main LIKE "test_table"');
        console.log('Test table verification:', testTableExists);
        
      } catch (error: any) {
        console.log('❌ Failed to create test table:', error.message);
      }
    }
    
    // Check permissions
    console.log('\n🔐 Checking permissions:');
    try {
      const grants = await databricksService.query('SHOW GRANTS ON SCHEMA classwaves.main');
      console.log('Schema grants:', grants);
    } catch (error: any) {
      console.log('Could not check grants:', error.message);
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  } finally {
    await databricksService.disconnect();
    console.log('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  checkMainSchema().catch(console.error);
}

export { checkMainSchema };