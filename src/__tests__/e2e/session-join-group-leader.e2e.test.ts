/**
 * Session Join with Group Leader Email Matching E2E Test
 * 
 * Tests the complete email-based group leader session join flow:
 * 1. Teacher creates session with pre-configured groups and leaders
 * 2. Group leader clicks email invitation link
 * 3. Email auto-population and roster lookup
 * 4. Automatic group assignment based on email matching
 * 5. Participant tracking in correct tables
 */

import { Server } from 'http';
import request from 'supertest';
import { createTestApp } from '../test-utils/app-setup';
import { databricksService } from '../../services/databricks.service';
import { cleanupTestData } from '../test-utils/factories';

describe('Session Join with Group Leader Email Matching E2E', () => {
  let app: any;
  let server: Server;
  let port: number;
  let testSession: any;
  let testGroups: any[];
  let testStudents: any[];
  let authToken: string;

  beforeAll(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    server = testSetup.server;
    port = testSetup.port;

    console.log(`E2E test server running on port ${port}`);
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
  });

  beforeEach(async () => {
    // Create test data with realistic group leader setup
    const sessionId = `test_session_${Date.now()}`;
    const groupAId = `group_a_${sessionId}`;
    const groupBId = `group_b_${sessionId}`;
    
    // Create test students (group leaders) in roster
    testStudents = [
      {
        id: 'leader_alice_123',
        display_name: 'Alice Johnson',
        email: 'alice.johnson@testschool.edu',
        school_id: 'test_school_1',
        status: 'active',
        has_parental_consent: true,
        data_sharing_consent: true,
        audio_recording_consent: true,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: 'leader_bob_456',
        display_name: 'Bob Smith',
        email: 'bob.smith@testschool.edu',
        school_id: 'test_school_1',
        status: 'active',
        has_parental_consent: true,
        data_sharing_consent: true,
        audio_recording_consent: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    ];

    // Insert test students into database
    for (const student of testStudents) {
      await databricksService.insert('students', student);
    }

    // Create test session
    testSession = {
      id: sessionId,
      title: 'Test Session for Group Leader Join',
      status: 'active',
      access_code: 'TEST123',
      teacher_id: 'test_teacher_1',
      school_id: 'test_school_1',
      max_students: 20,
      target_group_size: 4,
      auto_group_enabled: false,
      recording_enabled: true,
      transcription_enabled: true,
      ai_analysis_enabled: true,
      ferpa_compliant: true,
      coppa_compliant: true,
      recording_consent_obtained: true,
      total_groups: 2,
      total_students: 0,
      participation_rate: 0.0,
      engagement_score: 0.0,
      planned_duration_minutes: 30,
      created_at: new Date(),
      updated_at: new Date()
    };

    await databricksService.insert('classroom_sessions', testSession);

    // Create test groups with leader assignments
    testGroups = [
      {
        id: groupAId,
        session_id: sessionId,
        name: 'Team Alpha',
        group_number: 1,
        status: 'created',
        max_size: 4,
        current_size: 1,
        auto_managed: false,
        leader_id: 'leader_alice_123', // Alice is leader of Team Alpha
        is_ready: false,
        sentiment_arc: '[]',
        total_speaking_time_seconds: 0,
        collaboration_score: 0.0,
        topic_focus_score: 0.0,
        created_at: new Date(),
        updated_at: new Date()
      },
      {
        id: groupBId,
        session_id: sessionId,
        name: 'Team Beta',
        group_number: 2,
        status: 'created',
        max_size: 4,
        current_size: 1,
        auto_managed: false,
        leader_id: 'leader_bob_456', // Bob is leader of Team Beta
        is_ready: false,
        sentiment_arc: '[]',
        total_speaking_time_seconds: 0,
        collaboration_score: 0.0,
        topic_focus_score: 0.0,
        created_at: new Date(),
        updated_at: new Date()
      }
    ];

    for (const group of testGroups) {
      await databricksService.insert('student_groups', group);
    }

    // Create group membership records
    await databricksService.insert('student_group_members', {
      id: `member_alice_${groupAId}`,
      session_id: sessionId,
      group_id: groupAId,
      student_id: 'leader_alice_123',
      created_at: new Date()
    });

    await databricksService.insert('student_group_members', {
      id: `member_bob_${groupBId}`,
      session_id: sessionId,
      group_id: groupBId,
      student_id: 'leader_bob_456',
      created_at: new Date()
    });

    authToken = 'test-auth-token';
  });

  afterEach(async () => {
    // Cleanup test data
    try {
      await cleanupTestData([testSession.id]);
      for (const student of testStudents) {
        await databricksService.query('DELETE FROM classwaves.users.students WHERE id = ?', [student.id]);
      }
      for (const group of testGroups) {
        await databricksService.query('DELETE FROM classwaves.sessions.student_groups WHERE id = ?', [group.id]);
        await databricksService.query('DELETE FROM classwaves.sessions.student_group_members WHERE group_id = ?', [group.id]);
      }
    } catch (error) {
      console.warn('Cleanup error:', error);
    }
  });

  describe('Email-Based Group Leader Session Join', () => {
    it('should successfully match group leader by email and assign to correct group', async () => {
      const joinData = {
        sessionCode: testSession.access_code,
        studentName: 'Alice Johnson',
        email: 'alice.johnson@testschool.edu', // Email matches roster
        gradeLevel: '5',
        dateOfBirth: '2012-01-15'
      };

      const response = await request(app)
        .post(`/api/v1/sessions/${testSession.id}/join`)
        .send(joinData)
        .expect(200);

      // Verify response structure
      expect(response.body).toMatchObject({
        token: expect.stringMatching(/^student_/),
        student: {
          id: 'leader_alice_123', // Should use roster ID
          displayName: 'Alice Johnson',
          email: 'alice.johnson@testschool.edu',
          isGroupLeader: true,
          isFromRoster: true,
          rosterId: 'leader_alice_123'
        },
        session: {
          id: testSession.id
        },
        group: {
          id: testGroups[0].id, // Team Alpha
          name: 'Team Alpha',
          leaderId: 'leader_alice_123'
        }
      });

      // Verify participant was inserted into sessions.participants table
      const participant = await databricksService.queryOne(
        'SELECT * FROM classwaves.sessions.participants WHERE session_id = ? AND student_id = ?',
        [testSession.id, 'leader_alice_123']
      );

      expect(participant).toMatchObject({
        session_id: testSession.id,
        group_id: testGroups[0].id,
        student_id: 'leader_alice_123',
        anonymous_id: null, // Should be null since found in roster
        display_name: 'Alice Johnson',
        is_active: true,
        can_speak: true,
        can_hear: true,
        is_muted: false
      });
    });

    it('should match second group leader by email to different group', async () => {
      const joinData = {
        sessionCode: testSession.access_code,
        studentName: 'Bob Smith',
        email: 'bob.smith@testschool.edu', // Different email
        gradeLevel: '6',
        dateOfBirth: '2011-05-20'
      };

      const response = await request(app)
        .post(`/api/v1/sessions/${testSession.id}/join`)
        .send(joinData)
        .expect(200);

      // Verify assigned to Team Beta
      expect(response.body.group).toMatchObject({
        id: testGroups[1].id, // Team Beta
        name: 'Team Beta',
        leaderId: 'leader_bob_456'
      });

      expect(response.body.student).toMatchObject({
        id: 'leader_bob_456',
        email: 'bob.smith@testschool.edu',
        isGroupLeader: true
      });
    });

    it('should handle student not found as group leader gracefully', async () => {
      const joinData = {
        sessionCode: testSession.access_code,
        studentName: 'Charlie Unknown',
        email: 'charlie.unknown@testschool.edu', // Not a group leader
        gradeLevel: '4',
        dateOfBirth: '2013-08-10'
      };

      const response = await request(app)
        .post(`/api/v1/sessions/${testSession.id}/join`)
        .send(joinData)
        .expect(200);

      // Should still allow join but without group assignment
      expect(response.body.group).toBeNull();
      expect(response.body.student.isGroupLeader).toBe(false);
      expect(response.body.student.isFromRoster).toBe(false);
    });

    it('should fallback to name matching if email not provided', async () => {
      const joinData = {
        sessionCode: testSession.access_code,
        studentName: 'Alice Johnson', // Matches display_name in roster
        // email: undefined - testing fallback
        gradeLevel: '5',
        dateOfBirth: '2012-01-15'
      };

      const response = await request(app)
        .post(`/api/v1/sessions/${testSession.id}/join`)
        .send(joinData)
        .expect(200);

      // Should still find Alice by name
      expect(response.body.student.id).toBe('leader_alice_123');
      expect(response.body.group.name).toBe('Team Alpha');
    });

    it('should reject invalid session codes', async () => {
      const joinData = {
        sessionCode: 'INVALID',
        studentName: 'Alice Johnson',
        email: 'alice.johnson@testschool.edu'
      };

      await request(app)
        .post(`/api/v1/sessions/${testSession.id}/join`)
        .send(joinData)
        .expect(404);
    });
  });

  describe('Database Schema Validation', () => {
    it('should verify sessions.participants table has all required columns', async () => {
      const columns = await databricksService.query(
        'DESCRIBE classwaves.sessions.participants'
      );
      
      const columnNames = columns.map((col: any) => col.col_name);
      
      expect(columnNames).toEqual(expect.arrayContaining([
        'id', 'session_id', 'group_id', 'student_id', 'anonymous_id',
        'display_name', 'join_time', 'leave_time', 'is_active',
        'device_type', 'browser_info', 'connection_quality',
        'can_speak', 'can_hear', 'is_muted',
        'total_speaking_time_seconds', 'message_count', 'interaction_count',
        'created_at', 'updated_at'
      ]));
    });

    it('should verify sessions.student_groups table has leader_id column', async () => {
      const columns = await databricksService.query(
        'DESCRIBE classwaves.sessions.student_groups'
      );
      
      const columnNames = columns.map((col: any) => col.col_name);
      
      expect(columnNames).toContain('leader_id');
      expect(columnNames).toContain('is_ready');
      expect(columnNames).toContain('sentiment_arc');
    });
  });
});
