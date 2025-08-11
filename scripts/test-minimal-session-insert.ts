#!/usr/bin/env ts-node

import { DatabricksService } from '../src/services/databricks.service';

async function testMinimalInsert() {
  console.log('🔧 Testing minimal session insert...');
  
  // Use a minimal insert to see what columns are actually required
  const testSession = {
    id: 'test-minimal-' + Date.now(),
    title: 'Test Session',
    description: 'Test Description',
    status: 'created',
    teacher_id: 'test-teacher',
    school_id: 'test-school',
    planned_duration_minutes: 45,
    max_students: 999,
    target_group_size: 4,
    auto_group_enabled: false,
    recording_enabled: false,
    transcription_enabled: false,
    ai_analysis_enabled: false,
    ferpa_compliant: true,
    coppa_compliant: true,
    recording_consent_obtained: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

  try {
    // Create a test databricks service instance
    console.log('Debug: Creating service instance...');
    const service = new DatabricksService();
    console.log('Debug: Attempting to insert test session...');
    
    await service.insert('classroom_sessions', testSession);
    console.log('✅ Minimal insert successful!');
    
  } catch (error) {
    console.error('❌ Error with minimal insert:');
    console.error('Error message:', error.message);
    console.error('Error details:', error);
  }
}

// Only run if called directly
if (require.main === module) {
  testMinimalInsert();
}
