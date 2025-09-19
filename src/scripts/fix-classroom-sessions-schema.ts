#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';
import { logger } from '../utils/logger';

dotenv.config();

async function fixClassroomSessionsSchema() {
  logger.debug('🔧 Adding missing columns to sessions.classroom_sessions table...\n');

  try {
    // Connect to Databricks
    logger.debug('📡 Connecting to Databricks...');
    
    // Check current schema first
    logger.debug('🔍 Checking current table schema...');
    const currentSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.classroom_sessions'
    );
    
    logger.debug('Current columns:');
    currentSchema.forEach((row: any) => {
      logger.debug(`  - ${row.col_name}: ${row.data_type}`);
    });

    const existingColumns = currentSchema.map((row: any) => row.col_name);

    // Add engagement_score column if missing
    if (!existingColumns.includes('engagement_score')) {
      logger.debug('\n➕ Adding engagement_score column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions 
        ADD COLUMN engagement_score DECIMAL(5,2) DEFAULT 0.0 COMMENT 'Overall session engagement score'
      `);
      logger.debug('✅ engagement_score column added successfully');
    } else {
      logger.debug('✅ engagement_score column already exists');
    }

    // Add participation_rate column if missing
    if (!existingColumns.includes('participation_rate')) {
      logger.debug('➕ Adding participation_rate column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions 
        ADD COLUMN participation_rate DECIMAL(5,2) DEFAULT 0.0 COMMENT 'Student participation rate percentage'
      `);
      logger.debug('✅ participation_rate column added successfully');
    } else {
      logger.debug('✅ participation_rate column already exists');
    }

    // Add end_reason column if missing (used in session creation)
    if (!existingColumns.includes('end_reason')) {
      logger.debug('➕ Adding end_reason column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions 
        ADD COLUMN end_reason STRING DEFAULT '' COMMENT 'Reason why session ended'
      `);
      logger.debug('✅ end_reason column added successfully');
    } else {
      logger.debug('✅ end_reason column already exists');
    }

    // Add teacher_notes column if missing (used in session creation)
    if (!existingColumns.includes('teacher_notes')) {
      logger.debug('➕ Adding teacher_notes column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions 
        ADD COLUMN teacher_notes STRING DEFAULT '' COMMENT 'Teacher notes for the session'
      `);
      logger.debug('✅ teacher_notes column added successfully');
    } else {
      logger.debug('✅ teacher_notes column already exists');
    }

    // Add access_code column if missing (used in session creation and joining)
    if (!existingColumns.includes('access_code')) {
      logger.debug('➕ Adding access_code column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.classroom_sessions 
        ADD COLUMN access_code STRING COMMENT 'Session access code for student joining'
      `);
      logger.debug('✅ access_code column added successfully');
    } else {
      logger.debug('✅ access_code column already exists');
    }

    // Verify final schema
    logger.debug('\n🔍 Verifying updated schema...');
    const updatedSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.classroom_sessions'
    );
    
    logger.debug('Updated columns:');
    updatedSchema.forEach((row: any) => {
      logger.debug(`  - ${row.col_name}: ${row.data_type}`);
    });

    logger.debug('\n✨ Schema update completed successfully!');

  } catch (error) {
    logger.error('❌ Error adding missing columns:', error);
    throw error;
  }
}

// Run the migration
fixClassroomSessionsSchema()
  .then(() => {
    logger.debug('🎉 Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('💥 Migration failed:', error);
    process.exit(1);
  });