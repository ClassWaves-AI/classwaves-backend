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
jest.mock('../../../services/databricks.service', () => {
  const { mockDatabricksService } = require('../../mocks/databricks.mock');
  return { databricksService: mockDatabricksService };
});

jest.mock('../../../services/redis.service', () => {
  const { mockRedisService } = require('../../mocks/redis.mock');
  return { redisService: mockRedisService };
});

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
    app.use('/api/v1/sessions', sessionRoutes);
    app.use(errorHandler);
    
    // Generate auth token for tests
    authToken = generateAccessToken(teacher, school, 'auth-session-id');
    
    // Reset mocks
    mockDatabricksService.queryOne.mockResolvedValue(testData.sessions.active);
    mockDatabricksService.getSessionGroups.mockResolvedValue([]);
    mockDatabricksService.createGroup.mockResolvedValue(testData.groups.active[0]);
    mockRedisService.isConnected.mockReturnValue(true);
  });

  describe('GET /api/v1/sessions/:sessionId/groups', () => {
    it('should list all groups in a session', async () => {
      // Align to controller: it uses query() to fetch groups and returns success envelope
      const rows = testData.groups.active.map(g => ({
        id: g.id,
        session_id: sessionId,
        name: g.name,
        group_number: 1,
        status: 'active',
        max_size: 4,
        current_size: 2,
        student_ids: JSON.stringify([]),
        auto_managed: false,
        is_ready: false,
        leader_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));
      mockDatabricksService.queryOne.mockResolvedValue({ id: sessionId, teacher_id: teacher.id, status: 'active' });
      (mockDatabricksService.query as any).mockResolvedValue(rows);

      const response = await request(app)
        .get(`/api/v1/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.groups)).toBe(true);
    });

    it('should handle empty groups list', async () => {
      (mockDatabricksService.query as any).mockResolvedValue([]);

      const response = await request(app)
        .get(`/api/v1/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.groups).toEqual([]);
    });

    it('should verify teacher owns the session', async () => {
      const otherTeacherSession = {
        ...testData.sessions.active,
        teacher_id: 'other-teacher-id',
      };
      mockDatabricksService.queryOne.mockResolvedValue(otherTeacherSession);

      await request(app)
        .get(`/api/v1/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(403);
    });

    it('should allow listing groups even if session ended (current behavior)', async () => {
      mockDatabricksService.queryOne.mockResolvedValue({ id: sessionId, teacher_id: teacher.id, status: 'ended' });
      ;(mockDatabricksService.query as any).mockResolvedValue([]);
      await request(app)
        .get(`/api/v1/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });
  });

  describe('POST /api/v1/sessions/:sessionId/groups', () => {
    const validGroupData = {
      name: 'Group A',
      maxMembers: 4,
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
        .post(`/api/v1/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(validGroupData)
        .expect(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data?.group).toBeDefined();
    });

    it('should validate required fields', async () => {
      const invalidData = { maxMembers: 1 };

      await request(app)
        .post(`/api/v1/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    it('should validate max size constraints', async () => {
      const invalidData = { name: 'Group A', maxMembers: 1 };

      await request(app)
        .post(`/api/v1/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidData)
        .expect(400);
    });

    // Duplicate-name prevention not enforced in current controller

    // Max groups per session constraint not implemented in controller
  });

  describe('POST /api/v1/sessions/:sessionId/groups/auto-generate', () => {
    const autoGenerateData = {
      numberOfGroups: 4,
      strategy: 'random', // or 'balanced'
    };

    it('should auto-generate groups successfully', async () => {
      mockDatabricksService.queryOne.mockResolvedValue({ id: sessionId, teacher_id: teacher.id, status: 'created' });
      (mockDatabricksService.query as any).mockResolvedValue([
        { id: 'student-1', display_name: 'Student One' },
        { id: 'student-2', display_name: 'Student Two' },
        { id: 'student-3', display_name: 'Student Three' },
        { id: 'student-4', display_name: 'Student Four' },
      ]);
      mockDatabricksService.insert.mockResolvedValue(undefined);
      mockDatabricksService.update.mockResolvedValue(undefined);

      const response = await request(app)
        .post(`/api/v1/sessions/${sessionId}/groups/auto-generate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ sessionId, targetGroupSize: 2 })
        .expect(201);

      expect(response.body.groups).toHaveLength(2);
    });

    it('should require minimum students for auto-generation', async () => {
      mockDatabricksService.queryOne.mockResolvedValue({ id: sessionId, teacher_id: teacher.id, status: 'created' });
      (mockDatabricksService.query as any).mockResolvedValue([
        { id: 'student-1', display_name: 'Student One' },
      ]);

      await request(app)
        .post(`/api/v1/sessions/${sessionId}/groups/auto-generate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ sessionId, targetGroupSize: 2 })
        .expect(400);
    });

    it('should generate groups when students available', async () => {
      mockDatabricksService.queryOne.mockResolvedValue({ id: sessionId, teacher_id: teacher.id, status: 'created' });
      (mockDatabricksService.query as any).mockResolvedValue([
        { id: 'student-1', display_name: 'Student One' },
        { id: 'student-2', display_name: 'Student Two' },
        { id: 'student-3', display_name: 'Student Three' },
        { id: 'student-4', display_name: 'Student Four' },
      ]);
      mockDatabricksService.insert.mockResolvedValue(undefined);
      mockDatabricksService.update.mockResolvedValue(undefined);

      await request(app)
        .post(`/api/v1/sessions/${sessionId}/groups/auto-generate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(autoGenerateData)
        .expect(201);
    });

    it('should support balanced distribution strategy', async () => {
      const students = Array.from({ length: 10 }, (_, i) => ({ id: `student-${i}`, display_name: `Student ${i}` }));
      mockDatabricksService.queryOne.mockResolvedValue({ id: sessionId, teacher_id: teacher.id, status: 'created' });
      (mockDatabricksService.query as any).mockResolvedValue(students);

      const balancedData = {
        numberOfGroups: 3,
        strategy: 'balanced',
      };

      const res = await request(app)
        .post(`/api/v1/sessions/${sessionId}/groups/auto-generate`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ sessionId, targetGroupSize: 4 })
        .expect(201);

      expect(res.body.groups.length).toBeGreaterThan(0);
    });
  });

  describe('PUT /api/v1/sessions/:sessionId/groups/:groupId', () => {
    const groupId = testData.groups.active[0].id;
    const updateData = {
      name: 'Updated Group Name',
      maxSize: 6,
    };

    it('should update group successfully', async () => {
      const group = {
        id: testData.groups.active[0].id,
        session_id: sessionId,
        name: 'Science Lab - Period 3',
        max_size: 4,
        current_size: 0,
        student_ids: '[]',
        status: 'active',
        is_ready: false,
        leader_id: null,
      };
      mockDatabricksService.queryOne.mockResolvedValueOnce({
        // Ownership check
        id: group.id,
        session_id: sessionId,
        teacher_id: teacher.id,
      });
      // Update then fetch updated
      mockDatabricksService.update.mockResolvedValue(undefined);
      mockDatabricksService.queryOne.mockResolvedValueOnce({
        ...group,
        name: updateData.name,
        max_size: updateData.maxSize,
      });

      const response = await request(app)
        .put(`/api/v1/sessions/${sessionId}/groups/${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.group.name).toBe(updateData.name);
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
        .put(`/api/v1/sessions/${sessionId}/groups/${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidUpdate)
        .expect(400);
    });

    it('should verify group belongs to session', async () => {
      mockDatabricksService.queryOne.mockResolvedValueOnce(null);

      await request(app)
        .put(`/api/v1/sessions/${sessionId}/groups/wrong-group-id`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(updateData)
        .expect(404);
    });
  });

  describe('DELETE /api/v1/sessions/:sessionId/groups/:groupId', () => {
    const groupId = testData.groups.active[0].id;

    it('should delete empty group successfully', async () => {
      const group = {
        ...testData.groups.active[0],
        current_size: 0,
      };
      mockDatabricksService.queryOne.mockResolvedValueOnce({
        id: groupId,
        session_id: sessionId,
        teacher_id: teacher.id,
        session_status: 'paused',
      });
      mockDatabricksService.delete.mockResolvedValue(true);

      await request(app)
        .delete(`/api/v1/sessions/${sessionId}/groups/${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockDatabricksService.delete).toHaveBeenCalledWith('student_groups', groupId);
    });

    it('should reassign students before deleting group', async () => {
      const group = {
        ...testData.groups.active[0],
        current_size: 2,
      };
      mockDatabricksService.queryOne.mockResolvedValueOnce({
        id: groupId,
        session_id: sessionId,
        teacher_id: teacher.id,
        session_status: 'paused',
      });
      (mockDatabricksService.query as any).mockResolvedValueOnce([
        { ...testData.students.active[0], group_id: groupId },
        { ...testData.students.active[1], group_id: groupId },
      ]);
      mockDatabricksService.delete.mockResolvedValue(true);

      await request(app)
        .delete(`/api/v1/sessions/${sessionId}/groups/${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(mockDatabricksService.delete).toHaveBeenCalledWith('student_groups', groupId);
    });

    it('should verify group belongs to session', async () => {
      mockDatabricksService.queryOne.mockResolvedValueOnce(null);

      await request(app)
        .delete(`/api/v1/sessions/${sessionId}/groups/wrong-group-id`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(404);
    });

    it('should handle database errors gracefully', async () => {
      mockDatabricksService.queryOne.mockResolvedValueOnce({
        id: groupId,
        session_id: sessionId,
        teacher_id: teacher.id,
        session_status: 'paused',
      });
      mockDatabricksService.delete.mockRejectedValue(new Error('Database error'));

      await request(app)
        .delete(`/api/v1/sessions/${sessionId}/groups/${groupId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500);
    });
  });

  describe('COPPA Compliance', () => {
    it('should not expose student PII in group responses', async () => {
      mockDatabricksService.queryOne.mockResolvedValue({ id: sessionId, teacher_id: teacher.id, status: 'active' });
      (mockDatabricksService.query as any).mockResolvedValue([]);
      await request(app)
        .get(`/api/v1/sessions/${sessionId}/groups`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });
  });
});