import { databricksService } from '../services/databricks.service';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

async function verifyTablesLocation() {
  logger.debug('🔍 Verifying table locations...\n');
  
  try {
    await databricksService.connect();
    logger.debug('✅ Connected to Databricks\n');
    
    // Check what's in the workspace.default
    logger.debug('📋 Tables in workspace.default:');
    try {
      const defaultTables = await databricksService.query('SHOW TABLES IN workspace.default');
      if (defaultTables && defaultTables.length > 0) {
        defaultTables.forEach((table: any) => {
          const tableName = table.tableName || table.table_name || Object.values(table)[1];
          logger.debug(`   - ${tableName}`);
        });
      } else {
        logger.debug('   (no tables)');
      }
    } catch (error: any) {
      logger.debug('   Error:', error.message);
    }
    
    // Check what's in classwaves.main
    logger.debug('\n📋 Tables in classwaves.main:');
    try {
      const mainTables = await databricksService.query('SHOW TABLES IN classwaves.main');
      if (mainTables && mainTables.length > 0) {
        mainTables.forEach((table: any) => {
          const tableName = table.tableName || table.table_name || Object.values(table)[1];
          logger.debug(`   - ${tableName}`);
        });
      } else {
        logger.debug('   (no tables)');
      }
    } catch (error: any) {
      logger.debug('   Error:', error.message);
    }
    
    // Try to query from fully qualified names
    logger.debug('\n🔍 Checking fully qualified table names:');
    
    const checkTable = async (fullName: string) => {
      process.stdout.write(`   ${fullName}: `);
      try {
        const result = await databricksService.query(`SELECT COUNT(*) as count FROM ${fullName}`);
        logger.debug(`✅ (${result[0].count} rows)`);
      } catch (error: any) {
        logger.debug('❌');
      }
    };
    
    await checkTable('workspace.default.schools');
    await checkTable('workspace.default.teachers');
    await checkTable('classwaves.main.schools');
    await checkTable('classwaves.main.teachers');
    
    // Check where demo data is
    logger.debug('\n🔍 Looking for demo data:');
    try {
      logger.debug('\nIn workspace.default:');
      const defaultDemo = await databricksService.query(
        "SELECT * FROM workspace.default.schools WHERE domain = 'demo.classwaves.com'"
      );
      if (defaultDemo && defaultDemo.length > 0) {
        logger.debug('✅ Found demo school in workspace.default');
      }
    } catch (error) {
      logger.debug('❌ No demo data in workspace.default');
    }
    
    try {
      logger.debug('\nIn classwaves.main:');
      const mainDemo = await databricksService.query(
        "SELECT * FROM classwaves.main.schools WHERE domain = 'demo.classwaves.com'"
      );
      if (mainDemo && mainDemo.length > 0) {
        logger.debug('✅ Found demo school in classwaves.main');
      }
    } catch (error) {
      logger.debug('❌ No demo data in classwaves.main');
    }
    
  } catch (error) {
    logger.error('❌ Error:', error);
  } finally {
    await databricksService.disconnect();
    logger.debug('\n👋 Disconnected from Databricks');
  }
}

if (require.main === module) {
  verifyTablesLocation().catch(console.error);
}

export { verifyTablesLocation };