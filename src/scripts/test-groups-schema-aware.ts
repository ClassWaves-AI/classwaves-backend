import { config } from 'dotenv';
import { join } from 'path';
import { databricksService } from '../services/databricks.service';
import { generateAccessToken, generateSessionId } from '../utils/jwt.utils';
import { redisService } from '../services/redis.service';
import { createClassroomSessionData } from '../utils/schema-defaults';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function testGroupsSchemaAware() {
  try {
    logger.debug('🧪 Testing Groups with Schema-Aware Data...');
    
    // Connect to services
    await databricksService.connect();
    logger.debug('✅ Connected to Databricks SQL Warehouse');
    
    // Get the super admin from database to use for testing
    const superAdmin = await databricksService.queryOne(`
      SELECT t.*, s.name as school_name, s.domain as school_domain, 
             s.subscription_tier, s.subscription_status
      FROM classwaves.users.teachers t 
      JOIN classwaves.users.schools s ON t.school_id = s.id 
      WHERE t.role = 'super_admin' 
      LIMIT 1
    `);
    
    if (!superAdmin) {
      logger.error('❌ No super admin found');
      return;
    }
    
    logger.debug('✅ Found super admin:', superAdmin.email);
    logger.debug('✅ Connected to Redis');
    
    // Create a test session using schema-aware defaults
    const sessionId = databricksService.generateId();
    
    const sessionData = createClassroomSessionData({
      id: sessionId,
      teacher_id: superAdmin.id,
      school_id: superAdmin.school_id,
      title: 'Schema Test Session',
      description: 'Testing group functionality with correct schema',
      access_code: 'SCHEMATEST123',
    });
    
    await databricksService.insert('classroom_sessions', sessionData);
    logger.debug('✅ Created test session:', sessionId);
    
    // Create some test students
    const studentData = [
      { name: 'Alice Schema', grade: '10th' },
      { name: 'Bob Schema', grade: '10th' },
      { name: 'Carol Schema', grade: '10th' }
    ];
    
    const studentIds: string[] = [];
    
    for (const student of studentData) {
      const studentId = databricksService.generateId();
      
      // Create student using schema defaults
      const studentRecord = {
        id: studentId,
        school_id: superAdmin.school_id,
        display_name: student.name,
        grade_level: student.grade,
        email: `${student.name.toLowerCase().replace(' ', '.')}@test.com`,
        google_id: `google_${studentId}`,
        status: 'active',
        has_parental_consent: true,
        consent_date: new Date(),
        parent_email: 'parent@test.com',
        data_sharing_consent: true,
        audio_recording_consent: true,
        created_at: new Date(),
        updated_at: new Date(),
      };
      
      await databricksService.insert('students', studentRecord);
      
      // Note: Participant model removed - students are now managed through groups only
      logger.debug(`Student ${student.name} created. Groups will be assigned separately.`);
      
      studentIds.push(studentId);
      logger.debug(`✅ Created student: ${student.name} (${studentId})`);
    }
    
    // Generate access token
    const teacher = {
      id: superAdmin.id,
      email: superAdmin.email,
      name: superAdmin.name,
      role: superAdmin.role,
      access_level: superAdmin.access_level,
      google_id: superAdmin.google_id,
      picture: superAdmin.picture,
      school_id: superAdmin.school_id,
      status: superAdmin.status,
      max_concurrent_sessions: superAdmin.max_concurrent_sessions,
      current_sessions: superAdmin.current_sessions,
      timezone: superAdmin.timezone,
      login_count: superAdmin.login_count,
      total_sessions_created: superAdmin.total_sessions_created,
      last_login: superAdmin.last_login,
      created_at: superAdmin.created_at,
      updated_at: superAdmin.updated_at,
    };
    
    const school = {
      id: superAdmin.school_id,
      name: superAdmin.school_name,
      domain: superAdmin.school_domain,
      subscription_tier: superAdmin.subscription_tier,
      subscription_status: superAdmin.subscription_status,
      student_count: 0,
      teacher_count: 1,
      created_at: new Date(),
      subscription_end_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    };
    
    const sessionToken = generateSessionId();
    const accessToken = generateAccessToken(teacher, school, sessionToken);
    
    await redisService.storeSession(sessionToken, {
      teacherId: teacher.id,
      teacher,
      school,
      sessionId: sessionToken,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      ipAddress: '127.0.0.1',
      userAgent: 'test-script'
    });
    
    logger.debug('✅ Generated access token and stored session');
    
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    
    // Test 1: Create group without leader
    logger.debug('\n📝 Test 1: Create group without leader');
    const response1 = await fetch(`http://localhost:3000/api/v1/sessions/${sessionId}/groups`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Schema Test Group 1',
        maxMembers: 4
      })
    });
    
    logger.debug('Response status:', response1.status);
    const result1 = await response1.json() as any;
    logger.debug('Response:', JSON.stringify(result1, null, 2));
    
    // Test 2: Create group with leader
    logger.debug('\n📝 Test 2: Create group with leader');
    const response2 = await fetch(`http://localhost:3000/api/v1/sessions/${sessionId}/groups`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Schema Test Group 2',
        maxMembers: 3,
        leaderId: studentIds[0]
      })
    });
    
    logger.debug('Response status:', response2.status);
    const result2 = await response2.json() as any;
    logger.debug('Response:', JSON.stringify(result2, null, 2));
    
    // Test 3: Update group with isReady
    if (result2.success && result2.group?.id) {
      logger.debug('\n📝 Test 3: Update group isReady status');
      const response3 = await fetch(`http://localhost:3000/api/v1/sessions/${sessionId}/groups/${result2.group.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          isReady: true
        })
      });
      
      logger.debug('Response status:', response3.status);
      const result3 = await response3.json() as any;
      logger.debug('Response:', JSON.stringify(result3, null, 2));
    }
    
    // Test 4: List all groups
    logger.debug('\n📝 Test 4: List all groups');
    const response4 = await fetch(`http://localhost:3000/api/v1/sessions/${sessionId}/groups`, {
      method: 'GET',
      headers
    });
    
    logger.debug('Response status:', response4.status);
    const result4 = await response4.json() as any;
    logger.debug('Response:', JSON.stringify(result4, null, 2));
    
    logger.debug('\n✅ Schema-aware group test completed successfully!');
    
  } catch (error) {
    logger.error('❌ Error in schema-aware group test:', error);
  }
}

if (require.main === module) {
  testGroupsSchemaAware();
}

export { testGroupsSchemaAware };