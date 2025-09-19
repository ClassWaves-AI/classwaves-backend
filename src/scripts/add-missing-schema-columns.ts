#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';
import { logger } from '../utils/logger';

dotenv.config();

async function addMissingColumns() {
  logger.debug('🔧 Adding missing columns to sessions.student_groups table...\n');

  try {
    // Connect to Databricks
    logger.debug('📡 Connecting to Databricks...');
    
    // Check current schema first
    logger.debug('🔍 Checking current table schema...');
    const currentSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.student_groups'
    );
    
    logger.debug('Current columns:');
    currentSchema.forEach((row: any) => {
      logger.debug(`  - ${row.col_name}: ${row.data_type}`);
    });

    const existingColumns = currentSchema.map((row: any) => row.col_name);

    // Add leader_id column if missing
    if (!existingColumns.includes('leader_id')) {
      logger.debug('\n➕ Adding leader_id column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.student_groups 
        ADD COLUMN leader_id STRING COMMENT 'ID of the student who is the group leader'
      `);
      logger.debug('✅ leader_id column added successfully');
    } else {
      logger.debug('✅ leader_id column already exists');
    }

    // Add is_ready column if missing
    if (!existingColumns.includes('is_ready')) {
      logger.debug('➕ Adding is_ready column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.student_groups 
        ADD COLUMN is_ready BOOLEAN DEFAULT false COMMENT 'Whether the group is ready to start the session'
      `);
      logger.debug('✅ is_ready column added successfully');
    } else {
      logger.debug('✅ is_ready column already exists');
    }

    // Add sentiment_arc column if missing
    if (!existingColumns.includes('sentiment_arc')) {
      logger.debug('➕ Adding sentiment_arc column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.student_groups 
        ADD COLUMN sentiment_arc STRING DEFAULT '[]' COMMENT 'JSON array tracking sentiment over time'
      `);
      logger.debug('✅ sentiment_arc column added successfully');
    } else {
      logger.debug('✅ sentiment_arc column already exists');
    }

    // Verify final schema
    logger.debug('\n🔍 Verifying updated schema...');
    const updatedSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.student_groups'
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
addMissingColumns()
  .then(() => {
    logger.debug('🎉 Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('💥 Migration failed:', error);
    process.exit(1);
  });