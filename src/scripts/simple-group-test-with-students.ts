import { config } from 'dotenv';
import { join } from 'path';
import { databricksService } from '../services/databricks.service';
import { generateAccessToken, generateSessionId } from '../utils/jwt.utils';
import { redisService } from '../services/redis.service';
import { logger } from '../utils/logger';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function simpleGroupTestWithStudents() {
  try {
    logger.debug('🧪 Simple Group Test with Manual Students...');
    
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
    
    // Create a test session
    const sessionId = databricksService.generateId();
    
    await databricksService.insert('classroom_sessions', {
      id: sessionId,
      teacher_id: superAdmin.id,
      school_id: superAdmin.school_id,
      title: 'Simple Group Test Session',
      description: 'Testing group functionality',
      access_code: 'TEST123',
      status: 'created',
      start_time: null,
      end_time: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    
    logger.debug('✅ Created test session:', sessionId);
    
    // Create some test students directly
    const studentData = [
      { name: 'Alice Test', grade: '10th' },
      { name: 'Bob Test', grade: '10th' },
      { name: 'Carol Test', grade: '10th' }
    ];
    
    const studentIds: string[] = [];
    
    for (const student of studentData) {
      const studentId = databricksService.generateId();
      
      // Create student in users.students table
      await databricksService.insert('students', {
        id: studentId,
        school_id: superAdmin.school_id,
        display_name: student.name,
        grade_level: student.grade,
        created_at: new Date(),
        updated_at: new Date(),
      });
      
      // Add student as participant in session
      const participantId = databricksService.generateId();
      await databricksService.insert('participants', {
        id: participantId,
        session_id: sessionId,
        student_id: studentId,
        display_name: student.name,
        join_time: new Date(),
        is_active: true,
        created_at: new Date(),
        updated_at: new Date(),
      });
      
      studentIds.push(studentId);
      logger.debug(`✅ Created student: ${student.name} (${studentId})`);
    }
    
    // Create teacher and school objects for JWT generation
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
    
    // Generate access token
    const sessionToken = generateSessionId();
    const accessToken = generateAccessToken(teacher, school, sessionToken);
    
    // Store session in Redis
    await redisService.storeSession(sessionToken, {
      teacherId: teacher.id,
      teacher,
      school,
      sessionId: sessionToken,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
      ipAddress: '127.0.0.1',
      userAgent: 'test-script'
    });
    
    logger.debug('✅ Generated access token and stored session');
    
    logger.debug('\n🧪 Testing group creation...');
    
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
        name: 'Test Group 1',
        maxMembers: 4
      })
    });
    
    logger.debug('Response status:', response1.status);
    const result1 = await response1.json();
    logger.debug('Response:', JSON.stringify(result1, null, 2));
    
    // Test 2: Create group with leader
    logger.debug('\n📝 Test 2: Create group with leader');
    logger.debug('Using student ID as leader:', studentIds[0]);
    
    const response2 = await fetch(`http://localhost:3000/api/v1/sessions/${sessionId}/groups`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'Test Group 2',
        maxMembers: 3,
        leaderId: studentIds[0]
      })
    });
    
    logger.debug('Response status:', response2.status);
    const result2 = await response2.json();
    logger.debug('Response:', JSON.stringify(result2, null, 2));
    
    // Test 3: Auto-generate groups
    logger.debug('\n📝 Test 3: Auto-generate groups');
    
    const response3 = await fetch(`http://localhost:3000/api/v1/sessions/${sessionId}/groups/auto-generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        targetSize: 2,
        maxSize: 3,
        minSize: 2,
        strategy: 'balanced'
      })
    });
    
    logger.debug('Response status:', response3.status);
    const result3 = await response3.json();
    logger.debug('Response:', JSON.stringify(result3, null, 2));
    
    // Test 4: List all groups
    logger.debug('\n📝 Test 4: List all groups');
    
    const response4 = await fetch(`http://localhost:3000/api/v1/sessions/${sessionId}/groups`, {
      method: 'GET',
      headers
    });
    
    logger.debug('Response status:', response4.status);
    const result4 = await response4.json();
    logger.debug('Response:', JSON.stringify(result4, null, 2));
    
    logger.debug('\n✅ Simple group test completed');
    
  } catch (error) {
    logger.error('❌ Error in simple group test:', error);
  }
}

if (require.main === module) {
  simpleGroupTestWithStudents();
}

export { simpleGroupTestWithStudents };