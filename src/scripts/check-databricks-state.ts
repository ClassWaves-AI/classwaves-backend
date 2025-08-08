import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';

dotenv.config();

async function checkDatabricksState() {
  console.log('🔍 Checking current Databricks state...\n');
  
  try {
    await databricksService.connect();
    console.log('✅ Connected to Databricks\n');
    
    // List all catalogs
    console.log('📚 Available catalogs:');
    const catalogs = await databricksService.query('SHOW CATALOGS');
    catalogs.forEach((cat: any) => {
      const catalogName = cat.catalog || cat.catalog_name || Object.values(cat)[0];
      console.log(`   - ${catalogName}`);
    });
    
    // Check classwaves catalog
    const classwavesCatalog = catalogs.find((cat: any) => {
      const name = cat.catalog || cat.catalog_name || Object.values(cat)[0];
      return name === 'classwaves';
    });
    
    if (classwavesCatalog) {
      console.log('\n✅ Catalog "classwaves" exists');
      
      // List schemas in classwaves
      console.log('\n📁 Schemas in classwaves catalog:');
      await databricksService.query('USE CATALOG classwaves');
      const schemas = await databricksService.query('SHOW SCHEMAS');
      
      schemas.forEach((schema: any) => {
        const schemaName = schema.schema_name || schema.database_name || schema.namespace || Object.values(schema)[0];
        if (schemaName !== 'information_schema') {
          console.log(`   - ${schemaName}`);
        }
      });
      
      // Check each schema for tables
      const userSchemas = schemas.filter((s: any) => {
        const name = s.schema_name || s.database_name || s.namespace || Object.values(s)[0];
        return name !== 'information_schema';
      });
      
      if (userSchemas.length > 0) {
        console.log('\n📋 Tables in each schema:');
        
        for (const schema of userSchemas) {
          const schemaName = schema.schema_name || schema.database_name || schema.namespace || Object.values(schema)[0];
          console.log(`\n   ${schemaName}:`);
          
          try {
            const tables = await databricksService.query(`SHOW TABLES IN classwaves.${schemaName}`);
            if (tables && tables.length > 0) {
              tables.forEach((table: any) => {
                const tableName = table.tableName || table.table_name || Object.values(table)[1];
                console.log(`     - ${tableName}`);
              });
            } else {
              console.log('     (no tables)');
            }
          } catch (error: any) {
            console.log(`     Error: ${error.message}`);
          }
        }
      }
    } else {
      console.log('\n❌ Catalog "classwaves" does not exist');
    }
    
    // Check workspace.default
    console.log('\n📋 Tables in workspace.default:');
    try {
      const workspaceTables = await databricksService.query('SHOW TABLES IN workspace.default');
      if (workspaceTables && workspaceTables.length > 0) {
        console.log(`   Found ${workspaceTables.length} tables`);
        const classWavesTables = workspaceTables.filter((t: any) => {
          const name = t.tableName || t.table_name || Object.values(t)[1];
          return ['schools', 'teachers', 'sessions', 'groups', 'student_participants', 'audit_log'].includes(name);
        });
        
        if (classWavesTables.length > 0) {
          console.log('\n   ClassWaves tables found in workspace.default:');
          classWavesTables.forEach((t: any) => {
            const name = t.tableName || t.table_name || Object.values(t)[1];
            console.log(`     - ${name}`);
          });
        }
      }
    } catch (error) {
      console.log('   Could not check workspace.default');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await databricksService.disconnect();
    console.log('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  checkDatabricksState().catch(console.error);
}

export { checkDatabricksState };