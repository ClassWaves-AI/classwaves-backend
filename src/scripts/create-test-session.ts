import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';
import dotenv from 'dotenv';
import crypto from 'crypto';

// Load environment variables
dotenv.config();

async function createTestSession() {
  try {
    console.log('Creating test session...');
    
    // Connect to databricks
    await databricksService.connect();
    
    // First check if test teacher exists
    const teacherCheck = await databricksService.query(
      `SELECT id, email, name FROM ${databricksConfig.catalog}.users.teachers WHERE email = 'test@test.edu' LIMIT 1`
    );
    
    if (!teacherCheck || teacherCheck.length === 0) {
      console.error('Test teacher not found. Please run seed-test-school.ts first.');
      process.exit(1);
    }
    
    const teacher = teacherCheck[0];
    console.log('Found teacher:', teacher.name);
    
    // Get school ID
    const schoolCheck = await databricksService.query(
      `SELECT id, name FROM ${databricksConfig.catalog}.admin.schools WHERE domain = 'test.edu' LIMIT 1`
    );
    
    if (!schoolCheck || schoolCheck.length === 0) {
      console.error('Test school not found. Please run seed-test-school.ts first.');
      process.exit(1);
    }
    
    const school = schoolCheck[0];
    console.log('Found school:', school.name);
    
    // Create a test session with a simple access code
    const sessionId = crypto.randomUUID();
    const accessCode = 'TEST123';
    
    await databricksService.query(
      `INSERT INTO ${databricksConfig.catalog}.sessions.classroom_sessions 
       (id, title, description, status, teacher_id, school_id, access_code, 
        target_group_size, auto_group_enabled, 
        recording_enabled, transcription_enabled, ai_analysis_enabled,
        ferpa_compliant, coppa_compliant, recording_consent_obtained,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        sessionId,
        'Test Classroom Session',
        'A test session for student app testing',
        'active', // Set as active so students can join immediately
        teacher.id,
        school.id,
        accessCode,
        4,  // target_group_size
        true, // auto_group_enabled
        true, // recording_enabled
        true, // transcription_enabled
        true, // ai_analysis_enabled
        true, // ferpa_compliant
        true, // coppa_compliant
        true, // recording_consent_obtained
      ]
    );
    
    console.log('✅ Test session created successfully!');
    console.log('Session ID:', sessionId);
    console.log('Access Code:', accessCode);
    console.log('\nStudents can join at: http://localhost:3003/join/' + accessCode);
    
  } catch (error) {
    console.error('Error creating test session:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

// Run the script
createTestSession();