import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function checkMainSchema() {
  logger.debug('🔍 Checking classwaves.main schema specifically...\n');
  
  try {
    await databricksService.connect();
    logger.debug('✅ Connected to Databricks\n');
    
    // Set context explicitly
    logger.debug('Setting context to classwaves.main...');
    await databricksService.query('USE CATALOG classwaves');
    await databricksService.query('USE SCHEMA main');
    
    // Verify current context
    const currentCatalog = await databricksService.query('SELECT current_catalog()');
    const currentSchema = await databricksService.query('SELECT current_schema()');
    logger.debug(`Current catalog: ${currentCatalog[0]['current_catalog()']}`);
    logger.debug(`Current schema: ${currentSchema[0]['current_schema()']}`);
    
    // List tables in current schema
    logger.debug('\n📋 Tables in classwaves.main:');
    const tables = await databricksService.query('SHOW TABLES IN classwaves.main');
    
    if (tables && tables.length > 0) {
      logger.debug(`Found ${tables.length} tables:`);
      tables.forEach((table: any, index: number) => {
        logger.debug(`${index + 1}. Table info:`, table);
      });
      
      // Try to check a specific table
      logger.debug('\n🔍 Checking schools table specifically:');
      try {
        const schoolsExists = await databricksService.query('DESCRIBE TABLE classwaves.main.schools');
        logger.debug('✅ schools table exists with columns:', schoolsExists.length);
      } catch (error: any) {
        logger.debug('❌ schools table not found:', error.message);
      }
      
    } else {
      logger.debug('❌ No tables found in classwaves.main');
      
      // Try creating a simple test table
      logger.debug('\n🧪 Attempting to create a test table...');
      try {
        await databricksService.query(`
          CREATE TABLE IF NOT EXISTS classwaves.main.test_table (
            id STRING,
            name STRING,
            created_at TIMESTAMP
          ) USING DELTA
        `);
        logger.debug('✅ Test table created successfully');
        
        // Verify it exists
        const testTableExists = await databricksService.query('SHOW TABLES IN classwaves.main LIKE "test_table"');
        logger.debug('Test table verification:', testTableExists);
        
      } catch (error: any) {
        logger.debug('❌ Failed to create test table:', error.message);
      }
    }
    
    // Check permissions
    logger.debug('\n🔐 Checking permissions:');
    try {
      const grants = await databricksService.query('SHOW GRANTS ON SCHEMA classwaves.main');
      logger.debug('Schema grants:', grants);
    } catch (error: any) {
      logger.debug('Could not check grants:', error.message);
    }
    
  } catch (error: any) {
    logger.error('❌ Error:', error.message);
    if (error.stack) {
      logger.error('Stack:', error.stack);
    }
  } finally {
    await databricksService.disconnect();
    logger.debug('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  checkMainSchema().catch(console.error);
}

export { checkMainSchema };