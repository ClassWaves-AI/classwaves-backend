/**
 * Integration Test: Complete Teacher → Student → WebSocket → Analytics Flow
 * 
 * Platform Stabilization Master Checklist [P1] 2.2
 * Tests the complete end-to-end flow with real auth tokens and live test database:
 * 1. Teacher creates and starts session
 * 2. Student joins session 
 * 3. WebSocket handshake for both teacher and student
 * 4. Analytics trigger and data verification
 */

// Load environment variables from .env file (like other working tests)
import 'dotenv/config';

// CRITICAL: Set JWT secrets AND Databricks token BEFORE any imports to ensure services initialize correctly
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-integration-testing-only-not-for-production-use-minimum-256-bits';
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-integration-testing-only-not-for-production-use-minimum-256-bits';
}
// Databricks token should be provided via environment variable or .env file
if (!process.env.DATABRICKS_TOKEN) {
  throw new Error(`DATABRICKS_TOKEN environment variable is required for integration tests. 
  
  Solutions:
  1. Create a .env file in classwaves-backend/ with: DATABRICKS_TOKEN=your-token-here
  2. Or run test with: DATABRICKS_TOKEN=your-token npm test -- --testPathPattern="teacher-student-websocket-analytics-flow"
  
  See classwaves-backend/docs/ENVIRONMENT_STRATEGY.md for more details.`);
}
console.log('🔐 JWT secrets and Databricks token configured before service imports');
console.log('🔧 Integration test environment setup:');
console.log('  - JWT_SECRET: configured');
console.log('  - JWT_REFRESH_SECRET: configured');
console.log('  - DATABRICKS_TOKEN:', process.env.DATABRICKS_TOKEN ? 'configured' : 'MISSING');

// CRITICAL: Reset databricks service singleton after setting environment variables
// The singleton might have been initialized with wrong env vars before our setup
function resetDatabricksService() {
  // Access the private singleton instance and reset it
  const databricksModule = require('../../services/databricks.service');
  // Force re-evaluation by clearing Node's require cache for this module
  const modulePath = require.resolve('../../services/databricks.service');
  delete require.cache[modulePath];
  console.log('🔄 Databricks service singleton reset for test environment');
}

resetDatabricksService();

import { io as Client, Socket } from 'socket.io-client';
import axios from 'axios';
import { startSessionWithAxios } from './utils/session-factory';
import { createTestSessionWithGroups, cleanupTestData } from '../test-utils/factories';
import { databricksService } from '../../services/databricks.service';
import { redisService } from '../../services/redis.service';
import { SecureJWTService } from '../../services/secure-jwt.service';
import { SecureSessionService } from '../../services/secure-session.service';
import { guidanceSystemHealthService } from '../../services/guidance-system-health.service';

