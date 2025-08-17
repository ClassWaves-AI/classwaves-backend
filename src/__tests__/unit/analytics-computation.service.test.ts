/**
 * Analytics Computation Service Tests
 * 
 * Tests the robust, idempotent analytics computation service that follows
 * the implementation plan for zero-polling, event-driven architecture.
 */

import { AnalyticsComputationService } from '../../services/analytics-computation.service';
import { DatabricksService } from '../../services/databricks.service';

// Mock dependencies
jest.mock('../../services/databricks.service');
jest.mock('../../services/websocket.service');

describe('AnalyticsComputationService', () => {
  let service: AnalyticsComputationService;
  let mockDatabricksService: jest.Mocked<DatabricksService>;
  const sessionId = 'test-session-123';

  // Define mock data at top level for reuse across tests
  const mockSessionData = {
    id: sessionId,
    teacher_id: 'teacher-123',
    school_id: 'school-123',
    status: 'ended',
    actual_start: '2024-01-01T10:00:00Z',
    actual_end: '2024-01-01T11:00:00Z',
    duration_minutes: 60,
    // Add other fields that might be expected
    name: 'Test Session',
    subject: 'Mathematics',
    grade_level: '9th',
    max_students: 20,
    created_at: '2024-01-01T09:00:00Z',
    updated_at: '2024-01-01T11:00:00Z'
  };

  const mockGroupsData = [
    {
      id: 'group1',
      name: 'Group A',
      created_at: '2024-01-01T10:00:00Z',
      first_member_joined: '2024-01-01T10:05:00Z'
    },
    {
      id: 'group2',
      name: 'Group B',
      created_at: '2024-01-01T10:00:00Z',
      first_member_joined: '2024-01-01T10:07:00Z'
    }
  ];

  const mockParticipantsData = [
    { id: 'member1', group_id: 'group1', is_active: true },
    { id: 'member2', group_id: 'group1', is_active: true },
    { id: 'member3', group_id: 'group1', is_active: true },
    { id: 'member4', group_id: 'group1', is_active: false },
    { id: 'member5', group_id: 'group2', is_active: true },
    { id: 'member6', group_id: 'group2', is_active: false },
    { id: 'member7', group_id: 'group2', is_active: false }
  ];

  const mockPlannedVsActualData = {
    planned_groups: 3,
    actual_groups: 2,
    ready_groups_at_start: 1,
    ready_groups_at_5m: 2,
    ready_groups_at_10m: 2,
    avg_participation_rate: 0.57, // 4/7 = 0.57
    total_students: 7,
    active_students: 4 // Updated to match mockParticipantsData
  };

  const mockGroupPerformanceData = [
    {
      id: 'group1',
      name: 'Group A',
      created_at: '2024-01-01T10:00:00Z',
      first_member_joined: '2024-01-01T10:05:00Z',
      member_count: 4, // member1, member2, member3, member4
      engagement_rate: 0.75 // 3 active out of 4 = 0.75
    },
    {
      id: 'group2',
      name: 'Group B',
      created_at: '2024-01-01T10:00:00Z',
      first_member_joined: '2024-01-01T10:07:00Z',
      member_count: 3, // member5, member6, member7
      engagement_rate: 0.33 // 1 active out of 3 = 0.33
    }
  ];

  beforeEach(() => {
    // Create mock DatabricksService
    mockDatabricksService = {
      query: jest.fn(),
      queryOne: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      insert: jest.fn(),
      delete: jest.fn(),
      recordAuditLog: jest.fn(),
      generateId: jest.fn(() => 'test-id'),
      connect: jest.fn(),
      disconnect: jest.fn(),
      isConnected: jest.fn(() => true)
    } as any;

    // Create service with mock dependencies
    service = new AnalyticsComputationService(mockDatabricksService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('computeSessionAnalytics', () => {

    it('should debug mock setup', async () => {
      // Simple test to debug mock setup
      console.log('🔍 Debug: Testing mock setup...');
      
      // Test basic mock functionality
      mockDatabricksService.queryOne
        .mockResolvedValueOnce('test-value-1')
        .mockResolvedValueOnce('test-value-2');
      
      const result1 = await mockDatabricksService.queryOne('query1');
      const result2 = await mockDatabricksService.queryOne('query2');
      
      console.log('🔍 Debug: Mock results:', { result1, result2 });
      
      expect(result1).toBe('test-value-1');
      expect(result2).toBe('test-value-2');
    });

    it('should compute comprehensive session analytics successfully', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Set up minimal mock sequence - focus on getting the basic flow working
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // 1. No existing analytics
        .mockResolvedValueOnce(mockSessionData); // 2. Session data (this is the key one!)

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // 3. Groups data
        .mockResolvedValueOnce(mockParticipantsData) // 4. Participants data
        .mockResolvedValueOnce(mockGroupPerformanceData); // 5. Group performance data

      // Mock upsert operations
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result).toBeDefined();
      expect(result.sessionAnalyticsOverview.sessionId).toBe(sessionId);
      expect(result.sessionAnalyticsOverview.totalStudents).toBe(7);
      expect(result.sessionAnalyticsOverview.activeStudents).toBe(4);
      expect(result.sessionAnalyticsOverview.participationRate).toBe(57); // 4/7 = 57%
      expect(result.sessionAnalyticsOverview.groupCount).toBe(2);
      expect(result.sessionAnalyticsOverview.averageGroupSize).toBe(4);
    });

    it('should be idempotent - return cached result if already computed', async () => {
      // Mock existing analytics data
      const existingAnalytics = {
        total_students: 5,
        active_students: 3,
        participation_rate: 0.6,
        overall_engagement_score: 75,
        created_at: new Date()
      };

      mockDatabricksService.queryOne
        .mockResolvedValueOnce(existingAnalytics) // Existing analytics found
        .mockResolvedValueOnce(mockSessionData) // Session data
        .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query
        .mockResolvedValueOnce([]) // No groups
        .mockResolvedValueOnce([]); // No participants

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result).toBeDefined();
      expect(result.sessionAnalyticsOverview.totalStudents).toBe(5);
      expect(result.sessionAnalyticsOverview.activeStudents).toBe(3);
      expect(result.sessionAnalyticsOverview.participationRate).toBe(60);
      expect(result.sessionAnalyticsOverview.overallEngagement).toBe(75);
    });

    it('should handle session not found gracefully', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(null); // No session data

      await expect(service.computeSessionAnalytics(sessionId)).rejects.toThrow(
        `Session ${sessionId} not found`
      );
    });

    it('should compute group performance analytics correctly', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData) // Session data
        .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Groups data
        .mockResolvedValueOnce(mockParticipantsData) // Participants data
        .mockResolvedValueOnce(mockGroupPerformanceData); // Group performance data

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result.groupAnalytics).toHaveLength(2);
      expect(result.groupAnalytics[0].groupId).toBe('group1');
      expect(result.groupAnalytics[0].memberCount).toBe(4);
      expect(result.groupAnalytics[0].engagementScore).toBe(75); // 0.75 * 100
      expect(result.groupAnalytics[0].participationRate).toBe(75);
    });

    it('should persist analytics to database correctly', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData) // Session data
        .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Groups data
        .mockResolvedValueOnce(mockParticipantsData) // Participants data
        .mockResolvedValueOnce(mockGroupPerformanceData); // Group performance data

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      await service.computeSessionAnalytics(sessionId);

      // Verify session_metrics upsert
      expect(mockDatabricksService.upsert).toHaveBeenCalledWith(
        'session_metrics',
        { session_id: sessionId },
        expect.objectContaining({
          session_id: sessionId,
          total_students: 7,
          active_students: 4,
          participation_rate: 0.57, // 57/100
          overall_engagement_score: 57
        })
      );

      // Verify session_analytics_cache upsert
      expect(mockDatabricksService.upsert).toHaveBeenCalledWith(
        'session_analytics_cache',
        { session_id: sessionId },
        expect.objectContaining({
          session_id: sessionId,
          actual_groups: 2,
          avg_participation_rate: 0.57
        })
      );

      // Verify group_metrics upserts
      expect(mockDatabricksService.upsert).toHaveBeenCalledWith(
        'group_metrics',
        { group_id: 'group1', session_id: sessionId },
        expect.objectContaining({
          group_id: 'group1',
          session_id: sessionId,
          turn_taking_score: 75
        })
      );
    });

    it('should handle database errors gracefully', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData) // Session data
        .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Groups data
        .mockResolvedValueOnce(mockParticipantsData) // Participants data
        .mockResolvedValueOnce(mockGroupsData); // Group performance data

      // Mock database error during upsert
      mockDatabricksService.upsert = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      await expect(service.computeSessionAnalytics(sessionId)).rejects.toThrow(
        'Database connection failed'
      );
    });

    it('should mark computation as failed when errors occur', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData) // Session data
        .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Groups data
        .mockResolvedValueOnce(mockParticipantsData) // Participants data
        .mockResolvedValueOnce(mockGroupsData); // Group performance data

      // Mock database error during upsert
      mockDatabricksService.upsert = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      try {
        await service.computeSessionAnalytics(sessionId);
      } catch (error) {
        // Expected to fail
      }

      // Verify that failure was recorded
      expect(mockDatabricksService.upsert).toHaveBeenCalledWith(
        'session_metrics',
        { session_id: sessionId },
        expect.objectContaining({
          session_id: sessionId,
          technical_issues_count: 1
        })
      );
    });

    it('should handle empty groups gracefully', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData) // Session data
        .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query
        .mockResolvedValueOnce([]) // No groups
        .mockResolvedValueOnce(mockParticipantsData) // Participants data
        .mockResolvedValueOnce([]); // No group performance data

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result.sessionAnalyticsOverview.groupCount).toBe(0);
      expect(result.sessionAnalyticsOverview.averageGroupSize).toBe(0);
      expect(result.groupAnalytics).toHaveLength(0);
    });

    it('should handle missing planned vs actual data gracefully', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData) // Session data
        .mockResolvedValueOnce(null); // No planned vs actual data

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Groups data
        .mockResolvedValueOnce(mockParticipantsData) // Participants data
        .mockResolvedValueOnce(mockGroupsData); // Group performance data

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result.sessionAnalyticsOverview.plannedGroups).toBe(0);
      expect(result.sessionAnalyticsOverview.actualGroups).toBe(2); // From actual groups data
      expect(result.sessionAnalyticsOverview.readyGroupsAtStart).toBe(0);
      expect(result.sessionAnalyticsOverview.readyGroupsAt5m).toBe(0);
      expect(result.sessionAnalyticsOverview.readyGroupsAt10m).toBe(0);
      expect(result.sessionAnalyticsOverview.memberAdherence).toBe(0);
    });

    it('should handle long session duration correctly', async () => {
      const longSessionData = {
        ...mockSessionData,
        duration_minutes: 1440 // 24 hours
      };

      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(longSessionData) // Long session data
        .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Groups data
        .mockResolvedValueOnce(mockParticipantsData) // Participants data
        .mockResolvedValueOnce(mockGroupsData); // Group performance data

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result.sessionAnalyticsOverview.sessionDuration).toBe(1440);
    });

    it('should handle zero students gracefully', async () => {
      const emptySessionData = {
        ...mockSessionData,
        total_students: 0
      };

      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(emptySessionData) // Empty session data
        .mockResolvedValueOnce(null); // No planned vs actual data

      mockDatabricksService.query
        .mockResolvedValueOnce([]) // No groups
        .mockResolvedValueOnce([]) // No participants
        .mockResolvedValueOnce([]); // No group performance data

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result.sessionAnalyticsOverview.totalStudents).toBe(0);
      expect(result.sessionAnalyticsOverview.activeStudents).toBe(0);
      expect(result.sessionAnalyticsOverview.participationRate).toBe(0);
      expect(result.sessionAnalyticsOverview.overallEngagement).toBe(0);
      expect(result.sessionAnalyticsOverview.groupCount).toBe(0);
      expect(result.sessionAnalyticsOverview.averageGroupSize).toBe(0);
    });
  });
});
