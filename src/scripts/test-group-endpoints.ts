import { config } from 'dotenv';
import { join } from 'path';
import { databricksService } from '../services/databricks.service';
import { generateAccessToken, generateSessionId } from '../utils/jwt.utils';
import { redisService } from '../services/redis.service';

// Load environment variables
config({ path: join(__dirname, '../../.env') });

async function testGroupEndpoints() {
  try {
    console.log('🧪 Testing Group Management API Endpoints...');
    
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
      userAgent: 'test-script'
    }, 7200);
    
    console.log('✅ Generated access token and stored session');
    
    // First, create a test session to work with
    console.log('\n🔧 Creating test session for group management...');
    
    const sessionBaseUrl = 'http://localhost:3000/api/v1/sessions';
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };
    
    const createSessionPayload = {
      topic: 'Group Management Test Session',
      goal: 'Test all group management API endpoints',
      plannedDuration: 60,
      maxStudents: 12,
      targetGroupSize: 3,
      autoGroupEnabled: false, // Start without auto-groups
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
    
    // Add some test students to the session
    console.log('\n👥 Adding test students to session...');
    
    const studentData = [
      { name: 'Alice Johnson', gradeLevel: '10th' },
      { name: 'Bob Smith', gradeLevel: '10th' },
      { name: 'Carol Davis', gradeLevel: '10th' },
      { name: 'David Wilson', gradeLevel: '10th' },
      { name: 'Eva Brown', gradeLevel: '10th' },
      { name: 'Frank Miller', gradeLevel: '10th' }
    ];
    
    const studentIds: string[] = [];
    
    for (const student of studentData) {
      // Create student in roster first
      const createStudentResponse = await fetch('http://localhost:3000/api/v1/roster', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: student.name,
          gradeLevel: student.gradeLevel,
          birthDate: '2008-01-01', // Over 13, no parent consent needed
          dataConsentGiven: true,
          audioConsentGiven: true
        })
      });
      
      if (createStudentResponse.ok) {
        const rosterData = await createStudentResponse.json() as any;
        const studentId = rosterData.data?.student?.id;
        studentIds.push(studentId);
        
        // Have student join the session
        const joinResponse = await fetch('http://localhost:3000/api/v1/students/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionCode: sessionData.data?.session?.accessCode,
            studentName: student.name,
            gradeLevel: student.gradeLevel
          })
        });
        
        if (joinResponse.ok) {
          console.log(`✅ ${student.name} joined session`);
        }
      }
    }
    
    console.log(`✅ Added ${studentIds.length} students to session`);
    
    const baseUrl = `http://localhost:3000/api/v1/sessions/${testSessionId}/groups`;
    
    // Test 1: GET /api/v1/sessions/:sessionId/groups (List groups - should be empty initially)
    console.log('\n🧪 Testing GET /api/v1/sessions/:sessionId/groups (List groups - empty)...');
    
    const listEmptyResponse = await fetch(baseUrl, { headers });
    
    if (listEmptyResponse.ok) {
      const listEmptyData = await listEmptyResponse.json() as any;
      console.log('✅ List empty groups successful:', listEmptyData.groups?.length || 0, 'groups found');
    } else {
      const error = await listEmptyResponse.text();
      console.error('❌ List empty groups failed:', listEmptyResponse.status, error);
    }
    
    // Test 2: POST /api/v1/sessions/:sessionId/groups (Create group)
    console.log('\n🧪 Testing POST /api/v1/sessions/:sessionId/groups (Create group)...');
    
    const createGroupPayload = {
      name: 'Test Group Alpha',
      maxMembers: 4
    };
    
    const createGroupResponse = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(createGroupPayload)
    });
    
    let createdGroupId: string | null = null;
    
    if (createGroupResponse.ok) {
      const createGroupData = await createGroupResponse.json() as any;
      console.log('✅ Create group successful:', createGroupData.group?.name);
      createdGroupId = createGroupData.group?.id;
      console.log('Group ID:', createdGroupId);
    } else {
      const error = await createGroupResponse.text();
      console.error('❌ Create group failed:', createGroupResponse.status, error);
    }
    
    // Test 3: POST /api/v1/sessions/:sessionId/groups (Create group with leader)
    console.log('\n🧪 Testing POST /api/v1/sessions/:sessionId/groups (Create group with leader)...');
    
    const createGroupWithLeaderPayload = {
      name: 'Test Group Beta',
      maxMembers: 3,
      leaderId: studentIds[0] // Use first student as leader
    };
    
    const createGroupWithLeaderResponse = await fetch(baseUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(createGroupWithLeaderPayload)
    });
    
    let groupWithLeaderId: string | null = null;
    
    if (createGroupWithLeaderResponse.ok) {
      const createGroupWithLeaderData = await createGroupWithLeaderResponse.json() as any;
      console.log('✅ Create group with leader successful:', createGroupWithLeaderData.group?.name);
      groupWithLeaderId = createGroupWithLeaderData.group?.id;
      console.log('Group ID:', groupWithLeaderId);
      console.log('Leader ID:', createGroupWithLeaderData.group?.leaderId);
    } else {
      const error = await createGroupWithLeaderResponse.text();
      console.error('❌ Create group with leader failed:', createGroupWithLeaderResponse.status, error);
    }
    
    // Test 4: POST /api/v1/sessions/:sessionId/groups/auto-generate (Auto-generate groups)
    console.log('\n🧪 Testing POST /api/v1/sessions/:sessionId/groups/auto-generate (Auto-generate groups)...');
    
    // First, delete existing groups to test auto-generation
    if (createdGroupId) {
      await fetch(`${baseUrl}/${createdGroupId}`, { method: 'DELETE', headers });
    }
    if (groupWithLeaderId) {
      await fetch(`${baseUrl}/${groupWithLeaderId}`, { method: 'DELETE', headers });
    }
    
    const autoGeneratePayload = {
      targetSize: 3,
      maxSize: 4,
      minSize: 2,
      strategy: 'balanced'
    };
    
    const autoGenerateResponse = await fetch(`${baseUrl}/auto-generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(autoGeneratePayload)
    });
    
    let autoGroupIds: string[] = [];
    
    if (autoGenerateResponse.ok) {
      const autoGenerateData = await autoGenerateResponse.json() as any;
      console.log('✅ Auto-generate groups successful');
      console.log('Summary:', autoGenerateData.summary);
      console.log('Groups created:', autoGenerateData.groups?.length);
      autoGroupIds = autoGenerateData.groups?.map((g: any) => g.id) || [];
    } else {
      const error = await autoGenerateResponse.text();
      console.error('❌ Auto-generate groups failed:', autoGenerateResponse.status, error);
    }
    
    // Test 5: GET /api/v1/sessions/:sessionId/groups (List groups after auto-generation)
    console.log('\n🧪 Testing GET /api/v1/sessions/:sessionId/groups (List groups after auto-generation)...');
    
    const listGroupsResponse = await fetch(baseUrl, { headers });
    
    if (listGroupsResponse.ok) {
      const listGroupsData = await listGroupsResponse.json() as any;
      console.log('✅ List groups successful:', listGroupsData.groups?.length, 'groups found');
      console.log('Sample group:', listGroupsData.groups?.[0]);
    } else {
      const error = await listGroupsResponse.text();
      console.error('❌ List groups failed:', listGroupsResponse.status, error);
    }
    
    if (autoGroupIds.length === 0) {
      console.error('❌ No auto-generated groups to test further endpoints');
      return;
    }
    
    const testGroupId = autoGroupIds[0];
    
    // Test 6: PUT /api/v1/sessions/:sessionId/groups/:groupId (Update group)
    console.log('\n🧪 Testing PUT /api/v1/sessions/:sessionId/groups/:groupId (Update group)...');
    
    const updateGroupPayload = {
      name: 'Updated Group Name',
      maxMembers: 5,
      status: 'active'
    };
    
    const updateGroupResponse = await fetch(`${baseUrl}/${testGroupId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(updateGroupPayload)
    });
    
    if (updateGroupResponse.ok) {
      const updateGroupData = await updateGroupResponse.json() as any;
      console.log('✅ Update group successful:', updateGroupData.group?.name);
    } else {
      const error = await updateGroupResponse.text();
      console.error('❌ Update group failed:', updateGroupResponse.status, error);
    }
    
    // Test 7: POST /api/v1/sessions/:sessionId/groups/:groupId/assign-leader (Assign group leader)
    console.log('\n🧪 Testing POST /api/v1/sessions/:sessionId/groups/:groupId/assign-leader (Assign leader)...');
    
    // Get participants in the group to find a potential leader
    const participantsResponse = await fetch(`http://localhost:3000/api/v1/students/sessions/${testSessionId}/participants?groupId=${testGroupId}`, { headers });
    
    if (participantsResponse.ok) {
      const participantsData = await participantsResponse.json() as any;
      const participants = participantsData.participants || [];
      
      if (participants.length > 0) {
        const assignLeaderPayload = {
          leaderId: participants[0].studentId,
          reason: 'Selected for leadership qualities during testing'
        };
        
        const assignLeaderResponse = await fetch(`${baseUrl}/${testGroupId}/assign-leader`, {
          method: 'POST',
          headers,
          body: JSON.stringify(assignLeaderPayload)
        });
        
        if (assignLeaderResponse.ok) {
          const assignLeaderData = await assignLeaderResponse.json() as any;
          console.log('✅ Assign leader successful:', assignLeaderData.data?.leaderName);
          console.log('Leader ID:', assignLeaderData.data?.leaderId);
        } else {
          const error = await assignLeaderResponse.text();
          console.error('❌ Assign leader failed:', assignLeaderResponse.status, error);
        }
      } else {
        console.log('⚠️ No participants in group to assign as leader');
      }
    } else {
      console.log('⚠️ Could not fetch group participants for leader assignment test');
    }
    
    // Test 8: DELETE /api/v1/sessions/:sessionId/groups/:groupId (Delete group)
    console.log('\n🧪 Testing DELETE /api/v1/sessions/:sessionId/groups/:groupId (Delete group)...');
    
    // Use the last group for deletion test
    const deleteGroupId = autoGroupIds[autoGroupIds.length - 1];
    
    const deleteGroupResponse = await fetch(`${baseUrl}/${deleteGroupId}`, {
      method: 'DELETE',
      headers
    });
    
    if (deleteGroupResponse.ok) {
      const deleteGroupData = await deleteGroupResponse.json() as any;
      console.log('✅ Delete group successful:', deleteGroupData.message);
    } else {
      const error = await deleteGroupResponse.text();
      console.error('❌ Delete group failed:', deleteGroupResponse.status, error);
    }
    
    // Test 9: GET /api/v1/sessions/:sessionId/groups (Final list to verify deletion)
    console.log('\n🧪 Testing GET /api/v1/sessions/:sessionId/groups (Final list after deletion)...');
    
    const finalListResponse = await fetch(baseUrl, { headers });
    
    if (finalListResponse.ok) {
      const finalListData = await finalListResponse.json() as any;
      console.log('✅ Final list groups successful:', finalListData.groups?.length, 'groups remaining');
    } else {
      const error = await finalListResponse.text();
      console.error('❌ Final list groups failed:', finalListResponse.status, error);
    }
    
    // Cleanup - delete the test session
    console.log('\n🧹 Cleaning up test session...');
    await fetch(`${sessionBaseUrl}/${testSessionId}`, { method: 'DELETE', headers });
    
    console.log('\n🎉 Group Management API testing complete!');
    
  } catch (error) {
    console.error('❌ Error testing group endpoints:', error);
  } finally {
    await databricksService.disconnect();
  }
}

if (require.main === module) {
  testGroupEndpoints();
}

export { testGroupEndpoints };
