/**
 * WebSocket Events Verification Integration Test
 * Task SG-BE-06: Verify existing WebSocket events work correctly
 * 
 * This test validates the core WebSocket events for session gating:
 * - group:leader_ready with idempotency
 * - group:status_changed with issue status support  
 * - wavelistener:issue event handling
 */

// Load environment variables (following existing test patterns)
import 'dotenv/config';

// CRITICAL: Set JWT secrets before any imports (copied from working tests)
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-integration-testing-only-not-for-production-use-minimum-256-bits';
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-integration-testing-only-not-for-production-use-minimum-256-bits';
}

// Databricks token check (following existing patterns)
if (!process.env.DATABRICKS_TOKEN) {
  console.warn('DATABRICKS_TOKEN not set - test will run in mock mode');
}

console.log('🔐 JWT secrets configured before service imports');

// Reset databricks service singleton (following existing pattern)
function resetDatabricksService() {
  const databricksModule = require('../../services/databricks.service');
  const modulePath = require.resolve('../../services/databricks.service');
  delete require.cache[modulePath];
  console.log('🔄 Databricks service reset for test environment');
}

resetDatabricksService();

import { io as Client, Socket } from 'socket.io-client';
import axios from 'axios';
import { createTestSessionWithGroups, cleanupTestData } from '../test-utils/factories';
import { databricksService } from '../../services/databricks.service';
import { redisService } from '../../services/redis.service';

