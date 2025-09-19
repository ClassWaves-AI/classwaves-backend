import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function checkCatalogState() {
  logger.debug('🔍 Checking Databricks catalog state...\n');
  
  try {
    await databricksService.connect();
    logger.debug('✅ Connected to Databricks\n');
    
    // List all catalogs
    logger.debug('📚 Available catalogs:');
    const catalogs = await databricksService.query('SHOW CATALOGS');
    catalogs.forEach((cat: any) => {
      logger.debug(`   - ${cat.catalog || cat.catalog_name || Object.values(cat)[0]}`);
    });
    
    // Check if classwaves exists
    const classwavesCatalog = await databricksService.query("SHOW CATALOGS LIKE 'classwaves'");
    if (classwavesCatalog && classwavesCatalog.length > 0) {
      logger.debug('\n✅ Catalog "classwaves" exists');
      
      // Use the catalog
      await databricksService.query('USE CATALOG classwaves');
      logger.debug('✅ Using catalog classwaves');
      
      // List schemas
      logger.debug('\n📁 Schemas in classwaves catalog:');
      const schemas = await databricksService.query('SHOW SCHEMAS');
      schemas.forEach((schema: any) => {
        const schemaName = schema.schema_name || schema.database_name || schema.namespace || Object.values(schema)[0];
        logger.debug(`   - ${schemaName}`);
      });
      
      // Check each schema for tables
      for (const schema of schemas) {
        const schemaName = schema.schema_name || schema.database_name || schema.namespace || Object.values(schema)[0];
        if (schemaName && typeof schemaName === 'string') {
          logger.debug(`\n📋 Tables in schema "${schemaName}":`);
          try {
            await databricksService.query(`USE SCHEMA ${schemaName}`);
            const tables = await databricksService.query('SHOW TABLES');
            if (tables && tables.length > 0) {
              tables.forEach((table: any) => {
                const tableName = table.tableName || table.table_name || Object.values(table)[0];
                logger.debug(`   - ${tableName}`);
              });
            } else {
              logger.debug('   (no tables)');
            }
          } catch (error: any) {
            logger.debug(`   Error: ${error.message}`);
          }
        }
      }
      
      // Check current catalog and schema
      logger.debug('\n📍 Current context:');
      const currentCatalog = await databricksService.query('SELECT current_catalog()');
      const currentSchema = await databricksService.query('SELECT current_schema()');
      logger.debug(`   - Current catalog: ${currentCatalog[0]['current_catalog()']}`);
      logger.debug(`   - Current schema: ${currentSchema[0]['current_schema()']}`);
      
    } else {
      logger.debug('\n❌ Catalog "classwaves" does not exist');
    }
    
  } catch (error) {
    logger.error('❌ Error:', error);
  } finally {
    await databricksService.disconnect();
    logger.debug('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  checkCatalogState().catch(console.error);
}

export { checkCatalogState };