import request from 'supertest';
import express from 'express';
import sessionRoutes from '../../../routes/session.routes';
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

describe('Group Routes Integration Tests', () => {
  let app: express.Application;
  let authToken: string;
  const teacher = testData.teachers.active;
  const school = testData.schools.active;
  const sessionId = testData.sessions.active.id;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Express app
    app = express();
    app.use(express.json());
    
    // Mock authentication middleware
    (authenticate as jest.Mock).mockImplementation((req, res, next) => {
      req.user = teacher;
      req.school = school;
      req.sessionId = 'auth-session-id';
      next();
    });
    
    // Mount routes
    app.use('/api/sessions', sessionRoutes);
    app.use(errorHandler);
    
    // Generate auth token for tests
    authToken = generateAccessToken(teacher, school, 'auth-session-id');
    
    // Reset mocks
    mockDatabricksService.getSessionById.mockResolvedValue(testData.sessions.active);
    mockDatabricksService.getSessionGroups.mockResolvedValue([]);
    mockDatabricksService.createGroup.mockResolvedValue(testData.groups.active[0]);
    mockRedisService.isConnected.mockReturnValue(true);
  });

  describe('GET /api/sessions/:sessionId/groups', () => {
    it('should list all groups in a session', async () => {
      const groups = testData.groups.active;
      mockDatabricksService.getSessionGroups.mockResolvedValue(groups);
      mockDatabricksService.getSessionStudents.mockResolvedValue([
        { ...testData.students.active[0], group_id: groups[0].id },
        { ...testData.students.active[1], group_id: groups[0].id },
      ]);

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({
        groups: expect.arrayContaining([
          expect.objectContaining({
            id: groups[0].id,
            name: groups[0].name,
            students: expect.arrayContaining([
              expect.objectContaining({ id: testData.students.active[0].id }),
              expect.objectContaining({ id: testData.students.active[1].id }),
            ]),
          }),
        ]),
        count: groups.length,
      });
      expect(mockDatabricksService.getSessionGroups).toHaveBeenCalledWith(sessionId);
    });

    it('should handle empty groups list', async () => {
      mockDatabricksService.getSessionGroups.mockResolvedValue([]);

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body).toEqual({
        groups: [],
        count: 0,
      });
    });

    it('should verify teacher owns the session', async () => {
      const otherTeacherSession = {
        ...testData.sessions.active,
        teacher_id: 'other-teacher-id',
      };
      mockDatabricksService.getSessionById.mockResolvedValue(otherTeacherSession);

      await request(app)
        .get(`/api/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });

    it('should require active or paused session', async () => {
      mockDatabricksService.getSessionById.mockResolvedValue(testData.sessions.ended);

      await request(app)
        .get(`/api/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(400);
    });
  });

  describe('POST /api/sessions/:sessionId/groups', () => {
    const validGroupData = {
      name: 'Group A',
      maxSize: 4,
    };

    it('should create new group successfully', async () => {
      const newGroup = {
        id: 'group-new-123',
        session_id: sessionId,
        ...validGroupData,
        current_size: 0,
        created_at: new Date(),
      };
      mockDatabricksService.createGroup.mockResolvedValue(newGroup);

      const response = await request(app)
        .post(`/api/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(validGroupData)
        .expect(201);

      expect(response.body).toEqual({ group: newGroup });
      expect(mockDatabricksService.createGroup).toHaveBeenCalledWith({
        sessionId,
        ...validGroupData,
      });
    });

    it('should validate required fields', async () => {
      const invalidData = {
        // Missing name
        maxSize: 4,
      };

      await request(app)
        .post(`/api/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('should validate max size constraints', async () => {
      const invalidData = {
        name: 'Group A',
        maxSize: 0, // Should be at least 2
      };

      const response = await request(app)
        .post(`/api/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toBe('Validation error');
    });

    it('should prevent duplicate group names', async () => {
      mockDatabricksService.getSessionGroups.mockResolvedValue([
        { ...testData.groups.active[0], name: 'Group A' },
      ]);

      await request(app)
        .post(`/api/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(validGroupData)
        .expect(400);
    });

    it('should limit number of groups per session', async () => {
      // Create array of 10 groups (assuming limit)
      const existingGroups = Array.from({ length: 10 }, (_, i) => ({
        ...testData.groups.active[0],
        id: `group-${i}`,
        name: `Group ${i}`,
      }));
      mockDatabricksService.getSessionGroups.mockResolvedValue(existingGroups);

      await request(app)
        .post(`/api/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(validGroupData)
        .expect(400);
    });
  });

  describe('POST /api/sessions/:sessionId/groups/auto-generate', () => {
    const autoGenerateData = {
      numberOfGroups: 4,
      strategy: 'random', // or 'balanced'
    };

    it('should auto-generate groups successfully', async () => {
      const students = [
        ...testData.students.active,
        { id: 'student-3', display_name: 'Student Three', session_id: sessionId },
        { id: 'student-4', display_name: 'Student Four', session_id: sessionId },
      ];
      mockDatabricksService.getSessionStudents.mockResolvedValue(students);
      
      const generatedGroups = [
        { id: 'group-auto-1', name: 'Group 1', max_size: 2, current_size: 0 },
        { id: 'group-auto-2', name: 'Group 2', max_size: 2, current_size: 0 },
        { id: 'group-auto-3', name: 'Group 3', max_size: 2, current_size: 0 },
        { id: 'group-auto-4', name: 'Group 4', max_size: 2, current_size: 0 },
      ];
      
      mockDatabricksService.createGroup
        .mockResolvedValueOnce(generatedGroups[0])
        .mockResolvedValueOnce(generatedGroups[1])
        .mockResolvedValueOnce(generatedGroups[2])
        .mockResolvedValueOnce(generatedGroups[3]);
      
      mockDatabricksService.addStudentToGroup.mockResolvedValue(true);

      const response = await request(app)
        .post(`/api/sessions/${sessionId}/groups/auto-generate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(autoGenerateData)
        .expect(201);

      expect(response.body.groups).toHaveLength(4);
      expect(mockDatabricksService.createGroup).toHaveBeenCalledTimes(4);
      expect(mockDatabricksService.addStudentToGroup).toHaveBeenCalledTimes(4);
    });

    it('should require minimum students for auto-generation', async () => {
      mockDatabricksService.getSessionStudents.mockResolvedValue([
        testData.students.active[0], // Only 1 student
      ]);

      await request(app)
        .post(`/api/sessions/${sessionId}/groups/auto-generate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(autoGenerateData)
        .expect(400);
    });

    it('should clear existing groups before auto-generating', async () => {
      const existingGroups = testData.groups.active;
      mockDatabricksService.getSessionGroups.mockResolvedValue(existingGroups);
      mockDatabricksService.deleteGroup.mockResolvedValue(true);
      mockDatabricksService.getSessionStudents.mockResolvedValue([
        ...testData.students.active,
        { id: 'student-3', display_name: 'Student Three', session_id: sessionId },
        { id: 'student-4', display_name: 'Student Four', session_id: sessionId },
      ]);

      await request(app)
        .post(`/api/sessions/${sessionId}/groups/auto-generate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(autoGenerateData)
        .expect(201);

      expect(mockDatabricksService.deleteGroup).toHaveBeenCalledTimes(existingGroups.length);
    });

    it('should support balanced distribution strategy', async () => {
      const students = Array.from({ length: 10 }, (_, i) => ({
        id: `student-${i}`,
        display_name: `Student ${i}`,
        session_id: sessionId,
      }));
      mockDatabricksService.getSessionStudents.mockResolvedValue(students);

      const balancedData = {
        numberOfGroups: 3,
        strategy: 'balanced',
      };

      await request(app)
        .post(`/api/sessions/${sessionId}/groups/auto-generate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(balancedData)
        .expect(201);

      // Verify groups are created with balanced sizes (4, 3, 3 students)
      expect(mockDatabricksService.createGroup).toHaveBeenCalledTimes(3);
    });
  });

  describe('PUT /api/sessions/:sessionId/groups/:groupId', () => {
    const groupId = testData.groups.active[0].id;
    const updateData = {
      name: 'Updated Group Name',
      maxSize: 6,
    };

    it('should update group successfully', async () => {
      const group = testData.groups.active[0];
      mockDatabricksService.getSessionGroups.mockResolvedValue([group]);
      mockDatabricksService.updateGroup = jest.fn().mockResolvedValue({
        ...group,
        ...updateData,
      });

      const response = await request(app)
        .put(`/api/sessions/${sessionId}/groups/${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.group.name).toBe(updateData.name);
      expect(mockDatabricksService.updateGroup).toHaveBeenCalledWith(
        groupId,
        updateData
      );
    });

    it('should prevent reducing max size below current size', async () => {
      const group = {
        ...testData.groups.active[0],
        current_size: 4,
      };
      mockDatabricksService.getSessionGroups.mockResolvedValue([group]);

      const invalidUpdate = {
        maxSize: 2, // Less than current_size of 4
      };

      await request(app)
        .put(`/api/sessions/${sessionId}/groups/${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidUpdate)
        .expect(400);
    });

    it('should verify group belongs to session', async () => {
      mockDatabricksService.getSessionGroups.mockResolvedValue([]);

      await request(app)
        .put(`/api/sessions/${sessionId}/groups/wrong-group-id`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(404);
    });
  });

  describe('DELETE /api/sessions/:sessionId/groups/:groupId', () => {
    const groupId = testData.groups.active[0].id;

    it('should delete empty group successfully', async () => {
      const group = {
        ...testData.groups.active[0],
        current_size: 0,
      };
      mockDatabricksService.getSessionGroups.mockResolvedValue([group]);
      mockDatabricksService.deleteGroup.mockResolvedValue(true);

      await request(app)
        .delete(`/api/sessions/${sessionId}/groups/${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      expect(mockDatabricksService.deleteGroup).toHaveBeenCalledWith(groupId);
    });

    it('should reassign students before deleting group', async () => {
      const group = {
        ...testData.groups.active[0],
        current_size: 2,
      };
      mockDatabricksService.getSessionGroups.mockResolvedValue([group]);
      mockDatabricksService.getSessionStudents.mockResolvedValue([
        { ...testData.students.active[0], group_id: groupId },
        { ...testData.students.active[1], group_id: groupId },
      ]);
      mockDatabricksService.removeStudentFromGroup.mockResolvedValue(true);
      mockDatabricksService.deleteGroup.mockResolvedValue(true);

      await request(app)
        .delete(`/api/sessions/${sessionId}/groups/${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(204);

      expect(mockDatabricksService.removeStudentFromGroup).toHaveBeenCalledTimes(2);
      expect(mockDatabricksService.deleteGroup).toHaveBeenCalledWith(groupId);
    });

    it('should verify group belongs to session', async () => {
      mockDatabricksService.getSessionGroups.mockResolvedValue([]);

      await request(app)
        .delete(`/api/sessions/${sessionId}/groups/wrong-group-id`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should handle database errors gracefully', async () => {
      const group = testData.groups.active[0];
      mockDatabricksService.getSessionGroups.mockResolvedValue([group]);
      mockDatabricksService.deleteGroup.mockRejectedValue(new Error('Database error'));

      await request(app)
        .delete(`/api/sessions/${sessionId}/groups/${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);
    });
  });

  describe('COPPA Compliance', () => {
    it('should not expose student PII in group responses', async () => {
      const groups = testData.groups.active;
      const students = testData.students.active.map(student => ({
        ...student,
        email: 'should-not-be-exposed@example.com',
        real_name: 'Should Not Be Exposed',
        ip_address: '192.168.1.1',
      }));
      
      mockDatabricksService.getSessionGroups.mockResolvedValue(groups);
      mockDatabricksService.getSessionStudents.mockResolvedValue(students);

      const response = await request(app)
        .get(`/api/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Verify no PII is exposed
      response.body.groups.forEach((group: any) => {
        if (group.students) {
          group.students.forEach((student: any) => {
            expect(student).not.toHaveProperty('email');
            expect(student).not.toHaveProperty('real_name');
            expect(student).not.toHaveProperty('ip_address');
            expect(student).toHaveProperty('display_name');
            expect(student).toHaveProperty('avatar');
          });
        }
      });
    });
  });
});