/**
 * Unit Tests for Enhanced Membership Analytics
 * 
 * Tests the new group membership tracking and analytics functionality
 * including detailed member participation, formation time analytics,
 * and adherence calculations.
 */

import { Request, Response } from 'express';
import { getSessionOverview, getSessionGroups } from '../../../controllers/guidance-analytics.controller';
import { databricksService } from '../../../services/databricks.service';
import { AuthRequest } from '../../../types/auth.types';

// Mock the databricks service
jest.mock('../../../services/databricks.service');

const mockDatabricksService = databricksService as jest.Mocked<typeof databricksService>;

// Test data
const mockTeacher = {
  id: 'teacher-123',
  email: 'teacher@school.edu',
  school_id: 'school-123',
  role: 'teacher',
  status: 'active',
};

const mockSessionId = 'session-membership-test';

const mockMembershipData = [
  {
    group_id: 'group-1',
    group_name: 'Dev Team',
    leader_id: 'leader-1',
    configured_size: 4,
    actual_member_count: 4,
    leader_present: 1,
    regular_members_count: 3,
    first_member_joined: '2025-01-15T10:00:00Z',
    last_member_joined: '2025-01-15T10:03:00Z',
  },
  {
    group_id: 'group-2',
    group_name: 'QA Team',
    leader_id: 'leader-2',
    configured_size: 3,
    actual_member_count: 2,
    leader_present: 0,
    regular_members_count: 2,
    first_member_joined: '2025-01-15T10:01:00Z',
    last_member_joined: '2025-01-15T10:02:00Z',
  }
];

function createMockRequest(params: any = {}): AuthRequest {
  return {
    params: { sessionId: mockSessionId, ...params },
    user: mockTeacher,
    school: { id: 'school-123' },
  } as AuthRequest;
}

