import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

async function verifySchema() {
  try {
    logger.debug('🔍 Verifying database schema...\n');
    
    await databricksService.connect();
    logger.debug('✅ Connected to Databricks\n');
    
    const tableInfo = await databricksService.query(
      `DESCRIBE TABLE ${databricksConfig.catalog}.sessions.classroom_sessions`
    );
    
    const columns = tableInfo.map((col: any) => col.col_name);
    
    logger.debug('📋 Schema verification results:');
    logger.debug('✅ Has access_code:', columns.includes('access_code'));
    logger.debug('✅ Has engagement_score:', columns.includes('engagement_score'));
    logger.debug('❌ Has participation_rate (should be false):', columns.includes('participation_rate'));
    
    const expectedColumns = ['access_code', 'engagement_score'];
    const missingColumns = expectedColumns.filter(col => !columns.includes(col));
    const hasParticipationRate = columns.includes('participation_rate');
    
    if (missingColumns.length === 0 && !hasParticipationRate) {
      logger.debug('\n🎉 Schema is correctly configured!');
      logger.debug('   ✓ access_code column exists (for student session joining)');
      logger.debug('   ✓ engagement_score column exists (for group-level metrics)');
      logger.debug('   ✓ participation_rate column removed (no longer needed)');
    } else {
      logger.debug('\n❌ Schema issues found:');
      if (missingColumns.length > 0) {
        logger.debug('   Missing columns:', missingColumns.join(', '));
      }
      if (hasParticipationRate) {
        logger.debug('   Unexpected column: participation_rate should be removed');
      }
    }
    
  } catch (error) {
    logger.error('❌ Error verifying schema:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

verifySchema();