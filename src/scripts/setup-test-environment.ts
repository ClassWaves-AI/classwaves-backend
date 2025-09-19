import { databricksService } from '../services/databricks.service';
import { databricksConfig } from '../config/databricks.config';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { logger } from '../utils/logger';

// Load environment variables
dotenv.config();

async function setupTestEnvironment() {
  try {
    logger.debug('🚀 Setting up test environment...\n');
    
    // Connect to databricks
    await databricksService.connect();
    
    // 1. Check/Create test school
    logger.debug('1️⃣ Checking test school...');
    const schoolCheck = await databricksService.query(
      `SELECT id, name FROM ${databricksConfig.catalog}.users.schools WHERE domain = 'test.edu' LIMIT 1`
    );
    
    let schoolId: string;
    if (schoolCheck && schoolCheck.length > 0) {
      schoolId = schoolCheck[0].id;
      logger.debug('✅ Test school exists:', schoolCheck[0].name);
    } else {
      // Create school
      schoolId = crypto.randomUUID();
      await databricksService.query(
        `INSERT INTO ${databricksConfig.catalog}.users.schools 
         (id, name, domain, admin_email, subscription_tier, subscription_status, 
          max_teachers, ferpa_agreement, coppa_compliant, data_retention_days,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          schoolId,
          'Test Elementary School',
          'test.edu',
          'admin@test.edu',
          'pro',
          'active',
          50,
          true,
          true,
          365
        ]
      );
      logger.debug('✅ Created test school');
    }
    
    // 2. Create test teacher
    logger.debug('\n2️⃣ Creating test teacher...');
    const teacherId = crypto.randomUUID();
    
    // Delete existing test teacher if exists
    await databricksService.query(
      `DELETE FROM ${databricksConfig.catalog}.users.teachers WHERE email = 'test@test.edu'`
    );
    
    // Create new test teacher
    await databricksService.query(
      `INSERT INTO ${databricksConfig.catalog}.users.teachers 
       (id, google_id, email, name, role, school_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        teacherId,
        'test-google-id-123', // Fake Google ID for testing
        'test@test.edu',
        'Test Teacher',
        'teacher',
        schoolId
      ]
    );
    logger.debug('✅ Created test teacher: test@test.edu');
    
    // 3. Create active test session
    logger.debug('\n3️⃣ Creating test session...');
    const sessionId = 'TEST123'; // Use session ID as the join code
    const accessCode = 'TEST123';
    
    // Delete existing test session if exists
    await databricksService.query(
      `DELETE FROM ${databricksConfig.catalog}.sessions.classroom_sessions WHERE title = 'Test Classroom Session'`
    );
    
    // Create new test session
    await databricksService.query(
      `INSERT INTO ${databricksConfig.catalog}.sessions.classroom_sessions 
       (id, title, description, status, teacher_id, school_id, access_code,
        target_group_size, auto_group_enabled, 
        recording_enabled, transcription_enabled, ai_analysis_enabled,
        ferpa_compliant, coppa_compliant, recording_consent_obtained,
        planned_duration_minutes, total_groups, total_students, engagement_score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        sessionId,
        'Test Classroom Session',
        'A test session for student app testing',
        'active', // Set as active so students can join immediately
        teacherId,
        schoolId,
        accessCode, // access_code
        4,  // target_group_size
        true, // auto_group_enabled
        true, // recording_enabled
        true, // transcription_enabled
        true, // ai_analysis_enabled
        true, // ferpa_compliant
        true, // coppa_compliant
        true, // recording_consent_obtained
        45,   // planned_duration_minutes
        0,    // total_groups
        0,    // total_students
        0.0   // engagement_score
      ]
    );
    
    // 4. Create a test group
    logger.debug('\n4️⃣ Creating test group...');
    const groupId = crypto.randomUUID();
    
    await databricksService.query(
      `INSERT INTO ${databricksConfig.catalog}.sessions.student_groups 
       (id, session_id, name, group_number, status, max_size, current_size, auto_managed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        groupId,
        sessionId,
        'Group A',
        1,
        'active',
        4,       // max_size
        0,       // current_size
        false    // auto_managed
      ]
    );
    
    logger.debug('\n✅ Test environment setup complete!\n');
    logger.debug('📋 Test Credentials:');
    logger.debug('===================');
    logger.debug('Teacher Login: test@test.edu');
    logger.debug('Session Code: TEST123');
    logger.debug('\n🔗 URLs:');
    logger.debug('Teacher Dashboard: http://localhost:3002/auth/login');
    logger.debug('Student Join: http://localhost:3003/join/TEST123');
    logger.debug('\n💡 Next Steps:');
    logger.debug('1. Login as teacher at the dashboard URL');
    logger.debug('2. Open student app and join with code TEST123');
    
  } catch (error) {
    logger.error('❌ Error setting up test environment:', error);
    process.exit(1);
  } finally {
    await databricksService.disconnect();
    process.exit(0);
  }
}

// Run the script
setupTestEnvironment();