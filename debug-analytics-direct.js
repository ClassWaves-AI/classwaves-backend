import { analyticsComputationService } from './src/services/analytics-computation.service';
import { databricksService } from './src/services/databricks.service';
import { databricksConfig } from './src/config/databricks.config';
import { v4 as uuidv4 } from 'uuid';

(async () => {
  try {
    console.log('🔍 DIRECT ANALYTICS TEST - Starting...');
    
    await databricksService.connect();
    console.log('✅ Connected to Databricks');
    
    const testSessionId = `direct_test_${Date.now()}`;
    console.log(`🧪 Using test session ID: ${testSessionId}`);
    
    // Step 1: Insert minimal test session
    console.log('📝 Step 1: Inserting test session...');
    await databricksService.query(`
      INSERT INTO ${databricksConfig.catalog}.sessions.classroom_sessions 
       (id, title, description, status, planned_duration_minutes, max_students, 
        target_group_size, auto_group_enabled, teacher_id, school_id,
        recording_enabled, transcription_enabled, ai_analysis_enabled,
        ferpa_compliant, coppa_compliant, recording_consent_obtained,
        total_groups, total_students, engagement_score,
        actual_start, actual_end, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [testSessionId, 'Direct Test', 'Direct test session', 'ended', 45, 30,
       4, true, 'test_teacher', 'test_school',
       true, true, true, true, true, true,
       2, 8, 75.0, new Date(), new Date(), new Date(), new Date()]
    );
    console.log('✅ Test session inserted');
    
    // Step 2: Insert test groups
    console.log('📝 Step 2: Inserting test groups...');
    const group1Id = `${testSessionId}_group1`;
    const group2Id = `${testSessionId}_group2`;
    
    await databricksService.query(`
      INSERT INTO ${databricksConfig.catalog}.sessions.student_groups 
       (id, session_id, name, group_number, status, max_size, current_size, auto_managed, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [group1Id, testSessionId, 'Group 1', 1, 'active', 4, 4, true, new Date(), new Date()]
    );
    
    await databricksService.query(`
      INSERT INTO ${databricksConfig.catalog}.sessions.student_groups 
       (id, session_id, name, group_number, status, max_size, current_size, auto_managed, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [group2Id, testSessionId, 'Group 2', 2, 'active', 4, 4, true, new Date(), new Date()]
    );
    console.log('✅ Test groups inserted');
    
    // Step 3: Insert group members
    console.log('📝 Step 3: Inserting group members...');
    for (let i = 1; i <= 4; i++) {
      await databricksService.query(`
        INSERT INTO ${databricksConfig.catalog}.sessions.student_group_members 
         (id, session_id, group_id, student_id, created_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [`${group1Id}_member${i}`, testSessionId, group1Id, `student${i}`, new Date()]
      );
      
      await databricksService.query(`
        INSERT INTO ${databricksConfig.catalog}.sessions.student_group_members 
         (id, session_id, group_id, student_id, created_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [`${group2Id}_member${i}`, testSessionId, group2Id, `student${i + 4}`, new Date()]
      );
    }
    console.log('✅ Group members inserted');
    
    // Step 4: Insert transcriptions
    console.log('📝 Step 4: Inserting transcriptions...');
    await databricksService.query(`
      INSERT INTO ${databricksConfig.catalog}.sessions.transcriptions 
       (id, session_id, speaker_id, speaker_type, speaker_name, content, language_code,
        start_time, end_time, duration_seconds, confidence_score, is_final, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`transcript_${testSessionId}`, testSessionId, 'student1', 'student', 'Test Student', 
       'This is a test transcription.', 'en-US', new Date(), new Date(), 5.0, 0.95, true, new Date()]
    );
    console.log('✅ Transcription inserted');
    
    // Step 5: Call analytics computation directly
    console.log('🚀 Step 5: Starting analytics computation...');
    const startTime = Date.now();
    
    const result = await analyticsComputationService.computeSessionAnalytics(testSessionId);
    const duration = Date.now() - startTime;
    
    console.log(`⏱️  Analytics computation completed in ${duration}ms`);
    console.log('🎯 RESULT:', result ? 'SUCCESS' : 'NULL');
    
    if (result) {
      console.log('📊 Analytics Overview:', {
        hasSessionOverview: !!result.sessionAnalyticsOverview,
        groupCount: result.groupAnalytics?.length || 0,
        computationStatus: result.computationMetadata?.status
      });
    }
    
    // Cleanup
    console.log('🧹 Cleaning up...');
    await databricksService.query(`DELETE FROM ${databricksConfig.catalog}.sessions.transcriptions WHERE session_id = ?`, [testSessionId]);
    await databricksService.query(`DELETE FROM ${databricksConfig.catalog}.sessions.student_group_members WHERE session_id = ?`, [testSessionId]);
    await databricksService.query(`DELETE FROM ${databricksConfig.catalog}.sessions.student_groups WHERE session_id = ?`, [testSessionId]);
    await databricksService.query(`DELETE FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE id = ?`, [testSessionId]);
    
    await databricksService.disconnect();
    console.log('✅ Cleanup complete');
    
    console.log(`🎉 DIRECT TEST COMPLETE - Result: ${result ? 'SUCCESS' : 'FAILED'}`);
    
  } catch (error) {
    console.error('❌ DIRECT TEST ERROR:', error.message);
    console.error('🔍 Stack:', error.stack);
  }
  
  process.exit(0);
})();
