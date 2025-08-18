#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import { databricksService } from '../services/databricks.service';

dotenv.config();

async function testSessionInsert() {
  console.log('🔍 Testing session insert to diagnose schema issue...\n');

  try {
    // Test 1: Check if we can see the table and its schema
    console.log('📊 STEP 1: Checking table schema visibility...');
    const currentSchema = await databricksService.query(
      'DESCRIBE classwaves.sessions.classroom_sessions'
    );
    
    console.log('Columns visible via DESCRIBE:');
    currentSchema.forEach((row: any, index: number) => {
      console.log(`  ${index + 1}. ${row.col_name}: ${row.data_type}`);
    });

    const columnNames = currentSchema.map((row: any) => row.col_name);
    const hasEngagementScore = columnNames.includes('engagement_score');
    console.log(`\n✅ engagement_score column visible: ${hasEngagementScore}`);

    // Test 2: Try a simple SELECT to see what columns we can actually query
    console.log('\n📊 STEP 2: Testing SELECT access...');
    try {
      const selectResult = await databricksService.query(
        'SELECT id, title, engagement_score FROM classwaves.sessions.classroom_sessions LIMIT 1'
      );
      console.log('✅ SELECT with engagement_score works fine');
    } catch (selectError) {
      console.log('❌ SELECT with engagement_score failed:', selectError);
    }

    // Test 3: Check what schema the insert method will use
    console.log('\n📊 STEP 3: Testing databricks service schema mapping...');
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
    console.log(`Schema for 'classroom_sessions' table: ${schema}`);

    // Build the SQL that would be executed
    const columns = Object.keys(testData);
    const placeholders = columns.map(() => '?').join(', ');
    const wouldExecuteSql = `INSERT INTO classwaves.${schema}.classroom_sessions (${columns.join(', ')}) VALUES (${placeholders})`;
    
    console.log('SQL that would be executed:');
    console.log(wouldExecuteSql);
    
    // Test 4: Try to insert a minimal record first
    console.log('\n📊 STEP 4: Testing minimal insert...');
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

    console.log('Attempting minimal insert (without engagement_score)...');
    try {
      await databricksService.insert('classroom_sessions', minimalData);
      console.log('✅ Minimal insert succeeded');
      
      // Clean up
      await databricksService.query(
        'DELETE FROM classwaves.sessions.classroom_sessions WHERE id = ?',
        [minimalData.id]
      );
      console.log('✅ Test record cleaned up');
    } catch (insertError) {
      console.log('❌ Minimal insert failed:', insertError);
    }

  } catch (error) {
    console.error('❌ Error during session insert test:', error);
    throw error;
  }
}

// Run the test
testSessionInsert()
  .then(() => {
    console.log('\n🎉 Session insert test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Session insert test failed:', error);
    process.exit(1);
  });
