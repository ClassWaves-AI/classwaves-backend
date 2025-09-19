import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function verifyDatabase() {
  logger.debug('🔍 Verifying ClassWaves database setup...\n');
  
  try {
    await databricksService.connect();
    logger.debug('✅ Connected to Databricks\n');
    
    // Check catalog
    logger.debug('📚 Checking catalog...');
    const catalogs = await databricksService.query("SHOW CATALOGS LIKE 'classwaves'");
    if (catalogs && catalogs.length > 0) {
      logger.debug('✅ Catalog "classwaves" exists\n');
    }
    
    // Use catalog and schema
    await databricksService.query('USE CATALOG classwaves');
    await databricksService.query('USE SCHEMA main');
    
    // List all tables
    logger.debug('📋 Tables in classwaves.main:');
    const tables = await databricksService.query('SHOW TABLES');
    
    const tableNames = tables.map((t: any) => t.tableName || t.table_name || t.name || Object.values(t)[0]);
    tableNames.forEach((table: string) => {
      logger.debug(`   - ${table}`);
    });
    
    // Check row counts for key tables
    logger.debug('\n📊 Table row counts:');
    const keyTables = ['schools', 'teachers', 'sessions', 'groups', 'student_participants'];
    
    for (const table of keyTables) {
      try {
        const result = await databricksService.query(`SELECT COUNT(*) as count FROM ${table}`);
        const count = result[0]?.count || 0;
        logger.debug(`   - ${table}: ${count} rows`);
      } catch (error) {
        logger.debug(`   - ${table}: Error checking`);
      }
    }
    
    // Check demo data
    logger.debug('\n🧪 Checking demo data:');
    
    const demoSchool = await databricksService.queryOne(
      'SELECT * FROM schools WHERE domain = ?',
      ['demo.classwaves.com']
    );
    
    if (demoSchool) {
      logger.debug('✅ Demo school found:');
      logger.debug(`   - Name: ${demoSchool.name}`);
      logger.debug(`   - Subscription: ${demoSchool.subscription_tier} (${demoSchool.subscription_status})`);
    }
    
    const demoTeacher = await databricksService.queryOne(
      'SELECT * FROM teachers WHERE email = ?',
      ['teacher@demo.classwaves.com']
    );
    
    if (demoTeacher) {
      logger.debug('\n✅ Demo teacher found:');
      logger.debug(`   - Name: ${demoTeacher.name}`);
      logger.debug(`   - Role: ${demoTeacher.role}`);
      logger.debug(`   - Status: ${demoTeacher.status}`);
    }
    
    logger.debug('\n✨ Database verification complete!');
    
  } catch (error) {
    logger.error('❌ Error during verification:', error);
  } finally {
    await databricksService.disconnect();
    logger.debug('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  verifyDatabase().catch(console.error);
}

export { verifyDatabase };