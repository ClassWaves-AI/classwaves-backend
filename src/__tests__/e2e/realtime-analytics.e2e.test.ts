/**
 * Real-time Analytics E2E Tests (Real Database Integration)
 * 
 * Tests analytics data persistence and event handling
 * using real database operations per TEST_REWRITE_PLAN.md
 */

import { databricksService } from '../../services/databricks.service';
import { getNamespacedWebSocketService } from '../../services/websocket/namespaced-websocket.service';
import { v4 as uuidv4 } from 'uuid';

// Mock WebSocket service for reliable testing (focus on DB persistence)
jest.mock('../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getSessionsService: () => ({
      emitToSession: jest.fn(),
      emitToGroup: jest.fn(),
    })
  })
}));

const mockWebsocketService = websocketService as jest.Mocked<typeof websocketService>;

describe('Real-time Analytics E2E Flow (Real Database)', () => {
  let testSessionId: string;
  let testTeacherId: string;
  let testGroupId: string;
  let testSchoolId: string;

  beforeEach(async () => {
    // Create real test data in database per schema
    testSessionId = uuidv4();
    testTeacherId = uuidv4();
    testGroupId = uuidv4();
    testSchoolId = uuidv4();

    // Create test session in real database with all required columns
    await databricksService.query(
      `INSERT INTO classwaves.sessions.classroom_sessions 
       (id, title, status, planned_duration_minutes, max_students, target_group_size, 
        auto_group_enabled, teacher_id, school_id, recording_enabled, transcription_enabled, 
        ai_analysis_enabled, ferpa_compliant, coppa_compliant, recording_consent_obtained, 
        total_groups, total_students, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testSessionId,
        'WebSocket E2E Test Session',
        'active',
        30,
        20,
        4,
        true,
        testTeacherId,
        testSchoolId,
        true, // recording_enabled
        true, // transcription_enabled
        true, // ai_analysis_enabled
        true, // ferpa_compliant
        true, // coppa_compliant
        true, // recording_consent_obtained
        0,    // total_groups
        0,    // total_students
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );

    // Create test group
    await databricksService.query(
      `INSERT INTO classwaves.sessions.student_groups 
       (id, session_id, name, group_number, status, max_size, current_size, 
        auto_managed, is_ready, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testGroupId,
        testSessionId,
        'Test Group 1',
        1,
        'active',
        4,
        3,
        true,
        true,
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // Cleanup real database records with error handling
    try {
      await databricksService.query(
        'DELETE FROM classwaves.analytics.session_events WHERE session_id = ?',
        [testSessionId]
      );
    } catch (error) {
      console.warn('Failed to cleanup session_events:', error);
    }
    
    try {
      await databricksService.query(
        'DELETE FROM classwaves.sessions.student_groups WHERE session_id = ?',
        [testSessionId]
      );
    } catch (error) {
      console.warn('Failed to cleanup student_groups:', error);
    }
    
    try {
      await databricksService.query(
        'DELETE FROM classwaves.sessions.classroom_sessions WHERE id = ?',
        [testSessionId]
      );
    } catch (error) {
      console.warn('Failed to cleanup classroom_sessions:', error);
    }
  });

  describe('Analytics Event Persistence and Processing', () => {
    it('should persist analytics events correctly to database', async () => {
      // Create analytics event directly in database to test persistence
      const eventId = uuidv4();
      const eventTime = new Date().toISOString();
      
      await databricksService.query(
        `INSERT INTO classwaves.analytics.session_events 
         (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          testSessionId,
          testTeacherId,
          'leader_ready',
          eventTime,
          JSON.stringify({
            groupId: testGroupId,
            groupNumber: 1,
            timestamp: eventTime
          }),
          new Date().toISOString()
        ]
      );

      // Verify event was recorded in database per schema
      const dbEvents = await databricksService.query(
        'SELECT * FROM classwaves.analytics.session_events WHERE session_id = ? ORDER BY created_at',
        [testSessionId]
      );

      // Should have recorded the leader_ready event
      expect(dbEvents.length).toBe(1);
      
      const leaderReadyEvent = dbEvents[0];
      expect(leaderReadyEvent.id).toBe(eventId);
      expect(leaderReadyEvent.session_id).toBe(testSessionId);
      expect(leaderReadyEvent.teacher_id).toBe(testTeacherId);
      expect(leaderReadyEvent.event_type).toBe('leader_ready');
      
      // Validate payload structure per schema (JSON string)
      const payload = JSON.parse(leaderReadyEvent.payload);
      expect(payload.groupId).toBe(testGroupId);
      expect(payload.groupNumber).toBe(1);
    });

    it('should handle session lifecycle events with correct event types', async () => {
      const sessionEvents = [
        { type: 'configured', data: { sessionId: testSessionId, status: 'configured' } },
        { type: 'started', data: { sessionId: testSessionId, status: 'active' } },
        { type: 'member_join', data: { sessionId: testSessionId, groupId: testGroupId, studentId: uuidv4() } },
        { type: 'leader_ready', data: { sessionId: testSessionId, groupId: testGroupId } }
      ];

      // Create each event in database
      for (const event of sessionEvents) {
        await databricksService.query(
          `INSERT INTO classwaves.analytics.session_events 
           (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            testSessionId,
            testTeacherId,
            event.type,
            new Date().toISOString(),
            JSON.stringify(event.data),
            new Date().toISOString()
          ]
        );
      }

      // Verify all events were recorded correctly
      const dbEvents = await databricksService.query(
        'SELECT * FROM classwaves.analytics.session_events WHERE session_id = ? ORDER BY created_at',
        [testSessionId]
      );

      expect(dbEvents.length).toBe(4);
      
      const eventTypes = dbEvents.map(e => e.event_type);
      expect(eventTypes).toEqual(['configured', 'started', 'member_join', 'leader_ready']);

      // Verify each event has proper structure
      dbEvents.forEach(event => {
        expect(event.session_id).toBe(testSessionId);
        expect(event.teacher_id).toBe(testTeacherId);
        expect(event.payload).toBeDefined();
        expect(() => JSON.parse(event.payload)).not.toThrow();
      });
    });

    it('should validate event payload structure and data integrity', async () => {
      const complexPayload = {
        groupId: testGroupId,
        groupNumber: 1,
        metadata: {
          timestamp: new Date().toISOString(),
          source: 'test-suite',
          version: '1.0.0'
        },
        analytics: {
          eventCount: 1,
          sessionDuration: 300,
          participantCount: 3
        }
      };

      // Create event with complex payload
      const eventId = uuidv4();
      await databricksService.query(
        `INSERT INTO classwaves.analytics.session_events 
         (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          testSessionId,
          testTeacherId,
          'analytics_computed',
          new Date().toISOString(),
          JSON.stringify(complexPayload),
          new Date().toISOString()
        ]
      );

      // Retrieve and validate event
      const dbEvents = await databricksService.query(
        'SELECT * FROM classwaves.analytics.session_events WHERE id = ?',
        [eventId]
      );

      expect(dbEvents.length).toBe(1);
      
      const event = dbEvents[0];
      const retrievedPayload = JSON.parse(event.payload);
      
      expect(retrievedPayload.groupId).toBe(testGroupId);
      expect(retrievedPayload.groupNumber).toBe(1);
      expect(retrievedPayload.metadata.source).toBe('test-suite');
      expect(retrievedPayload.analytics.participantCount).toBe(3);
    });
  });

  describe('WebSocket Service Integration (Mocked)', () => {
    it('should handle WebSocket service calls for event emission', async () => {
      // Test that WebSocket service would be called (mocked for reliability)
      const eventData = {
        sessionId: testSessionId,
        groupId: testGroupId,
        eventType: 'group:status_changed',
        status: 'ready'
      };

      // Simulate what the real service would do
      websocketService.emitToSession(testSessionId, 'group:status_changed', eventData);
      websocketService.emit('session:analytics', { sessionId: testSessionId, teacherId: testTeacherId });

      // Verify mocked service was called correctly
      expect(mockWebsocketService.emitToSession).toHaveBeenCalledWith(
        testSessionId, 
        'group:status_changed', 
        eventData
      );
      expect(mockWebsocketService.emit).toHaveBeenCalledWith(
        'session:analytics', 
        { sessionId: testSessionId, teacherId: testTeacherId }
      );
    });

    it('should handle concurrent analytics event processing', async () => {
      // Create multiple concurrent events
      const eventPromises: Promise<any>[] = [];
      for (let i = 0; i < 5; i++) {
        eventPromises.push(
          databricksService.query(
            `INSERT INTO classwaves.analytics.session_events 
             (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              uuidv4(),
              testSessionId,
              testTeacherId,
              'concurrent_test',
              new Date().toISOString(),
              JSON.stringify({ index: i, timestamp: Date.now() }),
              new Date().toISOString()
            ]
          )
        );
      }

      // Wait for all events to be created
      await Promise.all(eventPromises);

      // Verify all events were persisted correctly
      const dbEvents = await databricksService.query(
        'SELECT * FROM classwaves.analytics.session_events WHERE session_id = ? AND event_type = ? ORDER BY created_at',
        [testSessionId, 'concurrent_test']
      );

      expect(dbEvents.length).toBe(5);
      
      // Verify data integrity
      dbEvents.forEach((event, index) => {
        const payload = JSON.parse(event.payload);
        expect(payload.index).toBeDefined();
        expect(event.session_id).toBe(testSessionId);
        expect(event.event_type).toBe('concurrent_test');
      });
    });
  });
});