describe('Complete Teacher→Student→WebSocket→Analytics Flow Integration', () => {
  let port: number;
  let teacherSocket: Socket | null = null;
  let studentSocket: Socket | null = null;
  
  // Test data
  let testTeacher: any;
  let testSchool: any;
  let testSession: any;
  let teacherToken: string;
  let studentToken: string;
  let sessionId: string;

  beforeAll(async () => {
    console.log('🔧 Test environment initialized with JWT secrets already configured');
    
    // Use existing backend server on port 3000 (no need to start our own)
    console.log('🚀 Using existing backend server on port 3000...');
    port = 3000;
    
    // Test if server is accessible
    try {
      const healthCheck = await axios.get(`http://localhost:${port}/api/v1/health`);
      console.log(`✅ Backend server is accessible on port ${port}`, healthCheck.status);
    } catch (error: any) {
      console.error('❌ Backend server is not accessible on port 3000. Make sure it\'s running with: NODE_ENV=test npm run dev');
      console.error('Health check error:', error.response?.data || error.message);
      throw new Error('Backend server not accessible. Start it first with NODE_ENV=test npm run dev');
    }
  });

  afterAll(async () => {
    // Clean shutdown of background services to prevent Jest teardown issues
    try {
      // Shutdown background services first
      await guidanceSystemHealthService.shutdown();
      
      // Allow time for cleanup of async operations
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.warn('Cleanup error in afterAll:', error);
    }
  });

  beforeEach(async () => {
    // Create test teacher and school data
    testTeacher = {
      id: `teacher_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      email: 'test.teacher@integration.test',
      name: 'Integration Test Teacher',
      google_id: `google_${Date.now()}`,
      school_id: `school_${Date.now()}`,
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
      name: 'Integration Test School',
      domain: 'integration.test',
      admin_email: 'admin@integration.test',
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

    // Insert test data into database
    await databricksService.insert('teachers', testTeacher);
    await databricksService.insert('schools', testSchool);

    console.log(`✅ Created test teacher: ${testTeacher.id} at school: ${testSchool.id}`);
  });

  afterEach(async () => {
    // Cleanup WebSocket connections with proper close handling
    if (teacherSocket) {
      teacherSocket.removeAllListeners();
      teacherSocket.disconnect();
      teacherSocket = null;
    }
    if (studentSocket) {
      studentSocket.removeAllListeners(); 
      studentSocket.disconnect();
      studentSocket = null;
    }

    // Cleanup test data
    if (testSession?.id) {
      await cleanupTestData([testSession.id]);
    }
    
    // Cleanup teacher and school
    try {
      await databricksService.delete('teachers', testTeacher.id);
      await databricksService.delete('schools', testSchool.id);
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
    
    // Additional cleanup delay to prevent Jest teardown issues
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  test('should complete full teacher→student→websocket→analytics flow', async () => {
    console.log('🎯 Starting complete integration flow test...');

    // STEP 1: Generate real JWT tokens for teacher
    console.log('📝 Step 1: Generating teacher authentication tokens...');
    console.log(`🔍 JWT_SECRET available: ${process.env.JWT_SECRET ? 'YES' : 'NO'}`);
    console.log(`🔍 JWT_REFRESH_SECRET available: ${process.env.JWT_REFRESH_SECRET ? 'YES' : 'NO'}`);
    
    // CRITICAL FIX: Use consistent request format for device fingerprinting
    // The SuperTest request will have different IP format and headers, so we need to match them
    const consistentReqFormat = {
      ip: '::ffff:127.0.0.1',
      headers: {
        'user-agent': 'axios-test',
        'x-forwarded-for': '127.0.0.1',
        'x-real-ip': '127.0.0.1',
        'x-cw-fingerprint': 'integration-flow'
      }
    };
    
    const authSessionId = `auth_${Date.now()}`;
    const teacherTokens = await SecureJWTService.generateSecureTokens(
      testTeacher,
      testSchool,
      authSessionId,
      consistentReqFormat as any
    );
    teacherToken = teacherTokens.accessToken;
    
    console.log(`🔐 Token generation result: ${teacherToken ? 'SUCCESS' : 'FAILED'}`);
    if (!teacherToken) {
      console.error('❌ CRITICAL: Token generation failed!');
      throw new Error('Token generation failed');
    }
    
    // Store secure session for teacher
    await SecureSessionService.storeSecureSession(
      authSessionId,
      testTeacher,
      testSchool,
      consistentReqFormat as any
    );

    // Ensure WebSocket auth session exists for handshake
    await redisService.storeSession(authSessionId, {
      teacherId: testTeacher.id,
      teacher: testTeacher,
      school: testSchool,
      sessionId: authSessionId,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ipAddress: '127.0.0.1',
      userAgent: 'axios-test'
    }, 3600);

    console.log(`✅ Teacher token generated: ${teacherToken.substring(0, 20)}...`);
    console.log(`🔍 Token validation - JWT structure check: ${teacherToken.split('.').length} parts`);
    
    // Test token verification with consistent request format
    try {
      const verificationResult = await SecureJWTService.verifyTokenSecurity(teacherToken, consistentReqFormat as any, 'access');
      console.log(`🔍 Token verification test: ${verificationResult ? 'PASSED' : 'FAILED'}`);
      if (verificationResult) {
        console.log(`🔍 Verified user ID: ${verificationResult.userId}`);
        console.log(`🔍 Device fingerprint consistency: MAINTAINED`);
      }
    } catch (verificationError: any) {
      console.error('❌ Token verification failed:', verificationError?.message || verificationError);
    }

    // STEP 2: Teacher creates session with groups
    console.log('📝 Step 2: Teacher creating session with pre-configured groups...');
    // Fix: Use the complete validation schema format (needs both numbers AND groups array)
    const sessionPayload = {
      topic: 'Integration Test Session',
      goal: 'Test complete teacher-student flow',
      subject: 'Computer Science',
      description: 'End-to-end integration testing',
      plannedDuration: 30,
      groupPlan: {
        numberOfGroups: 2,
        groupSize: 3,
        groups: [
          {
            name: 'Test Group A',
            leaderId: 'student-leader-1',
            memberIds: ['student-member-1', 'student-member-2']
          },
          {
            name: 'Test Group B',
            leaderId: 'student-leader-2',
            memberIds: ['student-member-3']
          }
        ]
      }
    };

    console.log('🚀 Making session creation request...');
    console.log(`📝 Authorization header: Bearer ${teacherToken.substring(0, 30)}...`);
    console.log('📝 Session payload:', JSON.stringify(sessionPayload, null, 2));
    
    console.log('🔍 Making direct HTTP request to real server to see full error details...');
    
    // Make direct HTTP request instead of SuperTest to get full error visibility
    const createResponse = await axios.post(`http://localhost:${port}/api/v1/sessions`, sessionPayload, {
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'axios-test',
        'x-forwarded-for': '127.0.0.1',
        'x-real-ip': '127.0.0.1',
        'x-cw-fingerprint': 'integration-flow'
      },
      timeout: 30000,
      validateStatus: () => true // Don't throw on error status codes
    });
      
    console.log('📊 Session creation response status:', createResponse.status);
    console.log('📊 Session creation response data:', JSON.stringify(createResponse.data, null, 2));
    
    // Check for success with axios response format
    if (createResponse.status !== 201) {
      // Wait a moment for any async error logging to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      throw new Error(`❌ SESSION CREATION FAILED: ${createResponse.status} - ${JSON.stringify(createResponse.data, null, 2)}\n\n🔍 Check backend console logs above for detailed database error info`);
    }
    
    expect(createResponse.status).toBe(201);

    expect(createResponse.data.success).toBe(true);
    testSession = createResponse.data.data.session;
    sessionId = testSession.id;
    const accessCode: string = createResponse.data.data.accessCode;
    
    console.log(`✅ Session created: ${sessionId}`);

    // STEP 3: Teacher starts session (seed readiness first)
    console.log('📝 Step 3: Teacher starting session...');
    const startResponse = await startSessionWithAxios(`http://localhost:${port}`, teacherToken, sessionId);
    expect(startResponse.status).toBe(200);
    expect((startResponse.data as any).success).toBe(true);
    expect((startResponse.data as any).data.session.status).toBe('active');
    
    console.log(`✅ Session started successfully`);

    // STEP 4: Student joins session
    console.log('📝 Step 4: Student joining session...');
    const studentJoinPayload = {
      sessionCode: accessCode,
      studentName: 'Integration Test Student',
      displayName: 'Test Student',
      dateOfBirth: '2010-01-01' // Over 13 to avoid COPPA complexity
    };

    const joinResponse = await axios.post(`http://localhost:${port}/api/v1/sessions/join`, studentJoinPayload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'axios-test',
        'x-forwarded-for': '127.0.0.1',
        'x-real-ip': '127.0.0.1',
        'x-cw-fingerprint': 'integration-flow'
      },
      timeout: 30000,
      validateStatus: () => true
    });

    expect(joinResponse.status).toBe(200);
    studentToken = (joinResponse.data && (joinResponse.data.token || (joinResponse.data.data && joinResponse.data.data.token))) || joinResponse.data?.token;
    expect(studentToken).toBeDefined();
    
    console.log(`✅ Student joined session, token: ${studentToken.substring(0, 20)}...`);

    // STEP 5: Teacher WebSocket connection and session join
    console.log('📝 Step 5: Establishing teacher WebSocket connection...');
    teacherSocket = Client(`http://localhost:${port}`, {
      auth: { token: teacherToken },
      transports: ['websocket']
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Teacher WebSocket connection timeout'));
      }, 10000);

      teacherSocket?.on('connect', () => {
        clearTimeout(timeout);
        console.log('✅ Teacher WebSocket connected');
        resolve(true);
      });

      teacherSocket?.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Teacher joins session room
    const teacherSessionJoinPromise = new Promise<any>((resolve) => {
      teacherSocket?.on('session:status_changed', (data) => {
        expect(data.sessionId).toBe(sessionId);
        expect(data.status).toBe('active');
        console.log('✅ Teacher received session status update');
        resolve(data);
      });
    });

    teacherSocket?.emit('session:join', { sessionId });
    await teacherSessionJoinPromise;

    // STEP 6: Student WebSocket connection and session join
    console.log('📝 Step 6: Establishing student WebSocket connection...');
    studentSocket = Client(`http://localhost:${port}`, {
      auth: { token: studentToken },
      transports: ['websocket']
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Student WebSocket connection timeout'));
      }, 10000);

      studentSocket?.on('connect', () => {
        clearTimeout(timeout);
        console.log('✅ Student WebSocket connected');
        resolve(true);
      });

      studentSocket?.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Student joins session
    const studentSessionJoinPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Student session join timeout'));
      }, 10000);

      studentSocket?.on('student:session:joined', (data) => {
        clearTimeout(timeout);
        expect(data.sessionId).toBe(sessionId);
        expect(data.groupId).toBeDefined();
        console.log(`✅ Student joined session ${sessionId} and group ${data.groupId}`);
        resolve(data);
      });

      studentSocket?.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    studentSocket?.emit('student:session:join', { sessionId });
    await studentSessionJoinPromise;

    // STEP 7: Verify WebSocket bidirectional communication
    console.log('📝 Step 7: Testing WebSocket bidirectional communication...');
    
    // Test session status broadcast from teacher to student
    const studentStatusUpdatePromise = new Promise<any>((resolve) => {
      studentSocket?.on('session:status_changed', (data) => {
        expect(data.sessionId).toBe(sessionId);
        console.log('✅ Student received session status broadcast');
        resolve(data);
      });
    });

    // Use REST API to start session (proper REST-first architecture)
    console.log('📡 Starting session via REST API (not WebSocket)...');
    const restResponse = await axios.post(
      `http://localhost:${port}/api/v1/sessions/${sessionId}/start`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${teacherToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    expect(restResponse.status).toBe(200);
    console.log('✅ Session started via REST API');

    // Verify WebSocket notification was broadcast automatically
    await studentStatusUpdatePromise;

    // STEP 8: Verify analytics were triggered and recorded
    console.log('📝 Step 8: Verifying analytics data was recorded...');
    
    // Check session_events table for session started events (REST API only - single source of truth)
    const sessionEvents = await databricksService.query(
      `SELECT * FROM classwaves.analytics.session_events 
       WHERE session_id = ? AND event_type = 'started'
       ORDER BY event_time DESC`,
      [sessionId]
    );

    expect(sessionEvents).toHaveLength(1); // Exactly 1 record from REST API (WebSocket duplicates eliminated)
    sessionEvents.forEach((event: any) => {
      expect(event.teacher_id).toBe(testTeacher.id);
      expect(event.event_type).toBe('started');
    });
    
    // Verify event payload details
    const startEvent = sessionEvents[0] as any;
    const eventPayload = JSON.parse(startEvent.payload);
    expect(eventPayload.readyGroupsAtStart).toBeGreaterThanOrEqual(0);
    expect(eventPayload.timestamp).toBeDefined();
    expect(eventPayload.source).toBe('session_controller'); // Verify REST API source (not WebSocket)
    
    console.log(`✅ Analytics recorded: ${startEvent.event_type} event from ${eventPayload.source} with payload:`, eventPayload);

    // Check session_metrics table was updated
    const sessionMetrics = await databricksService.query(
      `SELECT * FROM classwaves.analytics.session_metrics 
       WHERE session_id = ?`,
      [sessionId]
    );

    expect(sessionMetrics).toHaveLength(1); // Single metrics record (created by recordSessionConfigured, updated by recordSessionStarted)
    
    // Verify the metrics record
    const metrics = sessionMetrics[0] as any;
    expect(metrics.session_id).toBe(sessionId);
    expect(metrics.calculation_timestamp).toBeDefined();
    expect(metrics.total_students).toBeGreaterThanOrEqual(0);
    expect(metrics.active_students).toBe(0);
    
    console.log(`✅ Session metrics updated:`, {
      sessionId: metrics.session_id,
      actualGroups: metrics.actual_groups,
      readyGroupsAtStart: metrics.ready_groups_at_start
    });

    // Check audit log was created
    const auditLogs = await databricksService.query(
      `SELECT * FROM classwaves.compliance.audit_log 
       WHERE resource_id = ? AND event_type = 'session_started'
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId]
    );

    expect(auditLogs).toHaveLength(1);
    const auditLog = auditLogs[0] as any;
    expect(auditLog.actor_id).toBe(testTeacher.id);
    expect(auditLog.event_type).toBe('session_started');
    expect(auditLog.resource_type).toBe('session');
    
    console.log(`✅ Audit log created: ${auditLog.event_type} by ${auditLog.actor_id}`);

    // STEP 9: Verify participant record was created for student
    console.log('📝 Step 9: Verifying student participation records...');
    
    const participants = await databricksService.query(
      `SELECT * FROM classwaves.sessions.participants 
       WHERE session_id = ? AND is_active = true`,
      [sessionId]
    );

    expect(participants.length).toBeGreaterThan(0);
    const participant = participants[0] as any;
    expect(participant.session_id).toBe(sessionId);
    expect(participant.display_name).toBe('Test Student');
    expect(participant.group_id).toBeDefined();
    
    console.log(`✅ Student participant record created: ${participant.display_name} in group ${participant.group_id}`);

    console.log('🎉 COMPLETE INTEGRATION TEST PASSED - All systems verified!');
  }, 60000); // 60 second timeout for complete flow

  test('should handle WebSocket disconnection and reconnection gracefully', async () => {
    console.log('🎯 Testing WebSocket disconnection/reconnection handling...');

    // Setup basic session and connections (abbreviated) with consistent request format
    const consistentReqFormat = {
      ip: '::ffff:127.0.0.1',
      headers: {
        'user-agent': '',
        'x-forwarded-for': undefined,
        'x-real-ip': undefined,
        'x-cw-fingerprint': 'integration-flow'
      }
    };
    
    const teacherTokens = await SecureJWTService.generateSecureTokens(
      testTeacher,
      testSchool,
      `session_${Date.now()}`,
      consistentReqFormat as any
    );
    teacherToken = teacherTokens.accessToken;

    // Create and start session quickly
    // Fix: Use the complete validation schema format
    const sessionPayload = {
      topic: 'Reconnection Test',
      goal: 'Test WebSocket reconnection',
      subject: 'Testing',
      plannedDuration: 15,
      groupPlan: {
        numberOfGroups: 1,
        groupSize: 2,
        groups: [{
          name: 'Test Group',
          leaderId: 'student-1',
          memberIds: ['student-2']
        }]
      }
    };

    const createResponse = await axios.post(`http://localhost:${port}/api/v1/sessions`, sessionPayload, {
      headers: {
        'Authorization': `Bearer ${teacherToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'axios-test',
        'x-forwarded-for': '127.0.0.1',
        'x-real-ip': '127.0.0.1',
        'x-cw-fingerprint': 'integration-flow'
      },
      timeout: 30000,
      validateStatus: () => true
    });

    expect(createResponse.status).toBeGreaterThanOrEqual(200);
    expect(createResponse.status).toBeLessThan(300);
    testSession = createResponse.data.data.session;
    sessionId = testSession.id;

    // Start session (ensure readiness again)
    await startSessionWithAxios(`http://localhost:${port}`, teacherToken, sessionId);

    // Connect teacher WebSocket
    teacherSocket = Client(`http://localhost:${port}/sessions`, {
      auth: { token: teacherToken },
      transports: ['websocket']
    });

    await new Promise<void>((resolve) => {
      teacherSocket?.on('connect', () => resolve());
    });

    // Join session
    teacherSocket?.emit('session:join', { sessionId });

    // Simulate disconnection
    console.log('📝 Simulating WebSocket disconnection...');
    teacherSocket?.disconnect();

    // Wait briefly
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Reconnect
    console.log('📝 Attempting WebSocket reconnection...');
    teacherSocket?.connect();

    const reconnectionPromise = new Promise<boolean>((resolve) => {
      teacherSocket?.on('connect', () => {
        console.log('✅ WebSocket reconnected successfully');
        resolve(true);
      });
    });

    await reconnectionPromise;

    // Verify can rejoin session
    const rejoinPromise = new Promise<any>((resolve) => {
      teacherSocket?.on('session:status_changed', (data) => {
        expect(data.sessionId).toBe(sessionId);
        console.log('✅ Successfully rejoined session after reconnection');
        resolve(data);
      });
    });

    teacherSocket?.emit('session:join', { sessionId });
    await rejoinPromise;

    console.log('🎉 WebSocket reconnection test passed!');
  }, 30000);

  test('should validate authentication failures gracefully', async () => {
    console.log('🎯 Testing authentication failure handling...');

    // Attempt to connect with invalid token
    const invalidSocket = Client(`http://localhost:${port}/sessions`, {
      auth: { token: 'invalid-token' },
      transports: ['websocket']
    });

    const authFailurePromise = new Promise<any>((resolve) => {
      invalidSocket.on('connect_error', (error) => {
        console.log('✅ Authentication failure handled correctly:', error.message);
        resolve(error);
      });
    });

    await authFailurePromise;
    invalidSocket.disconnect();

    // Test API call with invalid token
    const apiResponse = await axios.post(`http://localhost:${port}/api/v1/sessions`, { topic: 'Test' }, {
      headers: { 'Authorization': 'Bearer invalid-token', 'Content-Type': 'application/json' },
      timeout: 30000,
      validateStatus: () => true
    });

    expect(apiResponse.status).toBe(401);
    expect(apiResponse.data.error).toBe('INVALID_TOKEN');
    console.log('✅ API authentication failure handled correctly');

    console.log('🎉 Authentication failure test passed!');
  });
});
