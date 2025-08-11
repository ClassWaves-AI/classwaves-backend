import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function dropParticipationColumns() {
  try {
    console.log('🔧 Updating classroom_sessions table schema...\n');
    
    // Connect to databricks
    await databricksService.connect();
    
    // Check if columns exist before modifying them
    console.log('1️⃣ Checking current table schema...');
    
    const tableInfo = await databricksService.query(
      `DESCRIBE TABLE ${databricksConfig.catalog}.sessions.classroom_sessions`
    );
    
    console.log('Current columns:');
    tableInfo.forEach((col: any) => {
      console.log(`  - ${col.col_name}: ${col.data_type}`);
    });
    
    const hasParticipationRate = tableInfo.some((col: any) => col.col_name === 'participation_rate');
    const hasEngagementScore = tableInfo.some((col: any) => col.col_name === 'engagement_score');
    const hasAccessCode = tableInfo.some((col: any) => col.col_name === 'access_code');
    
    console.log('\n2️⃣ Updating schema...');
    
    // Drop participation_rate (individual student metric)
    if (hasParticipationRate) {
      console.log('Dropping participation_rate column...');
      await databricksService.query(
        `ALTER TABLE ${databricksConfig.catalog}.sessions.classroom_sessions DROP COLUMN participation_rate`
      );
      console.log('✅ Dropped participation_rate');
    } else {
      console.log('⏭️  participation_rate column does not exist, skipping');
    }
    
    // Keep engagement_score but ensure it exists (group-level metric)
    if (!hasEngagementScore) {
      console.log('Adding engagement_score column...');
      // Step 1: Enable column defaults feature first
      await databricksService.query(
        `ALTER TABLE ${databricksConfig.catalog}.sessions.classroom_sessions SET TBLPROPERTIES('delta.feature.allowColumnDefaults' = 'supported')`
      );
      // Step 2: Add column without default
      await databricksService.query(
        `ALTER TABLE ${databricksConfig.catalog}.sessions.classroom_sessions ADD COLUMN engagement_score DECIMAL(5,2)`
      );
      // Step 3: Update existing rows to have the default value first
      await databricksService.query(
        `UPDATE ${databricksConfig.catalog}.sessions.classroom_sessions SET engagement_score = 0.0 WHERE engagement_score IS NULL`
      );
      // Step 4: Set default value for new inserts (after updating existing rows)
      await databricksService.query(
        `ALTER TABLE ${databricksConfig.catalog}.sessions.classroom_sessions ALTER COLUMN engagement_score SET DEFAULT 0.0`
      );
      console.log('✅ Added engagement_score');
    } else {
      console.log('⏭️  engagement_score column already exists');
    }
    
    // Ensure access_code exists for student joining
    if (!hasAccessCode) {
      console.log('Adding access_code column...');
      await databricksService.query(
        `ALTER TABLE ${databricksConfig.catalog}.sessions.classroom_sessions ADD COLUMN access_code STRING`
      );
      console.log('✅ Added access_code');
    } else {
      console.log('⏭️  access_code column already exists');
    }
    
    console.log('\n3️⃣ Verifying changes...');
    
    const updatedTableInfo = await databricksService.query(
      `DESCRIBE TABLE ${databricksConfig.catalog}.sessions.classroom_sessions`
    );
    
    console.log('Updated columns:');
    updatedTableInfo.forEach((col: any) => {
      console.log(`  - ${col.col_name}: ${col.data_type}`);
    });
    
    console.log('\n✅ Schema migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Error dropping columns:', error);
    process.exit(1);
  } finally {
    await databricksService.disconnect();
    process.exit(0);
  }
}

// Run the script
if (require.main === module) {
  dropParticipationColumns();
}

export default dropParticipationColumns;
