import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';

dotenv.config();

async function checkCatalogState() {
  console.log('🔍 Checking Databricks catalog state...\n');
  
  try {
    await databricksService.connect();
    console.log('✅ Connected to Databricks\n');
    
    // List all catalogs
    console.log('📚 Available catalogs:');
    const catalogs = await databricksService.query('SHOW CATALOGS');
    catalogs.forEach((cat: any) => {
      console.log(`   - ${cat.catalog || cat.catalog_name || Object.values(cat)[0]}`);
    });
    
    // Check if classwaves exists
    const classwavesCatalog = await databricksService.query("SHOW CATALOGS LIKE 'classwaves'");
    if (classwavesCatalog && classwavesCatalog.length > 0) {
      console.log('\n✅ Catalog "classwaves" exists');
      
      // Use the catalog
      await databricksService.query('USE CATALOG classwaves');
      console.log('✅ Using catalog classwaves');
      
      // List schemas
      console.log('\n📁 Schemas in classwaves catalog:');
      const schemas = await databricksService.query('SHOW SCHEMAS');
      schemas.forEach((schema: any) => {
        const schemaName = schema.schema_name || schema.database_name || schema.namespace || Object.values(schema)[0];
        console.log(`   - ${schemaName}`);
      });
      
      // Check each schema for tables
      for (const schema of schemas) {
        const schemaName = schema.schema_name || schema.database_name || schema.namespace || Object.values(schema)[0];
        if (schemaName && typeof schemaName === 'string') {
          console.log(`\n📋 Tables in schema "${schemaName}":`);
          try {
            await databricksService.query(`USE SCHEMA ${schemaName}`);
            const tables = await databricksService.query('SHOW TABLES');
            if (tables && tables.length > 0) {
              tables.forEach((table: any) => {
                const tableName = table.tableName || table.table_name || Object.values(table)[0];
                console.log(`   - ${tableName}`);
              });
            } else {
              console.log('   (no tables)');
            }
          } catch (error: any) {
            console.log(`   Error: ${error.message}`);
          }
        }
      }
      
      // Check current catalog and schema
      console.log('\n📍 Current context:');
      const currentCatalog = await databricksService.query('SELECT current_catalog()');
      const currentSchema = await databricksService.query('SELECT current_schema()');
      console.log(`   - Current catalog: ${currentCatalog[0]['current_catalog()']}`);
      console.log(`   - Current schema: ${currentSchema[0]['current_schema()']}`);
      
    } else {
      console.log('\n❌ Catalog "classwaves" does not exist');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await databricksService.disconnect();
    console.log('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  checkCatalogState().catch(console.error);
}

export { checkCatalogState };