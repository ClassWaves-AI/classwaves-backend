import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function testConnection() {
  logger.debug('🧪 Testing Databricks connection...\n');
  
  try {
    // Test 1: Basic connection
    logger.debug('Test 1: Connecting to Databricks...');
    await databricksService.connect();
    logger.debug('✅ Connection successful!\n');
    
    // Test 2: List catalogs
    logger.debug('Test 2: Listing available catalogs...');
    try {
      const catalogs = await databricksService.query('SHOW CATALOGS');
      logger.debug('Available catalogs:', catalogs);
    } catch (error: any) {
      logger.debug('❌ Error listing catalogs:', error.message);
    }
    
    // Test 3: Check if classwaves catalog exists
    logger.debug('\nTest 3: Checking if classwaves catalog exists...');
    try {
      const result = await databricksService.query("SHOW CATALOGS LIKE 'classwaves'");
      logger.debug('Result:', result);
      
      if (result && result.length > 0) {
        logger.debug('✅ Catalog classwaves exists');
        
        // Use the catalog
        await databricksService.query('USE CATALOG classwaves');
        logger.debug('✅ Using catalog classwaves');
        
        // List schemas
        const schemas = await databricksService.query('SHOW SCHEMAS');
        logger.debug('Available schemas in classwaves:', schemas);
      } else {
        logger.debug('❌ Catalog classwaves does not exist');
        
        // Try to create it
        logger.debug('\nAttempting to create catalog classwaves...');
        try {
          await databricksService.query('CREATE CATALOG IF NOT EXISTS classwaves');
          logger.debug('✅ Catalog created successfully');
        } catch (error: any) {
          logger.debug('❌ Error creating catalog:', error.message);
        }
      }
    } catch (error: any) {
      logger.debug('❌ Error checking catalog:', error.message);
    }
    
    // Test 4: Simple query
    logger.debug('\nTest 4: Running a simple SELECT query...');
    try {
      const result = await databricksService.query('SELECT 1 as test, current_timestamp() as time');
      logger.debug('Query result:', result);
    } catch (error: any) {
      logger.debug('❌ Error running query:', error.message);
    }
    
    // Test 5: Show current catalog and schema
    logger.debug('\nTest 5: Checking current catalog and schema...');
    try {
      const currentCatalog = await databricksService.query('SELECT current_catalog()');
      const currentSchema = await databricksService.query('SELECT current_schema()');
      logger.debug('Current catalog:', currentCatalog);
      logger.debug('Current schema:', currentSchema);
    } catch (error: any) {
      logger.debug('❌ Error checking current context:', error.message);
    }
    
  } catch (error) {
    logger.error('❌ Fatal error:', error);
  } finally {
    await databricksService.disconnect();
    logger.debug('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  testConnection().catch(console.error);
}