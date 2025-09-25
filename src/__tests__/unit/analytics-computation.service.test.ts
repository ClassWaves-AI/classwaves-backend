/**
 * Analytics Computation Service Tests
 * 
 * Tests the robust, idempotent analytics computation service that follows
 * the implementation plan for zero-polling, event-driven architecture.
 */

// Use real redis service; rely on suite-level disconnect and auto-reconnect

import { AnalyticsComputationService } from '../../services/analytics-computation.service';
import { databricksService } from '../../services/databricks.service';

// Mock dependencies
jest.mock('../../services/databricks.service');
jest.mock('../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getSessionsService: () => ({
      emitToSession: jest.fn(),
      emitToGroup: jest.fn(),
    })
  })
}));

describe('AnalyticsComputationService', () => {
  let service: AnalyticsComputationService;
  let mockDatabricksService: jest.Mocked<typeof databricksService>;
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
      engagement_rate: 0.75, // 3 active out of 4 = 0.75
      engagement_score: 0.75,
    },
    {
      id: 'group2',
      name: 'Group B',
      created_at: '2024-01-01T10:00:00Z',
      first_member_joined: '2024-01-01T10:07:00Z',
      member_count: 3, // member5, member6, member7
      engagement_rate: 0.33, // 1 active out of 3 = 0.33
      engagement_score: 0.33,
    }
  ];

  beforeEach(() => {
    // Reset mock implementations and call counts to avoid cross-test leakage
    jest.resetAllMocks();
    jest.clearAllMocks();
    // Use the module's mocked singleton for all calls
    mockDatabricksService = databricksService as any;
    service = new AnalyticsComputationService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    const { redisService } = require('../../services/redis.service');
    await redisService.disconnect();
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
      expect(result!.sessionAnalyticsOverview.sessionId).toBe(sessionId);
      // Total participants: 7 (from participants query)
      expect(result!.sessionAnalyticsOverview.engagementMetrics.totalParticipants).toBe(7);
      // Active participants derived from rate * total
      const active = Math.round(
        result!.sessionAnalyticsOverview.engagementMetrics.totalParticipants *
        (result!.sessionAnalyticsOverview.engagementMetrics.participationRate / 100)
      );
      expect(active).toBe(4);
      expect(result!.sessionAnalyticsOverview.engagementMetrics.participationRate).toBe(57); // 4/7 = 57%
      expect(result!.sessionAnalyticsOverview.groupPerformance.length).toBe(2);
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
      expect(result!.sessionAnalyticsOverview.engagementMetrics.totalParticipants).toBe(5);
      const active2 = Math.round(
        result!.sessionAnalyticsOverview.engagementMetrics.totalParticipants *
        (result!.sessionAnalyticsOverview.engagementMetrics.participationRate / 100)
      );
      expect(active2).toBe(3);
      expect(result!.sessionAnalyticsOverview.engagementMetrics.participationRate).toBe(60);
      expect(result!.sessionAnalyticsOverview.engagementMetrics.averageEngagement).toBe(75);
    });

    it('should handle session not found gracefully', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(null); // No session data

      try {
        await service.computeSessionAnalytics(sessionId);
        // Should not reach here
        expect(false).toBe(true);
      } catch (error: any) {
        expect(['DATA_CORRUPTION', 'ANALYTICS_FAILURE']).toContain(error.type);
        expect(error.message).toMatch(/not found|invalid or corrupted/i);
      }
    });

    it('should compute group performance analytics correctly', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData) // Session data
        .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query.mockImplementation((sql: string) => {
        if (/analytics\.group_analytics/i.test(sql)) return Promise.resolve(mockGroupPerformanceData as any);
        if (/sessions\.participants/i.test(sql)) return Promise.resolve(mockParticipantsData as any);
        if (/sessions\.student_group_members/i.test(sql)) return Promise.resolve(mockGroupsData as any);
        return Promise.resolve([]);
      });

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result!.groupAnalytics).toHaveLength(2);
      expect(result!.groupAnalytics[0].groupId).toBe('group1');
      expect(result!.groupAnalytics[0].memberCount).toBe(4);
      expect(result!.groupAnalytics[0].engagementScore).toBe(75); // 0.75 * 100
      expect(result!.groupAnalytics[0].participationRate).toBe(75);
    });

    it('should persist analytics to database correctly', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData) // Session data
        .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query.mockImplementation((sql: string) => {
        if (/analytics\.group_analytics/i.test(sql)) return Promise.resolve(mockGroupPerformanceData as any);
        if (/sessions\.participants/i.test(sql)) return Promise.resolve(mockParticipantsData as any);
        if (/sessions\.student_group_members/i.test(sql)) return Promise.resolve(mockGroupsData as any);
        return Promise.resolve([]);
      });

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

      mockDatabricksService.query.mockImplementation((sql: string) => {
        if (/sessions\.student_group_members/i.test(sql)) return Promise.resolve([] as any);
        if (/sessions\.participants/i.test(sql)) return Promise.resolve(mockParticipantsData as any);
        if (/analytics\.group_analytics/i.test(sql)) return Promise.resolve([] as any);
        return Promise.resolve([]);
      });

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result!.sessionAnalyticsOverview.groupPerformance.length).toBe(0);
      expect(result!.sessionAnalyticsOverview.membershipSummary.averageMembershipAdherence).toBe(0);
      expect(result!.groupAnalytics).toHaveLength(0);
    });

    it('should handle missing planned vs actual data gracefully', async () => {
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData) // Session data
        .mockResolvedValueOnce(null); // No planned vs actual data

      mockDatabricksService.query.mockImplementation((sql: string) => {
        if (/sessions\.student_group_members/i.test(sql)) return Promise.resolve(mockGroupsData as any);
        if (/sessions\.participants/i.test(sql)) return Promise.resolve(mockParticipantsData as any);
        if (/analytics\.group_analytics/i.test(sql)) return Promise.resolve(mockGroupPerformanceData as any);
        return Promise.resolve([]);
      });

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      // Without planned vs actual data, treat configured unknown and do not over-derive
      expect(result!.sessionAnalyticsOverview.membershipSummary.totalConfiguredMembers).toBe(0);
      expect(result!.sessionAnalyticsOverview.membershipSummary.groupsAtFullCapacity).toBe(0);
      expect(result!.sessionAnalyticsOverview.timelineAnalysis.keyMilestones.length).toBe(0);
      expect(result!.sessionAnalyticsOverview.engagementMetrics.participationRate).toBe(0);
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

      mockDatabricksService.query.mockImplementation((sql: string) => {
        if (/sessions\.student_group_members/i.test(sql)) return Promise.resolve(mockGroupsData as any);
        if (/sessions\.participants/i.test(sql)) return Promise.resolve(mockParticipantsData as any);
        if (/analytics\.group_analytics/i.test(sql)) return Promise.resolve(mockGroupPerformanceData as any);
        return Promise.resolve([]);
      });

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result!.sessionAnalyticsOverview.timelineAnalysis.sessionDuration).toBe(1440);
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

      mockDatabricksService.query.mockImplementation((sql: string) => {
        if (/sessions\.student_group_members/i.test(sql)) return Promise.resolve([] as any);
        if (/sessions\.participants/i.test(sql)) return Promise.resolve([] as any);
        if (/analytics\.group_analytics/i.test(sql)) return Promise.resolve([] as any);
        return Promise.resolve([]);
      });

      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result!.sessionAnalyticsOverview.membershipSummary.totalActualMembers).toBe(0);
      expect(result!.sessionAnalyticsOverview.membershipSummary.totalActualMembers).toBe(0);
      expect(result!.sessionAnalyticsOverview.engagementMetrics.participationRate).toBe(0);
      expect(result!.sessionAnalyticsOverview.engagementMetrics.averageEngagement).toBe(0);
      expect(result!.sessionAnalyticsOverview.groupPerformance.length).toBe(0);
      expect(result!.sessionAnalyticsOverview.membershipSummary.averageMembershipAdherence).toBe(0);
    });
  });

  // ============================================================================
  // COMPREHENSIVE ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling & Robustness', () => {
    beforeEach(() => {
      // Reset circuit breaker state before each test
      (service as any).circuitBreaker = {
        state: 'CLOSED',
        failures: 0,
        lastFailureTime: 0,
        successCount: 0
      };
    });

    describe('Timeout Handling', () => {
      it('should timeout if computation takes too long', async () => {
        // Mock a very slow database operation
        mockDatabricksService.queryOne
          .mockResolvedValueOnce(null) // No existing analytics
          .mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 35000))); // 35 second delay

        const startTime = Date.now();
        
        await expect(service.computeSessionAnalytics(sessionId))
          .rejects
          .toThrow('Analytics computation timed out after 30000ms');

        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeLessThan(32000); // Should timeout around 30 seconds
      }, 35000);

      it('should timeout individual database operations', async () => {
        mockDatabricksService.queryOne
          .mockResolvedValueOnce(null) // No existing analytics
          .mockResolvedValueOnce(mockSessionData) // Session data
          .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

        // Mock slow group query that exceeds database timeout
        mockDatabricksService.query
          .mockImplementationOnce(() => new Promise<any[]>(resolve => setTimeout(() => resolve([]), 15000))) // 15 second delay
          .mockResolvedValueOnce(mockParticipantsData)
          .mockResolvedValueOnce(mockGroupPerformanceData);

        await expect(service.computeSessionAnalytics(sessionId))
          .rejects
          .toThrow('Compute session overview timed out after 10000ms');
      }, 20000);
    });

    describe('Circuit Breaker Pattern', () => {
      it('should open circuit breaker after repeated failures', async () => {
        // Simulate 5 consecutive failures
        for (let i = 0; i < 5; i++) {
          mockDatabricksService.queryOne.mockRejectedValueOnce(new Error('Database connection failed'));
          
          try {
            await service.computeSessionAnalytics(`session-${i}`);
          } catch (error) {
            // Expected to fail
          }
        }

        // 6th attempt should be blocked by circuit breaker
        await expect(service.computeSessionAnalytics('session-6'))
          .rejects
          .toThrow('Analytics service temporarily unavailable due to repeated failures');
      });

      it('should move to half-open state after reset timeout', async () => {
        // Force circuit breaker to open
        (service as any).circuitBreaker = {
          state: 'OPEN',
          failures: 5,
          lastFailureTime: Date.now() - 65000, // 65 seconds ago (past reset timeout)
          successCount: 0
        };

        // Mock successful operation
        mockDatabricksService.queryOne
          .mockResolvedValueOnce(null) // No existing analytics
          .mockResolvedValueOnce(mockSessionData) // Session data
          .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

        mockDatabricksService.query
          .mockResolvedValueOnce(mockGroupsData)
          .mockResolvedValueOnce(mockParticipantsData)
          .mockResolvedValueOnce(mockGroupPerformanceData);

        mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

        const result = await service.computeSessionAnalytics(sessionId);
        expect(result).toBeDefined();
        expect((service as any).circuitBreaker.state).toBe('HALF_OPEN');
      });

      it('should close circuit breaker after successful operations in half-open state', async () => {
        // Set circuit breaker to half-open
        (service as any).circuitBreaker = {
          state: 'HALF_OPEN',
          failures: 3,
          lastFailureTime: Date.now() - 30000,
          successCount: 1 // Already one success
        };

        // Mock successful operation
        mockDatabricksService.queryOne
          .mockResolvedValueOnce(null) // No existing analytics
          .mockResolvedValueOnce(mockSessionData) // Session data
          .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

        mockDatabricksService.query
          .mockResolvedValueOnce(mockGroupsData)
          .mockResolvedValueOnce(mockParticipantsData)
          .mockResolvedValueOnce(mockGroupPerformanceData);

        mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

        const result = await service.computeSessionAnalytics(sessionId);
        expect(result).toBeDefined();
        expect((service as any).circuitBreaker.state).toBe('CLOSED');
        expect((service as any).circuitBreaker.failures).toBe(0);
      });
    });

    describe('Partial Failure Recovery', () => {
      it('should succeed with session analytics even if group analytics fail', async () => {
        mockDatabricksService.queryOne
          .mockResolvedValueOnce(null) // No existing analytics
          .mockResolvedValueOnce(mockSessionData) // Session data
          .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query.mockImplementation((sql: string) => {
        if (/analytics\.group_analytics/i.test(sql)) return Promise.reject(new Error('Group performance query failed'));
        if (/sessions\.participants/i.test(sql)) return Promise.resolve(mockParticipantsData as any);
        if (/sessions\.student_group_members/i.test(sql)) return Promise.resolve(mockGroupsData as any);
        return Promise.resolve([]);
      });

        mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

        const result = await service.computeSessionAnalytics(sessionId);

        // Should have session analytics
        expect(result!.sessionAnalyticsOverview).toBeDefined();
        expect(result!.sessionAnalyticsOverview.sessionId).toBe(sessionId);
        
        // Should have empty group analytics due to failure
        expect(result!.groupAnalytics).toEqual([]);
        
        // Should indicate partial success
        expect(result!.computationMetadata.status).toBe('partial_success');
        // Note: Partial success status indicates some operations failed
      });

      it('should provide minimal analytics when session overview fails', async () => {
        mockDatabricksService.queryOne
          .mockResolvedValueOnce(null) // No existing analytics
          .mockResolvedValueOnce(mockSessionData) // Session data
          .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

      mockDatabricksService.query.mockImplementation((sql: string) => {
        if (/analytics\.group_analytics/i.test(sql)) return Promise.resolve(mockGroupPerformanceData as any);
        if (/sessions\.participants/i.test(sql)) return Promise.resolve(mockParticipantsData as any);
        if (/sessions\.student_group_members/i.test(sql)) return Promise.reject(new Error('Session overview query failed'));
        return Promise.resolve([]);
      });

        mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

        const result = await service.computeSessionAnalytics(sessionId);

        // Should have minimal session analytics
        expect(result!.sessionAnalyticsOverview).toBeDefined();
        expect(result!.sessionAnalyticsOverview.sessionId).toBe(sessionId);
        expect(result!.sessionAnalyticsOverview.membershipSummary.totalActualMembers).toBe(0); // Minimal values
        expect(result!.sessionAnalyticsOverview.timelineAnalysis.sessionDuration).toBe(60); // From session data

        // Should have group analytics
        expect(result!.groupAnalytics).toBeDefined();
        expect(result!.groupAnalytics.length).toBeGreaterThan(0);
        
        // Should indicate partial success
        expect(result!.computationMetadata.status).toBe('partial_success');
      });

      it('should continue even if persistence fails', async () => {
        mockDatabricksService.queryOne
          .mockResolvedValueOnce(null) // No existing analytics
          .mockResolvedValueOnce(mockSessionData) // Session data
          .mockResolvedValueOnce(mockPlannedVsActualData); // Planned vs actual data

        mockDatabricksService.query
          .mockResolvedValueOnce(mockGroupsData)
          .mockResolvedValueOnce(mockParticipantsData)
          .mockResolvedValueOnce(mockGroupPerformanceData);

        // Mock persistence failure
        mockDatabricksService.upsert = jest.fn().mockRejectedValue(new Error('Database write failed'));

        const result = await service.computeSessionAnalytics(sessionId);

        // Should still return computed analytics
        expect(result).toBeDefined();
        expect(result!.sessionAnalyticsOverview.sessionId).toBe(sessionId);
        expect(result!.groupAnalytics).toBeDefined();
      });
    });

    describe('Error Classification', () => {
      it('should classify database connection errors correctly', async () => {
        const connectionError = new Error('ECONNRESET: Connection reset by peer');
        mockDatabricksService.queryOne.mockRejectedValueOnce(connectionError);

        try {
          await service.computeSessionAnalytics(sessionId);
        } catch (error: any) {
          expect(error.type).toBe('DATABASE_CONNECTION');
          expect(error.message).toContain('Database connection failed');
        }
      });

      it('should classify timeout errors correctly', async () => {
        const timeoutError = new Error('Query timed out after 30000ms');
        mockDatabricksService.queryOne.mockRejectedValueOnce(timeoutError);

        try {
          await service.computeSessionAnalytics(sessionId);
        } catch (error: any) {
          expect(error.type).toBe('TIMEOUT');
          expect(error.message).toContain('took too long');
        }
      });

      it('should classify data corruption errors correctly', async () => {
        mockDatabricksService.queryOne
          .mockResolvedValueOnce(null) // No existing analytics
          .mockResolvedValueOnce(null); // Session not found

        try {
          await service.computeSessionAnalytics(sessionId);
          expect(false).toBe(true);
        } catch (error: any) {
          expect(['DATA_CORRUPTION', 'ANALYTICS_FAILURE']).toContain(error.type);
          expect(error.message).toMatch(/not found|invalid or corrupted/i);
        }
      });
    });

    describe('Fallback Analytics', () => {
      it('should provide cached analytics when database connection fails', async () => {
        // Mock database connection failure
        const connectionError = new Error('ECONNRESET: Connection reset by peer');
        mockDatabricksService.queryOne.mockRejectedValueOnce(connectionError);

        // Mock cached analytics available
        const cachedAnalytics = {
          session_id: sessionId,
          total_students: 5,
          active_students: 4,
          avg_participation_rate: 0.8,
          actual_groups: 2,
          avg_group_size: 2.5,
          session_duration: 45,
          planned_groups: 2,
          ready_groups_at_start: 1,
          ready_groups_at_5m: 2,
          ready_groups_at_10m: 2,
          member_adherence: 100
        };

        // Mock fallback query for cached data
        mockDatabricksService.queryOne.mockResolvedValueOnce(cachedAnalytics);

        const result = await service.computeSessionAnalytics(sessionId);

        expect(result).toBeDefined();
        expect(result!.sessionAnalyticsOverview.sessionId).toBe(sessionId);
        expect(result!.sessionAnalyticsOverview.engagementMetrics.totalParticipants).toBe(5);
        const active3 = Math.round(
          result!.sessionAnalyticsOverview.engagementMetrics.totalParticipants *
          (result!.sessionAnalyticsOverview.engagementMetrics.participationRate / 100)
        );
        expect(active3).toBe(4);
        expect(result!.computationMetadata.status).toBe('fallback_from_cache');
      });

      it('should not provide fallback for data corruption errors', async () => {
        // Mock data corruption error (session not found)
        mockDatabricksService.queryOne
          .mockResolvedValueOnce(null) // No existing analytics
          .mockResolvedValueOnce(null); // Session not found

        await expect(service.computeSessionAnalytics(sessionId))
          .rejects
          .toThrow('Session data is invalid or corrupted');
      });
    });

    describe('Idempotency', () => {
      it('should return existing analytics without recomputation', async () => {
        const existingAnalytics = {
          sessionAnalyticsOverview: {
            sessionId,
            totalStudents: 10,
            activeStudents: 8,
            participationRate: 80,
            overallEngagement: 75,
            groupCount: 3,
            averageGroupSize: 3,
            sessionDuration: 60,
            plannedGroups: 3,
            actualGroups: 3,
            readyGroupsAtStart: 2,
            readyGroupsAt5m: 3,
            readyGroupsAt10m: 3,
            memberAdherence: 100
          },
          groupAnalytics: [],
          computationMetadata: {
            computationId: 'existing-123',
            computedAt: new Date(),
            version: '2.0',
            status: 'completed',
            processingTime: 1500
          }
        };

        // Mock existing analytics found
        mockDatabricksService.queryOne.mockResolvedValueOnce(existingAnalytics);

        const result = await service.computeSessionAnalytics(sessionId);

        expect(result).toEqual(existingAnalytics);
        
        // Should not call any other database methods
        expect(mockDatabricksService.query).not.toHaveBeenCalled();
        expect(mockDatabricksService.upsert).not.toHaveBeenCalled();
      });
    });
  });
});
