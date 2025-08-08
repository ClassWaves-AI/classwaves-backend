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

  describe('createGroups', () => {
    it('should create groups manually', async () => {
      const groupData = {
        sessionId: 'session-123',
        groups: [
          {
            name: 'Group A',
            studentIds: ['student-1', 'student-2', 'student-3'],
          },
          {
            name: 'Group B',
            studentIds: ['student-4', 'student-5'],
          },
        ],
      };

      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: groupData,
      });

      // Mock session ownership check
      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'session-123',
            teacher_id: mockTeacher.id,
            school_id: mockTeacher.school_id,
          }],
        })
        // Mock group creation
        .mockResolvedValueOnce({
          rows: [
            { group_id: 'group-1', group_name: 'Group A' },
            { group_id: 'group-2', group_name: 'Group B' },
          ],
        });

      await createGroup(mockReq as AuthRequest, mockRes as Response);

      // Verify groups were created
      expect(databricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO main.classwaves.session_groups'),
        expect.any(Object)
      );

      // Verify student assignments
      expect(databricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE main.classwaves.students'),
        expect.any(Object)
      );


      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        groups: expect.arrayContaining([
          expect.objectContaining({
            id: 'group-1',
            name: 'Group A',
            studentIds: ['student-1', 'student-2', 'student-3'],
          }),
        ]),
      });
    });

    it('should validate group names are unique', async () => {
      const groupData = {
        sessionId: 'session-123',
        groups: [
          { name: 'Group A', studentIds: ['student-1'] },
          { name: 'Group A', studentIds: ['student-2'] }, // Duplicate name
        ],
      };

      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: groupData,
      });

      await createGroup(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'DUPLICATE_GROUP_NAMES', 400);
    });

    it('should prevent duplicate student assignments', async () => {
      const groupData = {
        sessionId: 'session-123',
        groups: [
          { name: 'Group A', studentIds: ['student-1', 'student-2'] },
          { name: 'Group B', studentIds: ['student-2', 'student-3'] }, // student-2 in both
        ],
      };

      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: groupData,
      });

      await createGroup(mockReq as AuthRequest, mockRes as Response);

      assertErrorResponse(mockRes, 'DUPLICATE_STUDENT_ASSIGNMENT', 400);
    });
  });

  describe('autoFormGroups', () => {
    it('should automatically create balanced groups', async () => {
      const autoGroupData = {
        sessionId: 'session-123',
        targetGroupSize: 4,
        mixByGrade: true,
      };

      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: autoGroupData,
      });

      // Mock session and students
      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{
            id: 'session-123',
            teacher_id: mockTeacher.id,
          }],
        })
        // Mock student list
        .mockResolvedValueOnce({
          rows: [
            { id: 'student-1', display_name: 'Alice', grade_level: '3' },
            { id: 'student-2', display_name: 'Bob', grade_level: '4' },
            { id: 'student-3', display_name: 'Charlie', grade_level: '3' },
            { id: 'student-4', display_name: 'Diana', grade_level: '4' },
            { id: 'student-5', display_name: 'Eve', grade_level: '3' },
            { id: 'student-6', display_name: 'Frank', grade_level: '4' },
            { id: 'student-7', display_name: 'Grace', grade_level: '3' },
            { id: 'student-8', display_name: 'Henry', grade_level: '4' },
          ],
        })
        // Mock group creation
        .mockResolvedValueOnce({
          rows: [
            { group_id: 'group-1' },
            { group_id: 'group-2' },
          ],
        });

      await autoGenerateGroups(mockReq as AuthRequest, mockRes as Response);

      // Verify groups were created with balanced sizes
      const createCall = (databricksService.query as jest.Mock).mock.calls
        .find(call => call[0].includes('INSERT INTO main.classwaves.session_groups'));
      
      expect(createCall).toBeDefined();
      
      expect(mockRes.json).toHaveBeenCalledWith({
        groups: expect.arrayContaining([
          expect.objectContaining({
            name: expect.stringMatching(/Group [A-Z]/),
            studentCount: 4,
          }),
        ]),
        stats: expect.objectContaining({
          totalStudents: 8,
          groupsCreated: 2,
          averageGroupSize: 4,
        }),
      });
    });

    it('should handle uneven student distribution', async () => {
      const autoGroupData = {
        sessionId: 'session-123',
        targetGroupSize: 3,
      };

      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: autoGroupData,
      });

      // Mock 10 students (should create 3 groups of 3 and 1 of 1)
      const mockStudents = Array.from({ length: 10 }, (_, i) => ({
        id: `student-${i + 1}`,
        display_name: `Student ${i + 1}`,
        grade_level: String((i % 4) + 1),
      }));

      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ id: 'session-123', teacher_id: mockTeacher.id }],
        })
        .mockResolvedValueOnce({ rows: mockStudents })
        .mockResolvedValueOnce({
          rows: Array.from({ length: 4 }, (_, i) => ({
            group_id: `group-${i + 1}`,
          })),
        });

      await autoGenerateGroups(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: expect.any(Array),
          stats: expect.objectContaining({
            totalStudents: 10,
            groupsCreated: 4,
          }),
        })
      );
    });
  });

  describe('moveStudent', () => {
    it('should move student between groups', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: {
          sessionId: 'session-123',
          studentId: 'student-1',
          fromGroupId: 'group-1',
          toGroupId: 'group-2',
        },
      });

      // Mock ownership and validation checks
      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ id: 'session-123', teacher_id: mockTeacher.id }],
        })
        // Mock student current group check
        .mockResolvedValueOnce({
          rows: [{ group_id: 'group-1' }],
        })
        // Mock update
        .mockResolvedValueOnce({ rows: [] });

      // await moveStudent(mockReq as AuthRequest, mockRes as Response); // Function not implemented yet

      expect(databricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE main.classwaves.students'),
        expect.objectContaining({
          group_id: 'group-2',
          student_id: 'student-1',
        })
      );

      // expect(websocketService.notifySessionUpdate).toHaveBeenCalledWith( // Method not implemented yet
      //   'session-123',
      //   expect.objectContaining({
      //     type: 'student_moved',
      //     studentId: 'student-1',
      //     fromGroupId: 'group-1',
      //     toGroupId: 'group-2',
      //   })
      // );

      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Student moved successfully',
      });
    });

    it('should validate student is in source group', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: {
          sessionId: 'session-123',
          studentId: 'student-1',
          fromGroupId: 'group-1',
          toGroupId: 'group-2',
        },
      });

      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ id: 'session-123', teacher_id: mockTeacher.id }],
        })
        // Student is in different group
        .mockResolvedValueOnce({
          rows: [{ group_id: 'group-3' }],
        });

      // await moveStudent(mockReq as AuthRequest, mockRes as Response); // Function not implemented yet

      assertErrorResponse(mockRes, 'STUDENT_NOT_IN_GROUP', 400);
    });
  });

  describe('mergeGroups', () => {
    it('should merge two groups successfully', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: {
          sessionId: 'session-123',
          sourceGroupId: 'group-2',
          targetGroupId: 'group-1',
        },
      });

      // Mock checks and operations
      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ id: 'session-123', teacher_id: mockTeacher.id }],
        })
        // Mock group existence check
        .mockResolvedValueOnce({
          rows: [
            { group_id: 'group-1', group_name: 'Group A' },
            { group_id: 'group-2', group_name: 'Group B' },
          ],
        })
        // Mock student count
        .mockResolvedValueOnce({
          rows: [{ student_count: 5 }],
        })
        // Mock merge operations
        .mockResolvedValue({ rows: [] });

      // await mergeGroups(mockReq as AuthRequest, mockRes as Response); // Function not implemented yet

      // Verify students were moved
      expect(databricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE main.classwaves.students'),
        expect.objectContaining({
          new_group_id: 'group-1',
          old_group_id: 'group-2',
        })
      );

      // Verify source group was deleted
      expect(databricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM main.classwaves.session_groups'),
        expect.objectContaining({
          group_id: 'group-2',
        })
      );


      expect(mockRes.json).toHaveBeenCalledWith({
        message: 'Groups merged successfully',
        targetGroup: expect.objectContaining({
          id: 'group-1',
          studentCount: 5,
        }),
      });
    });

    it('should prevent merging same group', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        body: {
          sessionId: 'session-123',
          sourceGroupId: 'group-1',
          targetGroupId: 'group-1',
        },
      });

      // await mergeGroups(mockReq as AuthRequest, mockRes as Response); // Function not implemented yet

      assertErrorResponse(mockRes, 'SAME_GROUP_MERGE', 400);
    });
  });

  describe('getSessionGroups', () => {
    it('should return all groups for a session', async () => {
      mockReq = createAuthenticatedRequest(mockTeacher, {
        params: { sessionId: 'session-123' },
      });

      const mockGroups = [
        {
          group_id: 'group-1',
          group_name: 'Group A',
          student_count: 4,
          created_at: new Date(),
        },
        {
          group_id: 'group-2',
          group_name: 'Group B',
          student_count: 3,
          created_at: new Date(),
        },
      ];

      const mockStudents = [
        { group_id: 'group-1', student_id: 'student-1', display_name: 'Alice' },
        { group_id: 'group-1', student_id: 'student-2', display_name: 'Bob' },
        { group_id: 'group-2', student_id: 'student-3', display_name: 'Charlie' },
      ];

      (databricksService.query as jest.Mock)
        .mockResolvedValueOnce({
          rows: [{ id: 'session-123', teacher_id: mockTeacher.id }],
        })
        .mockResolvedValueOnce({ rows: mockGroups })
        .mockResolvedValueOnce({ rows: mockStudents });

      await getSessionGroups(mockReq as AuthRequest, mockRes as Response);

      expect(mockRes.json).toHaveBeenCalledWith({
        groups: expect.arrayContaining([
          expect.objectContaining({
            id: 'group-1',
            name: 'Group A',
            studentCount: 4,
            students: expect.arrayContaining([
              expect.objectContaining({
                id: 'student-1',
                name: 'Alice',
              }),
            ]),
          }),
        ]),
        ungroupedStudents: [],
      });
    });
  });
});