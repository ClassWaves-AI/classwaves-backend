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

import { Server } from 'http';
import { io as Client, Socket } from 'socket.io-client';
import request from 'supertest';
import { createTestApp } from '../test-utils/app-setup';
import { createTestSessionWithGroups, cleanupTestData } from '../test-utils/factories';
import { databricksService } from '../../services/databricks.service';
import { SecureJWTService } from '../../services/secure-jwt.service';
import { SecureSessionService } from '../../services/secure-session.service';

describe('Complete Teacher→Student→WebSocket→Analytics Flow Integration', () => {
  let app: any;
  let server: Server;
  let port: number;
  let teacherSocket: Socket;
  let studentSocket: Socket;
  
  // Test data
  let testTeacher: any;
  let testSchool: any;
  let testSession: any;
  let teacherToken: string;
  let studentToken: string;
  let sessionId: string;

  beforeAll(async () => {
    // Create test app with real database connection
    const testSetup = await createTestApp();
    app = testSetup.app;
    server = testSetup.server;
    port = testSetup.port;

    console.log(`🚀 Integration test server running on port ${port}`);
  });

  afterAll(async () => {
    if (server) {
      server.close();
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
      timezone: 'UTC',
      created_at: new Date(),
      updated_at: new Date()
    };

    testSchool = {
      id: testTeacher.school_id,
      name: 'Integration Test School',
      domain: 'integration.test',
      subscription_status: 'active',
      subscription_tier: 'premium',
      ferpa_agreement: true,
      coppa_compliant: true,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Insert test data into database
    await databricksService.insert('classwaves.users.teachers', testTeacher);
    await databricksService.insert('classwaves.users.schools', testSchool);

    console.log(`✅ Created test teacher: ${testTeacher.id} at school: ${testSchool.id}`);
  });

  afterEach(async () => {
    // Cleanup WebSocket connections
    if (teacherSocket) {
      teacherSocket.disconnect();
    }
    if (studentSocket) {
      studentSocket.disconnect();
    }

    // Cleanup test data
    if (testSession?.id) {
      await cleanupTestData([testSession.id]);
    }
    
    // Cleanup teacher and school
    try {
      await databricksService.query('DELETE FROM classwaves.users.teachers WHERE id = ?', [testTeacher.id]);
      await databricksService.query('DELETE FROM classwaves.users.schools WHERE id = ?', [testSchool.id]);
    } catch (error) {
      console.warn('Cleanup warning:', error);
    }
  });

  test('should complete full teacher→student→websocket→analytics flow', async () => {
    console.log('🎯 Starting complete integration flow test...');

    // STEP 1: Generate real JWT tokens for teacher
    console.log('📝 Step 1: Generating teacher authentication tokens...');
    const teacherTokens = await SecureJWTService.generateSecureTokens(
      testTeacher,
      testSchool,
      `session_${Date.now()}`,
      { ip: '127.0.0.1', headers: { 'user-agent': 'integration-test' } } as any
    );
    teacherToken = teacherTokens.accessToken;
    
    // Store secure session for teacher
    await SecureSessionService.storeSecureSession(
      teacherTokens.deviceFingerprint,
      testTeacher,
      testSchool,
      { ip: '127.0.0.1', headers: { 'user-agent': 'integration-test' } } as any
    );

    console.log(`✅ Teacher token generated: ${teacherToken.substring(0, 20)}...`);

    // STEP 2: Teacher creates session with groups
    console.log('📝 Step 2: Teacher creating session with pre-configured groups...');
    const sessionPayload = {
      topic: 'Integration Test Session',
      goal: 'Test complete teacher-student flow',
      subject: 'Computer Science',
      description: 'End-to-end integration testing',
      plannedDuration: 30,
      groupPlan: {
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

    const createResponse = await request(app)
      .post('/api/v1/sessions')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send(sessionPayload)
      .expect(201);

    expect(createResponse.body.success).toBe(true);
    testSession = createResponse.body.data.session;
    sessionId = testSession.id;
    
    console.log(`✅ Session created: ${sessionId}`);

    // STEP 3: Teacher starts session
    console.log('📝 Step 3: Teacher starting session...');
    const startResponse = await request(app)
      .post(`/api/v1/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${teacherToken}`)
      .expect(200);

    expect(startResponse.body.success).toBe(true);
    expect(startResponse.body.data.session.status).toBe('active');
    
    console.log(`✅ Session started successfully`);

    // STEP 4: Student joins session
    console.log('📝 Step 4: Student joining session...');
    const studentJoinPayload = {
      sessionCode: testSession.access_code,
      studentName: 'Integration Test Student',
      displayName: 'Test Student',
      dateOfBirth: '2010-01-01' // Over 13 to avoid COPPA complexity
    };

    const joinResponse = await request(app)
      .post('/api/v1/sessions/join')
      .send(studentJoinPayload)
      .expect(200);

    studentToken = joinResponse.body.token;
    expect(studentToken).toBeDefined();
    
    console.log(`✅ Student joined session, token: ${studentToken.substring(0, 20)}...`);

    // STEP 5: Teacher WebSocket connection and session join
    console.log('📝 Step 5: Establishing teacher WebSocket connection...');
    teacherSocket = Client(`http://localhost:${port}/sessions`, {
      auth: { token: teacherToken },
      transports: ['websocket']
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Teacher WebSocket connection timeout'));
      }, 10000);

      teacherSocket.on('connect', () => {
        clearTimeout(timeout);
        console.log('✅ Teacher WebSocket connected');
        resolve(true);
      });

      teacherSocket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Teacher joins session room
    const teacherSessionJoinPromise = new Promise((resolve) => {
      teacherSocket.on('session:status_changed', (data) => {
        expect(data.sessionId).toBe(sessionId);
        expect(data.status).toBe('active');
        console.log('✅ Teacher received session status update');
        resolve(data);
      });
    });

    teacherSocket.emit('session:join', { sessionId });
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

      studentSocket.on('connect', () => {
        clearTimeout(timeout);
        console.log('✅ Student WebSocket connected');
        resolve(true);
      });

      studentSocket.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    // Student joins session
    const studentSessionJoinPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Student session join timeout'));
      }, 10000);

      studentSocket.on('student:session:joined', (data) => {
        clearTimeout(timeout);
        expect(data.sessionId).toBe(sessionId);
        expect(data.groupId).toBeDefined();
        console.log(`✅ Student joined session ${sessionId} and group ${data.groupId}`);
        resolve(data);
      });

      studentSocket.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    studentSocket.emit('student:session:join', { sessionId });
    await studentSessionJoinPromise;

    // STEP 7: Verify WebSocket bidirectional communication
    console.log('📝 Step 7: Testing WebSocket bidirectional communication...');
    
    // Test session status broadcast from teacher to student
    const studentStatusUpdatePromise = new Promise((resolve) => {
      studentSocket.on('session:status_changed', (data) => {
        expect(data.sessionId).toBe(sessionId);
        console.log('✅ Student received session status broadcast');
        resolve(data);
      });
    });

    // Simulate a session status update
    teacherSocket.emit('session:update_status', { 
      sessionId, 
      status: 'active', 
      broadcastToStudents: true 
    });

    await studentStatusUpdatePromise;

    // STEP 8: Verify analytics were triggered and recorded
    console.log('📝 Step 8: Verifying analytics data was recorded...');
    
    // Check session_events table for session started event
    const sessionEvents = await databricksService.query(
      `SELECT * FROM classwaves.analytics.session_events 
       WHERE session_id = ? AND event_type = 'started'
       ORDER BY event_time DESC
       LIMIT 1`,
      [sessionId]
    );

    expect(sessionEvents).toHaveLength(1);
    const startEvent = sessionEvents[0] as any;
    expect(startEvent.teacher_id).toBe(testTeacher.id);
    expect(startEvent.event_type).toBe('started');
    
    const eventPayload = JSON.parse(startEvent.payload);
    expect(eventPayload.readyGroupsAtStart).toBeGreaterThanOrEqual(0);
    expect(eventPayload.timestamp).toBeDefined();
    
    console.log(`✅ Analytics recorded: ${startEvent.event_type} event with payload:`, eventPayload);

    // Check session_metrics table was updated
    const sessionMetrics = await databricksService.query(
      `SELECT * FROM classwaves.analytics.session_metrics 
       WHERE session_id = ?`,
      [sessionId]
    );

    expect(sessionMetrics).toHaveLength(1);
    const metrics = sessionMetrics[0] as any;
    expect(metrics.session_id).toBe(sessionId);
    expect(metrics.calculation_timestamp).toBeDefined();
    
    console.log(`✅ Session metrics updated:`, {
      sessionId: metrics.session_id,
      actualGroups: metrics.actual_groups,
      readyGroupsAtStart: metrics.ready_groups_at_start
    });

    // Check audit log was created
    const auditLogs = await databricksService.query(
      `SELECT * FROM classwaves.compliance.audit_logs 
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

    // Setup basic session and connections (abbreviated)
    const teacherTokens = await SecureJWTService.generateSecureTokens(
      testTeacher,
      testSchool,
      `session_${Date.now()}`,
      { ip: '127.0.0.1', headers: { 'user-agent': 'integration-test' } } as any
    );
    teacherToken = teacherTokens.accessToken;

    // Create and start session quickly
    const sessionPayload = {
      topic: 'Reconnection Test',
      goal: 'Test WebSocket reconnection',
      subject: 'Testing',
      plannedDuration: 15,
      groupPlan: {
        groups: [{
          name: 'Test Group',
          leaderId: 'student-1',
          memberIds: []
        }]
      }
    };

    const createResponse = await request(app)
      .post('/api/v1/sessions')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send(sessionPayload);

    testSession = createResponse.body.data.session;
    sessionId = testSession.id;

    // Start session
    await request(app)
      .post(`/api/v1/sessions/${sessionId}/start`)
      .set('Authorization', `Bearer ${teacherToken}`);

    // Connect teacher WebSocket
    teacherSocket = Client(`http://localhost:${port}/sessions`, {
      auth: { token: teacherToken },
      transports: ['websocket']
    });

    await new Promise((resolve) => {
      teacherSocket.on('connect', resolve);
    });

    // Join session
    teacherSocket.emit('session:join', { sessionId });

    // Simulate disconnection
    console.log('📝 Simulating WebSocket disconnection...');
    teacherSocket.disconnect();

    // Wait briefly
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Reconnect
    console.log('📝 Attempting WebSocket reconnection...');
    teacherSocket.connect();

    const reconnectionPromise = new Promise((resolve) => {
      teacherSocket.on('connect', () => {
        console.log('✅ WebSocket reconnected successfully');
        resolve(true);
      });
    });

    await reconnectionPromise;

    // Verify can rejoin session
    const rejoinPromise = new Promise((resolve) => {
      teacherSocket.on('session:status_changed', (data) => {
        expect(data.sessionId).toBe(sessionId);
        console.log('✅ Successfully rejoined session after reconnection');
        resolve(data);
      });
    });

    teacherSocket.emit('session:join', { sessionId });
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

    const authFailurePromise = new Promise((resolve) => {
      invalidSocket.on('connect_error', (error) => {
        console.log('✅ Authentication failure handled correctly:', error.message);
        resolve(error);
      });
    });

    await authFailurePromise;
    invalidSocket.disconnect();

    // Test API call with invalid token
    const apiResponse = await request(app)
      .post('/api/v1/sessions')
      .set('Authorization', 'Bearer invalid-token')
      .send({ topic: 'Test' })
      .expect(401);

    expect(apiResponse.body.error).toBe('INVALID_TOKEN');
    console.log('✅ API authentication failure handled correctly');

    console.log('🎉 Authentication failure test passed!');
  });
});