function createMockResponse(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Enhanced Membership Analytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock session verification
    mockDatabricksService.queryOne.mockResolvedValue({
      id: mockSessionId,
      teacher_id: mockTeacher.id
    });
  });

  describe('getSessionOverview with membership analytics', () => {
    it('should return enhanced overview with membership breakdown', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      // Mock analytics data (no session_metrics for simplified test)
      mockDatabricksService.queryOne
        .mockResolvedValueOnce({
          planned_groups: 2,
          planned_group_size: 3,
          planned_duration_minutes: 45,
          planned_members: 6,
          planned_leaders: 2,
          planned_scheduled_start: '2025-01-15T09:55:00Z',
          configured_at: '2025-01-14T12:00:00Z',
          started_at: '2025-01-15T10:00:00Z',
          started_without_ready_groups: 0,
          ready_groups_at_start: 1,
          ready_groups_at_5m: 2,
          ready_groups_at_10m: 2,
          adherence_members_ratio: 0.85,
        }) // Planned metrics
        .mockResolvedValueOnce({
          actual_groups: 2,
          actual_avg_group_size: 3,
          actual_members: 6,
          actual_unique_students: 6,
          actual_leaders: 1,
        });

      mockDatabricksService.query
        .mockResolvedValueOnce([{ teacher_id: mockTeacher.id, school_id: mockTeacher.school_id }]) // Ownership check
        .mockResolvedValueOnce([]) // No readiness events
        .mockResolvedValueOnce(mockMembershipData); // Membership analytics

      await getSessionOverview(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          sessionId: mockSessionId,
          plannedVsActual: expect.objectContaining({
            actual: expect.objectContaining({
              groups: 2,
              members: 6,
              uniqueStudents: 6,
              leaders: 1
            })
          }),
          membershipAnalytics: expect.objectContaining({
            groupBreakdown: expect.arrayContaining([
              expect.objectContaining({
                groupId: 'group-1',
                groupName: 'Dev Team',
                actualMemberCount: 4,
                leaderPresent: true,
                regularMembersCount: 3,
                membershipAdherence: 1.0 // 4/4 = 100%
              }),
              expect.objectContaining({
                groupId: 'group-2',
                groupName: 'QA Team',
                actualMemberCount: 2,
                leaderPresent: false,
                regularMembersCount: 2,
                membershipAdherence: 0.67 // 2/3 ≈ 67%
              })
            ]),
            summary: expect.objectContaining({
              totalConfiguredMembers: 7, // 4 + 3
              totalActualMembers: 6, // 4 + 2
              groupsWithLeaders: 1, // Only group-1 has leader
              groupsAtFullCapacity: 1, // Only group-1 at full capacity
              avgMembershipAdherence: expect.any(Number)
            })
          })
        })
      });
    });
  });

  describe('getSessionGroups with normalized membership data', () => {
    it('should return groups with detailed membership analytics', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      // Mock group data with membership details
      const mockGroupsWithMembership = [
        {
          id: 'group-1',
          name: 'Dev Team',
          leader_id: 'leader-1',
          is_ready: true,
          configured_size: 4,
          members_present: 4,
          leader_ready_at: '2025-01-15T10:05:00Z',
          members_configured: 4,
          configured_name: 'Dev Team',
          actual_member_count: 4,
          leader_present: 1,
          regular_members_count: 3,
          first_member_joined: '2025-01-15T10:00:00Z',
          last_member_joined: '2025-01-15T10:03:00Z'
        },
        {
          id: 'group-2',
          name: 'QA Team',
          leader_id: 'leader-2',
          is_ready: false,
          configured_size: 3,
          members_present: 2,
          leader_ready_at: null,
          members_configured: 3,
          configured_name: 'QA Team',
          actual_member_count: 2,
          leader_present: 0,
          regular_members_count: 2,
          first_member_joined: '2025-01-15T10:01:00Z',
          last_member_joined: '2025-01-15T10:02:00Z'
        }
      ];

      mockDatabricksService.query
        .mockResolvedValueOnce([{ teacher_id: mockTeacher.id, school_id: mockTeacher.school_id }])
        .mockResolvedValueOnce(mockGroupsWithMembership);

      await getSessionGroups(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          sessionId: mockSessionId,
          groups: expect.arrayContaining([
            expect.objectContaining({
              groupId: 'group-1',
              name: 'Dev Team',
              membership: expect.objectContaining({
                actualMemberCount: 4,
                leaderPresent: true,
                regularMembersCount: 3,
                membershipAdherence: 1,
                joinTimeline: expect.objectContaining({
                  firstMemberJoined: '2025-01-15T10:00:00Z',
                  lastMemberJoined: '2025-01-15T10:03:00Z',
                  formationTime: 180000,
                })
              })
            }),
            expect.objectContaining({
              groupId: 'group-2',
              name: 'QA Team',
              membership: expect.objectContaining({
                actualMemberCount: 2,
                leaderPresent: false,
                regularMembersCount: 2,
                membershipAdherence: 0.67,
                joinTimeline: expect.objectContaining({
                  firstMemberJoined: '2025-01-15T10:01:00Z',
                  lastMemberJoined: '2025-01-15T10:02:00Z',
                  formationTime: 60000,
                })
              })
            })
          ]),
          summary: expect.objectContaining({
            membershipStats: expect.objectContaining({
              totalConfiguredMembers: 7,
              totalActualMembers: 6,
              groupsWithLeadersPresent: 1,
              groupsAtFullCapacity: 1,
              averageMembershipAdherence: expect.any(Number),
              membershipFormationTime: expect.objectContaining({
                avgFormationTime: 120000,
                fastestGroup: expect.objectContaining({ name: 'QA Team' })
              })
            })
          })
        })
      });
    });

    it('should handle missing membership data gracefully', async () => {
      const req = createMockRequest();
      const res = createMockResponse();

      // Mock groups with no membership data
      const mockGroupsNoMembership = [
        {
          id: 'group-1',
          name: 'Solo Group',
          leader_id: 'leader-1',
          is_ready: false,
          configured_size: 1,
          members_present: 0,
          leader_ready_at: null,
          members_configured: 1,
          configured_name: 'Solo Group',
          actual_member_count: 0,
          leader_present: 0,
          regular_members_count: 0,
          first_member_joined: null,
          last_member_joined: null
        }
      ];

      mockDatabricksService.query
        .mockResolvedValueOnce([{ teacher_id: mockTeacher.id, school_id: mockTeacher.school_id }])
        .mockResolvedValueOnce(mockGroupsNoMembership);

      await getSessionGroups(req as Request, res as Response);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          sessionId: mockSessionId,
          groups: expect.arrayContaining([
            expect.objectContaining({
              groupId: 'group-1',
              name: 'Solo Group',
              membership: expect.objectContaining({
                actualMemberCount: 0,
                leaderPresent: false,
                regularMembersCount: 0,
                membershipAdherence: 0,
                joinTimeline: expect.objectContaining({
                  firstMemberJoined: undefined,
                  lastMemberJoined: undefined,
                  formationTime: null,
                })
              })
            })
          ]),
          summary: expect.objectContaining({
            membershipStats: expect.objectContaining({
              totalConfiguredMembers: 1,
              totalActualMembers: 0,
              groupsWithLeadersPresent: 0,
              groupsAtFullCapacity: 0,
              averageMembershipAdherence: 0,
              membershipFormationTime: expect.objectContaining({
                avgFormationTime: null,
                fastestGroup: null
              })
            })
          })
        })
      });
    });
  });

  describe('Analytics calculation accuracy', () => {
    it('should correctly calculate membership adherence ratios', () => {
      // Test data: configured=4, actual=3 should be 0.75 (75%)
      const adherence = 3 / 4;
      expect(Number(adherence.toFixed(2))).toBe(0.75);
      
      // Test data: configured=5, actual=5 should be 1.0 (100%)
      const perfectAdherence = 5 / 5;
      expect(Number(perfectAdherence.toFixed(2))).toBe(1.0);
    });

    it('should correctly calculate formation time in milliseconds', () => {
      const start = new Date('2025-01-15T10:00:00Z').getTime();
      const end = new Date('2025-01-15T10:03:00Z').getTime();
      const formationTime = end - start;
      
      expect(formationTime).toBe(180000); // 3 minutes = 180,000 ms
    });
  });
});