describe('WebSocket Events Verification (SG-BE-06)', () => {
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
  let groupId: string;

  beforeAll(async () => {
    console.log('🔧 WebSocket Events Verification test environment initialized');
    
    // Use existing backend server on port 3000 (following existing pattern)
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
    // Clean shutdown (following existing pattern)
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.warn('Cleanup error in afterAll:', error);
    }
  });

  beforeEach(async () => {
    // Clean up Redis cache (using correct method)
    try {
      await redisService.getClient().flushall();
      redisService.clearCache();
    } catch (error) {
      console.warn('Redis cleanup failed (continuing anyway):', error);
    }
    
    // Create test session and group (using existing factory)
    const testData = await createTestSessionWithGroups(1); // 1 group
    testTeacher = testData.teacher;
    testSchool = testData.school;
    testSession = testData.session;
    sessionId = testSession.id;
    groupId = testData.groups[0].id;

    // Create tokens (simplified for test)
    teacherToken = `teacher-${testTeacher.id}`;
    studentToken = `student-leader-${testData.groups[0].leader_id}`;

    // Create WebSocket clients (following existing patterns)
    teacherSocket = Client(`http://localhost:${port}/sessions`, {
      transports: ['websocket'],
      forceNew: true
    });

    studentSocket = Client(`http://localhost:${port}/sessions`, {
      transports: ['websocket'], 
      forceNew: true
    });

    // Wait for connections (fixing the Promise pattern)
    await Promise.all([
      new Promise<void>(resolve => teacherSocket!.on('connect', () => resolve())),
      new Promise<void>(resolve => studentSocket!.on('connect', () => resolve()))
    ]);

    // Join session rooms
    teacherSocket.emit('session:join', { sessionId });
    studentSocket.emit('session:join', { sessionId });
    
    // Wait for room joining
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterEach(async () => {
    // Disconnect clients
    if (teacherSocket?.connected) {
      teacherSocket.disconnect();
      teacherSocket = null;
    }
    if (studentSocket?.connected) {
      studentSocket.disconnect();  
      studentSocket = null;
    }
    
    // Clean up test data
    try {
      await cleanupTestData({
        teacher: testTeacher,
        school: testSchool,
        session: testSession
      });
    } catch (error) {
      console.warn('Test data cleanup failed:', error);
    }
  });

  describe('group:leader_ready Event', () => {
    it('should handle group:leader_ready event and broadcast status change', async () => {
      // Set up event listeners
      const teacherEvents: any[] = [];
      const studentEvents: any[] = [];

      teacherSocket!.on('group:status_changed', (data) => {
        teacherEvents.push({ type: 'status_changed', data });
      });

      studentSocket!.on('group:leader_ready_confirmed', (data) => {
        studentEvents.push({ type: 'ready_confirmed', data });
      });

      // Emit leader ready event
      studentSocket!.emit('group:leader_ready', {
        sessionId,
        groupId,
        ready: true
      });

      // Wait for events to propagate
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify events
      expect(teacherEvents).toHaveLength(1);
      expect(teacherEvents[0].data).toMatchObject({
        groupId,
        status: 'ready',
        isReady: true
      });

      expect(studentEvents).toHaveLength(1);
      expect(studentEvents[0].data).toMatchObject({
        groupId,
        sessionId,
        isReady: true
      });

      // Verify idempotency key is present
      expect(studentEvents[0].data).toHaveProperty('idempotencyKey');
    });

    it('should be idempotent for duplicate ready events', async () => {
      const teacherEvents: any[] = [];
      const studentEvents: any[] = [];

      teacherSocket!.on('group:status_changed', (data) => {
        teacherEvents.push(data);
      });

      studentSocket!.on('group:leader_ready_confirmed', (data) => {
        studentEvents.push(data);
      });

      // Emit ready event twice
      studentSocket!.emit('group:leader_ready', {
        sessionId,
        groupId,
        ready: true
      });

      await new Promise(resolve => setTimeout(resolve, 150));

      studentSocket!.emit('group:leader_ready', {
        sessionId,
        groupId,
        ready: true
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // First event should cause status change broadcast
      expect(teacherEvents).toHaveLength(1);
      
      // Both events should get confirmations (for UX consistency)
      expect(studentEvents).toHaveLength(2);
      
      // All confirmations should have idempotency keys
      expect(studentEvents[0]).toHaveProperty('idempotencyKey');
      expect(studentEvents[1]).toHaveProperty('idempotencyKey');
    });
  });

  describe('group:status_update Event', () => {
    it('should handle group status update with issue status', async () => {
      const teacherEvents: any[] = [];
      const groupEvents: any[] = [];

      teacherSocket!.on('group:status_changed', (data) => {
        teacherEvents.push(data);
      });

      studentSocket!.on('group:status_update', (data) => {
        groupEvents.push(data);
      });

      // Update group status to issue
      studentSocket!.emit('group:status_update', {
        groupId,
        sessionId,
        status: 'issue',
        issueReason: 'permission_revoked'
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify broadcasts
      expect(teacherEvents).toHaveLength(1);
      expect(teacherEvents[0]).toMatchObject({
        groupId,
        status: 'issue',
        isReady: false,
        issueReason: 'permission_revoked'
      });

      expect(groupEvents).toHaveLength(1);
      expect(groupEvents[0]).toMatchObject({
        groupId,
        status: 'issue',
        isReady: false,
        issueReason: 'permission_revoked'
      });
    });

    it('should validate status values and reject invalid ones', async () => {
      const errorEvents: any[] = [];
      studentSocket!.on('error', (data) => {
        errorEvents.push(data);
      });

      // Try invalid status
      studentSocket!.emit('group:status_update', {
        groupId,
        sessionId,
        status: 'invalid_status'
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0]).toMatchObject({
        code: 'INVALID_STATUS'
      });
    });
  });

  describe('wavelistener:issue Event', () => {
    it('should handle wavelistener issue reporting', async () => {
      const teacherEvents: any[] = [];
      const issueEvents: any[] = [];
      const ackEvents: any[] = [];

      teacherSocket!.on('group:status_changed', (data) => {
        teacherEvents.push(data);
      });

      studentSocket!.on('wavelistener:issue_reported', (data) => {
        issueEvents.push(data);
      });

      studentSocket!.on('wavelistener:issue_acknowledged', (data) => {
        ackEvents.push(data);
      });

      // Report wavelistener issue
      studentSocket!.emit('wavelistener:issue', {
        sessionId,
        groupId,
        reason: 'stream_failed'
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify all expected events fired
      expect(teacherEvents).toHaveLength(1);
      expect(teacherEvents[0]).toMatchObject({
        status: 'issue',
        issueReason: 'stream_failed'
      });

      expect(issueEvents).toHaveLength(1);
      expect(issueEvents[0]).toMatchObject({
        groupId,
        reason: 'stream_failed'
      });

      expect(ackEvents).toHaveLength(1);
      expect(ackEvents[0]).toMatchObject({
        groupId,
        reason: 'stream_failed'
      });
    });
  });

  describe('Event Integration Workflow', () => {
    it('should handle complete ready→issue workflow correctly', async () => {
      const allEvents: Array<{type: string, data: any, timestamp: number}> = [];

      // Capture all relevant events with timestamps
      teacherSocket!.on('group:status_changed', (data) => {
        allEvents.push({ type: 'teacher:status_changed', data, timestamp: Date.now() });
      });

      studentSocket!.on('group:leader_ready_confirmed', (data) => {
        allEvents.push({ type: 'student:ready_confirmed', data, timestamp: Date.now() });
      });

      studentSocket!.on('wavelistener:issue_acknowledged', (data) => {
        allEvents.push({ type: 'student:issue_acked', data, timestamp: Date.now() });
      });

      // 1. Mark group as ready
      studentSocket!.emit('group:leader_ready', {
        sessionId,
        groupId,
        ready: true
      });

      await new Promise(resolve => setTimeout(resolve, 100));

      // 2. Report an issue
      studentSocket!.emit('wavelistener:issue', {
        sessionId,
        groupId,
        reason: 'permission_revoked'
      });

      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify event sequence
      expect(allEvents.length).toBeGreaterThanOrEqual(3);
      
      // Check that we got the expected event types
      const eventTypes = allEvents.map(e => e.type);
      expect(eventTypes).toContain('teacher:status_changed');
      expect(eventTypes).toContain('student:ready_confirmed');
      expect(eventTypes).toContain('student:issue_acked');
      
      // Verify ready sequence came before issue sequence
      const readyIndex = allEvents.findIndex(e => e.type === 'student:ready_confirmed');
      const issueIndex = allEvents.findIndex(e => e.type === 'student:issue_acked');
      expect(readyIndex).toBeLessThan(issueIndex);
    });
  });
});
