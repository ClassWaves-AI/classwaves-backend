import { config } from 'dotenv';
import { join } from 'path';
import { databricksService } from '../services/databricks.service';
import { generateAccessToken, generateSessionId } from '../utils/jwt.utils';
import { redisService } from '../services/redis.service';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function debugGroupCreation() {
  try {
    console.log('🔍 Debugging Group Creation Issue...');
    
    // Connect to services
    await databricksService.connect();
    
    // Get the super admin from database to use for testing
    const superAdmin = await databricksService.queryOne(`
      SELECT t.*, s.name as school_name, s.domain as school_domain, 
             s.subscription_tier, s.subscription_status
      FROM classwaves.users.teachers t
      JOIN classwaves.users.schools s ON t.school_id = s.id
      WHERE t.role = 'super_admin' AND t.email = 'rob@classwaves.ai'
    `);
    
    if (!superAdmin) {
      console.error('❌ Super admin not found');
      return;
    }
    
    console.log('✅ Found super admin:', superAdmin.email);
    
    // Generate access token for testing
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
    const sessionId = generateSessionId();
    const accessToken = generateAccessToken(teacher, school, sessionId);
    
    // Store session in Redis
    await redisService.storeSession(sessionId, {
      teacherId: teacher.id,
      teacher,
      school,
      sessionId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours
      ipAddress: '127.0.0.1',
      userAgent: 'debug-script'
    }, 7200);
    
    console.log('✅ Generated access token and stored session');
    
    // First, create a test session
    console.log('\n🔧 Creating test session...');
    
    const sessionBaseUrl = 'http://localhost:3000/api/v1/sessions';
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    
    const createSessionPayload = {
      topic: 'Debug Group Creation Session',
      goal: 'Debug group creation errors',
      plannedDuration: 60,
      maxStudents: 12,
      targetGroupSize: 3,
      autoGroupEnabled: false,
    };
    
    const createSessionResponse = await fetch(sessionBaseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(createSessionPayload)
    });
    
    if (!createSessionResponse.ok) {
      const error = await createSessionResponse.text();
      console.error('❌ Failed to create test session:', createSessionResponse.status, error);
      return;
    }
    
    const sessionData = await createSessionResponse.json() as any;
    const testSessionId = sessionData.data?.session?.id;
    console.log('✅ Created test session:', testSessionId);
    
    // Now try to create a group and see the error
    console.log('\n🧪 Testing group creation...');
    
    const groupUrl = `http://localhost:3000/api/v1/sessions/${testSessionId}/groups`;
    const createGroupPayload = {
      name: 'Debug Test Group',
      maxMembers: 4
    };
    
    console.log('Making request to:', groupUrl);
    console.log('Payload:', JSON.stringify(createGroupPayload, null, 2));
    console.log('Headers:', JSON.stringify(headers, null, 2));
    
    const createGroupResponse = await fetch(groupUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(createGroupPayload)
    });
    
    console.log('Response status:', createGroupResponse.status);
    console.log('Response headers:', Object.fromEntries(createGroupResponse.headers.entries()));
    
    const responseText = await createGroupResponse.text();
    console.log('Response body:', responseText);
    
    if (createGroupResponse.ok) {
      console.log('✅ Group creation successful!');
    } else {
      console.log('❌ Group creation failed - check server logs for detailed error');
    }
    
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await fetch(`${sessionBaseUrl}/${testSessionId}`, { method: 'DELETE', headers });
    
  } catch (error) {
    console.error('❌ Error in debug script:', error);
  } finally {
    await databricksService.disconnect();
  }
}

if (require.main === module) {
  debugGroupCreation();
}

export { debugGroupCreation };
