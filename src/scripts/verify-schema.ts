import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function verifySchema() {
  try {
    console.log('🔍 Verifying database schema...\n');
    
    await databricksService.connect();
    console.log('✅ Connected to Databricks\n');
    
    const tableInfo = await databricksService.query(
      `DESCRIBE TABLE ${databricksConfig.catalog}.sessions.classroom_sessions`
    );
    
    const columns = tableInfo.map((col: any) => col.col_name);
    
    console.log('📋 Schema verification results:');
    console.log('✅ Has access_code:', columns.includes('access_code'));
    console.log('✅ Has engagement_score:', columns.includes('engagement_score'));
    console.log('❌ Has participation_rate (should be false):', columns.includes('participation_rate'));
    
    const expectedColumns = ['access_code', 'engagement_score'];
    const missingColumns = expectedColumns.filter(col => !columns.includes(col));
    const hasParticipationRate = columns.includes('participation_rate');
    
    if (missingColumns.length === 0 && !hasParticipationRate) {
      console.log('\n🎉 Schema is correctly configured!');
      console.log('   ✓ access_code column exists (for student session joining)');
      console.log('   ✓ engagement_score column exists (for group-level metrics)');
      console.log('   ✓ participation_rate column removed (no longer needed)');
    } else {
      console.log('\n❌ Schema issues found:');
      if (missingColumns.length > 0) {
        console.log('   Missing columns:', missingColumns.join(', '));
      }
      if (hasParticipationRate) {
        console.log('   Unexpected column: participation_rate should be removed');
      }
    }
    
  } catch (error) {
    console.error('❌ Error verifying schema:', error);
    process.exit(1);
  }
  
  process.exit(0);
}

verifySchema();
