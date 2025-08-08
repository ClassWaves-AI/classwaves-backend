import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';

dotenv.config();

async function verifyDatabase() {
  console.log('🔍 Verifying ClassWaves database setup...\n');
  
  try {
    await databricksService.connect();
    console.log('✅ Connected to Databricks\n');
    
    // Check catalog
    console.log('📚 Checking catalog...');
    const catalogs = await databricksService.query("SHOW CATALOGS LIKE 'classwaves'");
    if (catalogs && catalogs.length > 0) {
      console.log('✅ Catalog "classwaves" exists\n');
    }
    
    // Use catalog and schema
    await databricksService.query('USE CATALOG classwaves');
    await databricksService.query('USE SCHEMA main');
    
    // List all tables
    console.log('📋 Tables in classwaves.main:');
    const tables = await databricksService.query('SHOW TABLES');
    
    const tableNames = tables.map((t: any) => t.tableName || t.table_name || t.name || Object.values(t)[0]);
    tableNames.forEach((table: string) => {
      console.log(`   - ${table}`);
    });
    
    // Check row counts for key tables
    console.log('\n📊 Table row counts:');
    const keyTables = ['schools', 'teachers', 'sessions', 'groups', 'student_participants'];
    
    for (const table of keyTables) {
      try {
        const result = await databricksService.query(`SELECT COUNT(*) as count FROM ${table}`);
        const count = result[0]?.count || 0;
        console.log(`   - ${table}: ${count} rows`);
      } catch (error) {
        console.log(`   - ${table}: Error checking`);
      }
    }
    
    // Check demo data
    console.log('\n🧪 Checking demo data:');
    
    const demoSchool = await databricksService.queryOne(
      'SELECT * FROM schools WHERE domain = ?',
      ['demo.classwaves.com']
    );
    
    if (demoSchool) {
      console.log('✅ Demo school found:');
      console.log(`   - Name: ${demoSchool.name}`);
      console.log(`   - Subscription: ${demoSchool.subscription_tier} (${demoSchool.subscription_status})`);
    }
    
    const demoTeacher = await databricksService.queryOne(
      'SELECT * FROM teachers WHERE email = ?',
      ['teacher@demo.classwaves.com']
    );
    
    if (demoTeacher) {
      console.log('\n✅ Demo teacher found:');
      console.log(`   - Name: ${demoTeacher.name}`);
      console.log(`   - Role: ${demoTeacher.role}`);
      console.log(`   - Status: ${demoTeacher.status}`);
    }
    
    console.log('\n✨ Database verification complete!');
    
  } catch (error) {
    console.error('❌ Error during verification:', error);
  } finally {
    await databricksService.disconnect();
    console.log('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  verifyDatabase().catch(console.error);
}

export { verifyDatabase };