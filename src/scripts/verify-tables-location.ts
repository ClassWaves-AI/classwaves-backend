import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';

dotenv.config();

async function verifyTablesLocation() {
  console.log('🔍 Verifying table locations...\n');
  
  try {
    await databricksService.connect();
    console.log('✅ Connected to Databricks\n');
    
    // Check what's in the workspace.default
    console.log('📋 Tables in workspace.default:');
    try {
      const defaultTables = await databricksService.query('SHOW TABLES IN workspace.default');
      if (defaultTables && defaultTables.length > 0) {
        defaultTables.forEach((table: any) => {
          const tableName = table.tableName || table.table_name || Object.values(table)[1];
          console.log(`   - ${tableName}`);
        });
      } else {
        console.log('   (no tables)');
      }
    } catch (error: any) {
      console.log('   Error:', error.message);
    }
    
    // Check what's in classwaves.main
    console.log('\n📋 Tables in classwaves.main:');
    try {
      const mainTables = await databricksService.query('SHOW TABLES IN classwaves.main');
      if (mainTables && mainTables.length > 0) {
        mainTables.forEach((table: any) => {
          const tableName = table.tableName || table.table_name || Object.values(table)[1];
          console.log(`   - ${tableName}`);
        });
      } else {
        console.log('   (no tables)');
      }
    } catch (error: any) {
      console.log('   Error:', error.message);
    }
    
    // Try to query from fully qualified names
    console.log('\n🔍 Checking fully qualified table names:');
    
    const checkTable = async (fullName: string) => {
      process.stdout.write(`   ${fullName}: `);
      try {
        const result = await databricksService.query(`SELECT COUNT(*) as count FROM ${fullName}`);
        console.log(`✅ (${result[0].count} rows)`);
      } catch (error: any) {
        console.log('❌');
      }
    };
    
    await checkTable('workspace.default.schools');
    await checkTable('workspace.default.teachers');
    await checkTable('classwaves.main.schools');
    await checkTable('classwaves.main.teachers');
    
    // Check where demo data is
    console.log('\n🔍 Looking for demo data:');
    try {
      console.log('\nIn workspace.default:');
      const defaultDemo = await databricksService.query(
        "SELECT * FROM workspace.default.schools WHERE domain = 'demo.classwaves.com'"
      );
      if (defaultDemo && defaultDemo.length > 0) {
        console.log('✅ Found demo school in workspace.default');
      }
    } catch (error) {
      console.log('❌ No demo data in workspace.default');
    }
    
    try {
      console.log('\nIn classwaves.main:');
      const mainDemo = await databricksService.query(
        "SELECT * FROM classwaves.main.schools WHERE domain = 'demo.classwaves.com'"
      );
      if (mainDemo && mainDemo.length > 0) {
        console.log('✅ Found demo school in classwaves.main');
      }
    } catch (error) {
      console.log('❌ No demo data in classwaves.main');
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await databricksService.disconnect();
    console.log('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  verifyTablesLocation().catch(console.error);
}

export { verifyTablesLocation };