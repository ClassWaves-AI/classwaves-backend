import request from 'supertest';
import express from 'express';
import { authenticate } from '../../../middleware/auth.middleware';
import { errorHandler } from '../../../middleware/error.middleware';
import { mockDatabricksService } from '../../mocks/databricks.mock';
import { mockRedisService } from '../../mocks/redis.mock';
import { testData } from '../../fixtures/test-data';
import { generateAccessToken } from '../../../utils/jwt.utils';

// Mock dependencies
jest.mock('../../../services/databricks.service', () => ({
  databricksService: mockDatabricksService,
}));

jest.mock('../../../services/redis.service', () => ({
  redisService: mockRedisService,
}));

jest.mock('../../../middleware/auth.middleware');

describe('Student Routes Integration Tests', () => {
  let app: express.Application;
  let authToken: string;
  const teacher = testData.teachers.active;
  const school = testData.schools.active;
  const activeSession = testData.sessions.active;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Express app
    app = express();
    app.use(express.json());
    
    // Mock authentication middleware for protected routes
    (authenticate as jest.Mock).mockImplementation((req, res, next) => {
      if (req.headers.authorization) {
        req.user = teacher;
        req.school = school;
        req.sessionId = 'auth-session-id';
        next();
      } else {
        res.status(401).json({ error: 'Unauthorized' });
      }
    });
    
    // Mount routes
    // app.use('/api/students', studentRoutes); // Removed with participant model
    app.use(errorHandler);
    
    // Generate auth token for tests
    authToken = generateAccessToken(teacher, school, 'auth-session-id');
    
    // Reset mocks
    mockDatabricksService.getSessionByCode.mockResolvedValue(activeSession);
    mockDatabricksService.getSessionById.mockResolvedValue(activeSession);
    mockDatabricksService.addStudentToSession.mockResolvedValue(testData.students.active[0]);
    mockDatabricksService.getSessionStudents.mockResolvedValue([]);
    mockRedisService.isConnected.mockReturnValue(true);
  });

  describe('POST /api/students/join', () => {
    const validJoinData = testData.requests.joinSession;

    it('should allow student to join active session', async () => {
      const newStudent = {
        id: 'student-new-123',
        display_name: validJoinData.displayName,
        session_id: activeSession.id,
        avatar: validJoinData.avatar,
        status: 'active',
        joined_at: new Date(),
      };
      mockDatabricksService.addStudentToSession.mockResolvedValue(newStudent);

      const response = await request(app)
        .post('/api/students/join')
        .send(validJoinData)
        .expect(200);

      expect(response.body).toEqual({
        student: newStudent,
        session: expect.objectContaining({
          id: activeSession.id,
          name: activeSession.name,
        }),
      });
      expect(mockDatabricksService.getSessionByCode).toHaveBeenCalledWith(validJoinData.sessionCode);
      expect(mockDatabricksService.addStudentToSession).toHaveBeenCalledWith({
        sessionId: activeSession.id,
        displayName: validJoinData.displayName,
        avatar: validJoinData.avatar,
      });
    });

    it('should validate required fields', async () => {
      const invalidData = {
        // Missing sessionCode
        displayName: 'Student',
        avatar: 'avatar1',
      };

      await request(app)
        .post('/api/students/join')
        .send(invalidData)
        .expect(400);
    });

    it('should validate session code format', async () => {
      const invalidData = {
        sessionCode: '123', // Too short
        displayName: 'Student',
        avatar: 'avatar1',
      };

      const response = await request(app)
        .post('/api/students/join')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toBe('Validation error');
    });

    it('should reject invalid session codes', async () => {
      mockDatabricksService.getSessionByCode.mockResolvedValue(null);

      await request(app)
        .post('/api/students/join')
        .send(validJoinData)
        .expect(404);
    });

    it('should prevent joining ended sessions', async () => {
      mockDatabricksService.getSessionByCode.mockResolvedValue(testData.sessions.ended);

      await request(app)
        .post('/api/students/join')
        .send(validJoinData)
        .expect(400);
    });

    it('should prevent joining full sessions', async () => {
      const fullSession = {
        ...activeSession,
        max_students: 2,
        current_students: 2,
      };
      mockDatabricksService.getSessionByCode.mockResolvedValue(fullSession);

      await request(app)
        .post('/api/students/join')
        .send(validJoinData)
        .expect(400);
    });

    it('should prevent duplicate display names', async () => {
      mockDatabricksService.getSessionStudents.mockResolvedValue([
        { ...testData.students.active[0], display_name: validJoinData.displayName },
      ]);

      await request(app)
        .post('/api/students/join')
        .send(validJoinData)
        .expect(400);
    });

    it('should store student session in Redis', async () => {
      const newStudent = {
        id: 'student-new-123',
        display_name: validJoinData.displayName,
        session_id: activeSession.id,
        avatar: validJoinData.avatar,
      };
      mockDatabricksService.addStudentToSession.mockResolvedValue(newStudent);

      await request(app)
        .post('/api/students/join')
        .send(validJoinData)
        .expect(200);

      // Verify Redis storage would be called
      // This would be implemented in the controller
    });

    it('should respect COPPA by not collecting PII', async () => {
      const response = await request(app)
        .post('/api/students/join')
        .send(validJoinData)
        .expect(200);

      // Verify no PII is collected or returned
      expect(response.body.student).not.toHaveProperty('email');
      expect(response.body.student).not.toHaveProperty('real_name');
      expect(response.body.student).not.toHaveProperty('birth_date');
      expect(response.body.student).toHaveProperty('display_name');
    });
  });

  describe('GET /api/students/sessions/:sessionId/participants', () => {
    it('should list all participants in session', async () => {
      const students = testData.students.active;
      const groups = testData.groups.active;
      
      mockDatabricksService.getSessionStudents.mockResolvedValue(students);
      mockDatabricksService.getSessionGroups.mockResolvedValue(groups);

      const response = await request(app)
        .get(`/api/students/sessions/${activeSession.id}/participants`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({
        participants: expect.arrayContaining([
          expect.objectContaining({
            id: students[0].id,
            display_name: students[0].display_name,
            avatar: students[0].avatar,
            status: students[0].status,
            group: expect.objectContaining({
              id: groups[0].id,
              name: groups[0].name,
            }),
          }),
        ]),
        count: students.length,
        groups: groups,
      });
    });

    it('should filter by status', async () => {
      const allStudents = [
        ...testData.students.active,
        { ...testData.students.active[0], id: 'inactive-1', status: 'inactive' },
      ];
      mockDatabricksService.getSessionStudents.mockResolvedValue(allStudents);

      const response = await request(app)
        .get(`/api/students/sessions/${activeSession.id}/participants?status=active`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.participants).toHaveLength(testData.students.active.length);
      expect(response.body.participants.every((p: any) => p.status === 'active')).toBe(true);
    });

    it('should filter by group', async () => {
      const groupId = testData.groups.active[0].id;
      const studentsInGroup = testData.students.active.map(s => ({
        ...s,
        group_id: groupId,
      }));
      mockDatabricksService.getSessionStudents.mockResolvedValue(studentsInGroup);

      const response = await request(app)
        .get(`/api/students/sessions/${activeSession.id}/participants?groupId=${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.participants.every((p: any) => p.group?.id === groupId)).toBe(true);
    });

    it('should require authentication', async () => {
      await request(app)
        .get(`/api/students/sessions/${activeSession.id}/participants`)
        .expect(401);
    });

    it('should verify teacher owns session', async () => {
      const otherTeacherSession = {
        ...activeSession,
        teacher_id: 'other-teacher-id',
      };
      mockDatabricksService.getSessionById.mockResolvedValue(otherTeacherSession);

      await request(app)
        .get(`/api/students/sessions/${activeSession.id}/participants`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });
  });

  describe('POST /api/students/sessions/:sessionId/participants/:participantId/leave', () => {
    const studentId = testData.students.active[0].id;

    it('should remove student from session', async () => {
      mockDatabricksService.getSessionStudents.mockResolvedValue(testData.students.active);
      mockDatabricksService.removeStudentFromSession.mockResolvedValue(true);
      mockDatabricksService.updateSessionStatus.mockResolvedValue(true);

      await request(app)
        .post(`/api/students/sessions/${activeSession.id}/participants/${studentId}/leave`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockDatabricksService.removeStudentFromSession).toHaveBeenCalledWith(
        activeSession.id,
        studentId
      );
    });

    it('should remove student from their group', async () => {
      const studentWithGroup = {
        ...testData.students.active[0],
        group_id: testData.groups.active[0].id,
      };
      mockDatabricksService.getSessionStudents.mockResolvedValue([studentWithGroup]);
      mockDatabricksService.removeStudentFromGroup.mockResolvedValue(true);
      mockDatabricksService.removeStudentFromSession.mockResolvedValue(true);

      await request(app)
        .post(`/api/students/sessions/${activeSession.id}/participants/${studentId}/leave`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockDatabricksService.removeStudentFromGroup).toHaveBeenCalledWith(
        studentWithGroup.group_id,
        studentId
      );
    });

    it('should clean up Redis session data', async () => {
      mockDatabricksService.getSessionStudents.mockResolvedValue(testData.students.active);
      mockDatabricksService.removeStudentFromSession.mockResolvedValue(true);

      await request(app)
        .post(`/api/students/sessions/${activeSession.id}/participants/${studentId}/leave`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify Redis cleanup would be called
      // This would be implemented in the controller
    });

    it('should verify student exists in session', async () => {
      mockDatabricksService.getSessionStudents.mockResolvedValue([]);

      await request(app)
        .post(`/api/students/sessions/${activeSession.id}/participants/non-existent-id/leave`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should log removal for FERPA compliance', async () => {
      mockDatabricksService.getSessionStudents.mockResolvedValue(testData.students.active);
      mockDatabricksService.removeStudentFromSession.mockResolvedValue(true);
      mockDatabricksService.logAuditEvent.mockResolvedValue(true);

      await request(app)
        .post(`/api/students/sessions/${activeSession.id}/participants/${studentId}/leave`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockDatabricksService.logAuditEvent).toHaveBeenCalledWith({
        event_type: 'student_removed',
        user_id: teacher.id,
        resource_id: studentId,
        resource_type: 'student',
        action: 'remove',
        session_id: activeSession.id,
        ip_address: expect.any(String),
        user_agent: expect.any(String),
      });
    });
  });

  describe('PUT /api/students/sessions/:sessionId/participants/:participantId/group', () => {
    const studentId = testData.students.active[0].id;
    const groupId = testData.groups.active[1].id;

    it('should move student to new group', async () => {
      const student = {
        ...testData.students.active[0],
        group_id: testData.groups.active[0].id,
      };
      const targetGroup = {
        ...testData.groups.active[1],
        current_size: 1,
      };
      
      mockDatabricksService.getSessionStudents.mockResolvedValue([student]);
      mockDatabricksService.getSessionGroups.mockResolvedValue(testData.groups.active);
      mockDatabricksService.removeStudentFromGroup.mockResolvedValue(true);
      mockDatabricksService.addStudentToGroup.mockResolvedValue(true);

      const response = await request(app)
        .put(`/api/students/sessions/${activeSession.id}/participants/${studentId}/group`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ groupId })
        .expect(200);

      expect(response.body.message).toBe('Student group updated successfully');
      expect(mockDatabricksService.removeStudentFromGroup).toHaveBeenCalledWith(
        student.group_id,
        studentId
      );
      expect(mockDatabricksService.addStudentToGroup).toHaveBeenCalledWith(
        groupId,
        studentId
      );
    });

    it('should allow moving ungrouped student to group', async () => {
      const ungroupedStudent = {
        ...testData.students.active[0],
        group_id: null,
      };
      
      mockDatabricksService.getSessionStudents.mockResolvedValue([ungroupedStudent]);
      mockDatabricksService.getSessionGroups.mockResolvedValue(testData.groups.active);
      mockDatabricksService.addStudentToGroup.mockResolvedValue(true);

      await request(app)
        .put(`/api/students/sessions/${activeSession.id}/participants/${studentId}/group`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ groupId })
        .expect(200);

      expect(mockDatabricksService.removeStudentFromGroup).not.toHaveBeenCalled();
      expect(mockDatabricksService.addStudentToGroup).toHaveBeenCalled();
    });

    it('should prevent moving to full group', async () => {
      const fullGroup = {
        ...testData.groups.active[1],
        current_size: testData.groups.active[1].max_size,
      };
      
      mockDatabricksService.getSessionStudents.mockResolvedValue(testData.students.active);
      mockDatabricksService.getSessionGroups.mockResolvedValue([
        testData.groups.active[0],
        fullGroup,
      ]);

      await request(app)
        .put(`/api/students/sessions/${activeSession.id}/participants/${studentId}/group`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ groupId: fullGroup.id })
        .expect(400);
    });

    it('should verify group exists in session', async () => {
      mockDatabricksService.getSessionStudents.mockResolvedValue(testData.students.active);
      mockDatabricksService.getSessionGroups.mockResolvedValue(testData.groups.active);

      await request(app)
        .put(`/api/students/sessions/${activeSession.id}/participants/${studentId}/group`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ groupId: 'non-existent-group' })
        .expect(404);
    });

    it('should allow removing student from group', async () => {
      const groupedStudent = {
        ...testData.students.active[0],
        group_id: testData.groups.active[0].id,
      };
      
      mockDatabricksService.getSessionStudents.mockResolvedValue([groupedStudent]);
      mockDatabricksService.removeStudentFromGroup.mockResolvedValue(true);

      await request(app)
        .put(`/api/students/sessions/${activeSession.id}/participants/${studentId}/group`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ groupId: null })
        .expect(200);

      expect(mockDatabricksService.removeStudentFromGroup).toHaveBeenCalledWith(
        groupedStudent.group_id,
        studentId
      );
      expect(mockDatabricksService.addStudentToGroup).not.toHaveBeenCalled();
    });
  });

  describe('COPPA Compliance', () => {
    it('should never expose student PII in any endpoint', async () => {
      const studentsWithPII = testData.students.active.map(student => ({
        ...student,
        email: 'should-not-expose@example.com',
        real_name: 'Real Name',
        birth_date: '2010-01-01',
        ip_address: '192.168.1.1',
        location: 'Should Not Expose',
      }));
      
      mockDatabricksService.getSessionStudents.mockResolvedValue(studentsWithPII);

      const response = await request(app)
        .get(`/api/students/sessions/${activeSession.id}/participants`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      response.body.participants.forEach((participant: any) => {
        expect(participant).not.toHaveProperty('email');
        expect(participant).not.toHaveProperty('real_name');
        expect(participant).not.toHaveProperty('birth_date');
        expect(participant).not.toHaveProperty('ip_address');
        expect(participant).not.toHaveProperty('location');
        expect(participant).toHaveProperty('display_name');
        expect(participant).toHaveProperty('avatar');
      });
    });

    it('should use display names only', async () => {
      const response = await request(app)
        .post('/api/students/join')
        .send(testData.requests.joinSession)
        .expect(200);

      expect(response.body.student.display_name).toBe(testData.requests.joinSession.displayName);
      expect(response.body.student).not.toHaveProperty('real_name');
    });
  });

  describe('Rate Limiting', () => {
    it('should rate limit join attempts from same IP', async () => {
      // This test would verify rate limiting is applied to prevent spam joins
      // Implementation depends on rate limiting middleware setup
    });
  });
});