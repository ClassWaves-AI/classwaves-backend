#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';

dotenv.config();

async function fixClassroomSessionsSchema() {
  console.log('🔧 Adding missing columns to sessions.classroom_sessions table...\n');

  try {
    // Connect to Databricks
    console.log('📡 Connecting to Databricks...');
    
    // Check current schema first
    console.log('🔍 Checking current table schema...');
    const currentSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.classroom_sessions'
    );
    
    console.log('Current columns:');
    currentSchema.forEach((row: any) => {
      console.log(`  - ${row.col_name}: ${row.data_type}`);
    });

    const existingColumns = currentSchema.map((row: any) => row.col_name);

    // Add engagement_score column if missing
    if (!existingColumns.includes('engagement_score')) {
      console.log('\n➕ Adding engagement_score column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions 
        ADD COLUMN engagement_score DECIMAL(5,2) DEFAULT 0.0 COMMENT 'Overall session engagement score'
      `);
      console.log('✅ engagement_score column added successfully');
    } else {
      console.log('✅ engagement_score column already exists');
    }

    // Add participation_rate column if missing
    if (!existingColumns.includes('participation_rate')) {
      console.log('➕ Adding participation_rate column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions 
        ADD COLUMN participation_rate DECIMAL(5,2) DEFAULT 0.0 COMMENT 'Student participation rate percentage'
      `);
      console.log('✅ participation_rate column added successfully');
    } else {
      console.log('✅ participation_rate column already exists');
    }

    // Add end_reason column if missing (used in session creation)
    if (!existingColumns.includes('end_reason')) {
      console.log('➕ Adding end_reason column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions 
        ADD COLUMN end_reason STRING DEFAULT '' COMMENT 'Reason why session ended'
      `);
      console.log('✅ end_reason column added successfully');
    } else {
      console.log('✅ end_reason column already exists');
    }

    // Add teacher_notes column if missing (used in session creation)
    if (!existingColumns.includes('teacher_notes')) {
      console.log('➕ Adding teacher_notes column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions 
        ADD COLUMN teacher_notes STRING DEFAULT '' COMMENT 'Teacher notes for the session'
      `);
      console.log('✅ teacher_notes column added successfully');
    } else {
      console.log('✅ teacher_notes column already exists');
    }

    // Add access_code column if missing (used in session creation and joining)
    if (!existingColumns.includes('access_code')) {
      console.log('➕ Adding access_code column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions 
        ADD COLUMN access_code STRING COMMENT 'Session access code for student joining'
      `);
      console.log('✅ access_code column added successfully');
    } else {
      console.log('✅ access_code column already exists');
    }

    // Verify final schema
    console.log('\n🔍 Verifying updated schema...');
    const updatedSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.classroom_sessions'
    );
    
    console.log('Updated columns:');
    updatedSchema.forEach((row: any) => {
      console.log(`  - ${row.col_name}: ${row.data_type}`);
    });

    console.log('\n✨ Schema update completed successfully!');

  } catch (error) {
    console.error('❌ Error adding missing columns:', error);
    throw error;
  }
}

// Run the migration
fixClassroomSessionsSchema()
  .then(() => {
    console.log('🎉 Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });
