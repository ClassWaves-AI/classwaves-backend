/**
 * Quick Analytics Validation Test
 * 
 * Simple test to validate REST-first architecture fix:
 * - Should create exactly 1 analytics record (not 0 or 2)
 * - Validates duplicate analytics recording is eliminated
 */

// Load environment variables from .env file
import 'dotenv/config';

// CRITICAL: Set JWT secrets before imports
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-integration-testing-only-not-for-production-use-minimum-256-bits';
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-integration-testing-only-not-for-production-use-minimum-256-bits';
}

import axios from 'axios';
import { databricksService } from '../../services/databricks.service';
import { SecureJWTService } from '../../services/secure-jwt.service';
import { SecureSessionService } from '../../services/secure-session.service';

describe('REST-First Analytics Validation', () => {
  const port = 3000;
  let testTeacher: any;
  let testSchool: any;
  let teacherToken: string;
  let sessionId: string;
  let testTimestamp: number;

  beforeAll(async () => {
    // Quick health check
    const health = await axios.get(`http://localhost:${port}/api/v1/health`);
    expect(health.status).toBe(200);
    console.log('✅ Backend server is accessible');
  });

  beforeEach(async () => {
    // Create minimal test data
    testTimestamp = Date.now();
    const timestamp = testTimestamp;
    testTeacher = {
      id: `teacher_${timestamp}`,
      email: 'test.teacher@validation.test',
      name: 'Test Teacher',
      google_id: `google_${timestamp}`,
      school_id: `school_${timestamp}`,
      role: 'teacher',
      status: 'active',
      access_level: 'teacher',
      max_concurrent_sessions: 5,
      current_sessions: 0,
      login_count: 1,
      total_sessions_created: 0,
      timezone: 'UTC',
      created_at: new Date(),
      updated_at: new Date()
    };

    testSchool = {
      id: testTeacher.school_id,
      name: 'Test School',
      domain: 'validation.test',
      admin_email: 'admin@validation.test',
      subscription_tier: 'premium',
      subscription_status: 'active',
      max_teachers: 50,
      current_teachers: 1,
      ferpa_agreement: true,
      coppa_compliant: true,
      data_retention_days: 365,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Create test students for group leaders
    const testStudents = [
      {
        id: `student_leader_${timestamp}_1`,
        display_name: 'Rob Test',
        email: 'rheck56@gmail.com',
        school_id: testTeacher.school_id,
        status: 'active',
        has_parental_consent: true,
        data_sharing_consent: true,
        audio_recording_consent: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: `student_leader_${timestamp}_2`,
        display_name: 'Rob Taronc',
        email: 'rtaroncher56@gmail.com',
        school_id: testTeacher.school_id,
        status: 'active',
        has_parental_consent: true,
        data_sharing_consent: true,
        audio_recording_consent: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    ];

    // Insert test data
    await databricksService.insert('teachers', testTeacher);
    await databricksService.insert('schools', testSchool);
    for (const student of testStudents) {
      await databricksService.insert('students', student);
    }

    // Generate JWT token
    const authSessionId = `auth_${timestamp}`;
    const consistentReqFormat = {
      ip: '::ffff:127.0.0.1',
      headers: {
        'user-agent': 'axios-test',
        'x-forwarded-for': '127.0.0.1',
        'x-real-ip': '127.0.0.1',
        'x-cw-fingerprint': 'rest-analytics-test'
      }
    };

    const tokens = await SecureJWTService.generateSecureTokens(
      testTeacher,
      testSchool,
      authSessionId,
      consistentReqFormat as any
    );
    teacherToken = tokens.accessToken;

    await SecureSessionService.storeSecureSession(
      authSessionId,
      testTeacher,
      testSchool,
      consistentReqFormat as any
    );
  });

  afterEach(async () => {
    // Cleanup test data
    try {
      if (sessionId) {
        // Clean up session analytics
        await databricksService.query(
          `DELETE FROM classwaves.analytics.session_events WHERE session_id = ?`,
          [sessionId]
        );
        await databricksService.query(
          `DELETE FROM classwaves.sessions.sessions WHERE id = ?`,
          [sessionId]
        );
      }

      // Clean up test students
      const studentIds = [
        `student_leader_${testTimestamp}_1`,
        `student_leader_${testTimestamp}_2`
      ];
      for (const studentId of studentIds) {
        try {
          await databricksService.delete('students', studentId);
        } catch (error) {
          // Student might not exist, continue with cleanup
        }
      }

      await databricksService.delete('teachers', testTeacher.id);
      await databricksService.delete('schools', testSchool.id);
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  });

  test('REST API should create exactly 1 analytics record (not 0 or 2)', async () => {
    console.log('🎯 Testing REST-first analytics recording...');

    // STEP 1: Create session via REST API
    sessionId = `rest_test_${Date.now()}`;
    const timestamp = Date.now();
    const sessionPayload = {
      topic: 'Fractions',
      goal: 'Learn fraction operations and problem solving',
      subject: 'Math',
      description: 'Testing single analytics recording',
      plannedDuration: 45,
      groupPlan: {
        numberOfGroups: 2,
        groupSize: 3,
        groups: [
          {
            name: 'Group A',
            leaderId: `student_leader_${timestamp}_1`,
            memberIds: []
          },
          {
            name: 'Group B',
            leaderId: `student_leader_${timestamp}_2`,
            memberIds: []
          }
        ]
      },
      aiConfig: {
        hidden: true,
        defaultsApplied: true
      }
    };

    const createResponse = await axios.post(
      `http://localhost:${port}/api/v1/sessions`,
      sessionPayload,
      {
        headers: {
          'Authorization': `Bearer ${teacherToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'axios-test',
          'x-forwarded-for': '127.0.0.1',
          'x-real-ip': '127.0.0.1',
          'x-cw-fingerprint': 'rest-analytics-test'
        }
      }
    );

    expect(createResponse.status).toBe(201);
    sessionId = createResponse.data.data.session.id;
    console.log(`✅ Session created: ${sessionId}`);

    // STEP 2: Start session via REST API (should record analytics)
    const startResponse = await axios.post(
      `http://localhost:${port}/api/v1/sessions/${sessionId}/start`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${teacherToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'axios-test',
          'x-forwarded-for': '127.0.0.1',
          'x-real-ip': '127.0.0.1',
          'x-cw-fingerprint': 'rest-analytics-test'
        }
      }
    );

    expect(startResponse.status).toBe(200);
    console.log('✅ Session started via REST API');

    // STEP 3: Wait for analytics processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // STEP 4: Verify exactly 1 analytics record
    const sessionEvents = await databricksService.query(
      `SELECT * FROM classwaves.analytics.session_events 
       WHERE session_id = ? AND event_type = 'started'
       ORDER BY event_time DESC`,
      [sessionId]
    );

    console.log(`📊 Analytics records found: ${sessionEvents.length}`);
    
    // CRITICAL VALIDATION: Should be exactly 1 (not 0 or 2)
    expect(sessionEvents).toHaveLength(1);
    
    // Verify it came from REST API (not WebSocket)
    const event = sessionEvents[0] as any;
    const payload = JSON.parse(event.payload);
    expect(payload.source).toBe('session_controller');
    
    console.log('🎉 SUCCESS: REST-first architecture working correctly!');
    console.log(`   - Analytics records: ${sessionEvents.length} (expected: 1)`);
    console.log(`   - Source: ${payload.source} (expected: session_controller)`);
    console.log('   - Duplicate analytics recording eliminated ✅');

  }, 30000); // 30 second timeout

});
