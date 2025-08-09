import { Request, Response } from 'express';
import {
  createGroup,
  getSessionGroups,
  updateGroup,
  autoGenerateGroups
} from '../../../controllers/group.controller';
import { databricksService } from '../../../services/databricks.service';
import { websocketService } from '../../../services/websocket.service';
import {
  createMockRequest,
  createMockResponse,
  createAuthenticatedRequest,
  assertErrorResponse,
  assertSuccessResponse
} from '../../utils/test-helpers';
import { AuthRequest } from '../../../types/auth.types';

// Mock services
jest.mock('../../../services/databricks.service');
jest.mock('../../../services/websocket.service');

describe('Group Controller', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  const mockTeacher = {
    id: 'teacher-123',
    email: 'teacher@school.edu',
    school_id: 'school-123',
    role: 'teacher',
    status: 'active',
  };

  beforeEach(() => {
    mockRes = createMockResponse();
    jest.clearAllMocks();
  });

  // Manual multi-group creation is no longer supported by controller

  describe('autoFormGroups', () => {
    it('should automatically create groups from student list', async () => {
      const autoGroupData = { sessionId: 'session-123', targetGroupSize: 4 };
      mockReq = createAuthenticatedRequest(mockTeacher, { body: autoGroupData });
      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce({ id: 'session-123', teacher_id: mockTeacher.id });
      (databricksService.query as jest.Mock).mockResolvedValueOnce([
        { id: 'student-1', display_name: 'Alice' },
        { id: 'student-2', display_name: 'Bob' },
        { id: 'student-3', display_name: 'Charlie' },
        { id: 'student-4', display_name: 'Diana' },
      ]);
      (databricksService.insert as jest.Mock).mockResolvedValue(undefined);
      (databricksService.update as jest.Mock).mockResolvedValue(undefined);

      await autoGenerateGroups(mockReq as AuthRequest, mockRes as Response);
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ groups: expect.any(Array) }));
    });
  });

  // moveStudent/mergeGroups tests removed; APIs not implemented in controller

  // mergeGroups tests removed; API not implemented

  describe('getSessionGroups', () => {
    it('should return all groups for a session', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { sessionId: 'session-123' },
      });

      (databricksService.queryOne as jest.Mock).mockResolvedValueOnce({ id: 'session-123', teacher_id: mockTeacher.id, status: 'active' });
      (databricksService.query as jest.Mock).mockResolvedValueOnce([
        { id: 'group-1', session_id: 'session-123', name: 'Group A', group_number: 1, status: 'active', max_size: 4, current_size: 4, student_ids: JSON.stringify(['student-1','student-2','student-3','student-4']), auto_managed: false, is_ready: false, leader_id: null, created_at: new Date(), updated_at: new Date() },
      ]);

      await getSessionGroups(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, groups: expect.any(Array) }));
    });
  });
});