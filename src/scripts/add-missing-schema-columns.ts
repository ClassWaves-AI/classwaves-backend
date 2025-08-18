#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';

dotenv.config();

async function addMissingColumns() {
  console.log('🔧 Adding missing columns to sessions.student_groups table...\n');

  try {
    // Connect to Databricks
    console.log('📡 Connecting to Databricks...');
    
    // Check current schema first
    console.log('🔍 Checking current table schema...');
    const currentSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.student_groups'
    );
    
    console.log('Current columns:');
    currentSchema.forEach((row: any) => {
      console.log(`  - ${row.col_name}: ${row.data_type}`);
    });

    const existingColumns = currentSchema.map((row: any) => row.col_name);

    // Add leader_id column if missing
    if (!existingColumns.includes('leader_id')) {
      console.log('\n➕ Adding leader_id column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.student_groups 
        ADD COLUMN leader_id STRING COMMENT 'ID of the student who is the group leader'
      `);
      console.log('✅ leader_id column added successfully');
    } else {
      console.log('✅ leader_id column already exists');
    }

    // Add is_ready column if missing
    if (!existingColumns.includes('is_ready')) {
      console.log('➕ Adding is_ready column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.student_groups 
        ADD COLUMN is_ready BOOLEAN DEFAULT false COMMENT 'Whether the group is ready to start the session'
      `);
      console.log('✅ is_ready column added successfully');
    } else {
      console.log('✅ is_ready column already exists');
    }

    // Add sentiment_arc column if missing
    if (!existingColumns.includes('sentiment_arc')) {
      console.log('➕ Adding sentiment_arc column...');
      await databricksService.query(`
        ALTER TABLE classwaves.sessions.student_groups 
        ADD COLUMN sentiment_arc STRING DEFAULT '[]' COMMENT 'JSON array tracking sentiment over time'
      `);
      console.log('✅ sentiment_arc column added successfully');
    } else {
      console.log('✅ sentiment_arc column already exists');
    }

    // Verify final schema
    console.log('\n🔍 Verifying updated schema...');
    const updatedSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.student_groups'
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
addMissingColumns()
  .then(() => {
    console.log('🎉 Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });
