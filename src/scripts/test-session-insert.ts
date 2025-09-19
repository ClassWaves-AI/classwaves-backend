#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';
import { logger } from '../utils/logger';

dotenv.config();

async function testSessionInsert() {
  logger.debug('🔍 Testing session insert to diagnose schema issue...\n');

  try {
    // Test 1: Check if we can see the table and its schema
    logger.debug('📊 STEP 1: Checking table schema visibility...');
    const currentSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.classroom_sessions'
    );
    
    logger.debug('Columns visible via DESCRIBE:');
    currentSchema.forEach((row: any, index: number) => {
      logger.debug(`  ${index + 1}. ${row.col_name}: ${row.data_type}`);
    });

    const columnNames = currentSchema.map((row: any) => row.col_name);
    const hasEngagementScore = columnNames.includes('engagement_score');
    logger.debug(`\n✅ engagement_score column visible: ${hasEngagementScore}`);

    // Test 2: Try a simple SELECT to see what columns we can actually query
    logger.debug('\n📊 STEP 2: Testing SELECT access...');
    try {
      const selectResult = await databricksService.query(
        'SELECT id, title, engagement_score FROM classwaves.sessions.classroom_sessions LIMIT 1'
      );
      logger.debug('✅ SELECT with engagement_score works fine');
    } catch (selectError) {
      logger.debug('❌ SELECT with engagement_score failed:', selectError);
    }

    // Test 3: Check what schema the insert method will use
    logger.debug('\n📊 STEP 3: Testing databricks service schema mapping...');
    const testData = {
      id: 'test_session_123',
      title: 'Test Session',
      description: 'Test Description', 
      status: 'created',
      engagement_score: 0.0,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Get the schema for this table
    const schema = (databricksService as any).getSchemaForTable('classroom_sessions');
    logger.debug(`Schema for 'classroom_sessions' table: ${schema}`);

    // Build the SQL that would be executed
    const columns = Object.keys(testData);
    const placeholders = columns.map(() => '?').join(', ');
    const wouldExecuteSql = `INSERT INTO classwaves.${schema}.classroom_sessions (${columns.join(', ')}) VALUES (${placeholders})`;
    
    logger.debug('SQL that would be executed:');
    logger.debug(wouldExecuteSql);
    
    // Test 4: Try to insert a minimal record first
    logger.debug('\n📊 STEP 4: Testing minimal insert...');
    const minimalData = {
      id: 'test_minimal_' + Date.now(),
      title: 'Minimal Test',
      status: 'created',
      planned_duration_minutes: 30,
      max_students: 10,
      target_group_size: 4,
      auto_group_enabled: false,
      teacher_id: 'test_teacher',
      school_id: 'test_school',
      recording_enabled: false,
      transcription_enabled: false,
      ai_analysis_enabled: false,
      ferpa_compliant: true,
      coppa_compliant: true,
      recording_consent_obtained: false,
      total_groups: 1,
      total_students: 4,
      created_at: new Date(),
      updated_at: new Date()
    };

    logger.debug('Attempting minimal insert (without engagement_score)...');
    try {
      await databricksService.insert('classroom_sessions', minimalData);
      logger.debug('✅ Minimal insert succeeded');
      
      // Clean up
      await databricksService.query(
        'DELETE FROM classwaves.sessions.classroom_sessions WHERE id = ?',
        [minimalData.id]
      );
      logger.debug('✅ Test record cleaned up');
    } catch (insertError) {
      logger.debug('❌ Minimal insert failed:', insertError);
    }

  } catch (error) {
    logger.error('❌ Error during session insert test:', error);
    throw error;
  }
}

// Run the test
testSessionInsert()
  .then(() => {
    logger.debug('\n🎉 Session insert test completed');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('💥 Session insert test failed:', error);
    process.exit(1);
  });