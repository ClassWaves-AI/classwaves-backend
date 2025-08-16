/**
 * Analytics Computation Service Unit Tests
 * 
 * Tests the robust, idempotent analytics computation system
 * including membership summary, engagement metrics, and timeline analysis.
 */

import { AnalyticsComputationService } from '../../services/analytics-computation.service';
import { databricksService } from '../../services/databricks.service';
import { websocketService } from '../../services/websocket.service';
import { realTimeAnalyticsCacheService } from '../../services/real-time-analytics-cache.service';
import { analyticsLogger } from '../../utils/analytics-logger';

// Mock dependencies - basic mocks first
jest.mock('../../services/databricks.service');
jest.mock('../../services/websocket.service');

// Mock background services to prevent timers and async operations
jest.mock('../../services/audio/InMemoryAudioProcessor', () => ({
  getInMemoryAudioProcessor: jest.fn(() => ({
    startMemoryMonitoring: jest.fn(),
    cleanup: jest.fn()
  }))
}));

jest.mock('../../services/ai-analysis-buffer.service', () => ({
  aiAnalysisBufferService: {
    startCleanupProcess: jest.fn(),
    cleanup: jest.fn()
  }
}));

jest.mock('../../services/teacher-prompt.service', () => ({
  teacherPromptService: {
    cleanup: jest.fn(),
    getSessionMetrics: jest.fn(() => ({}))
  }
}));

jest.mock('../../services/alert-prioritization.service', () => ({
  alertPrioritizationService: {
    cleanup: jest.fn(),
    getAlertStatistics: jest.fn(() => ({}))
  }
}));

jest.mock('../../services/guidance-system-health.service', () => ({
  guidanceSystemHealthService: {
    cleanup: jest.fn(),
    performHealthCheck: jest.fn()
  }
}));

// Mock utils/analytics-logger.ts to prevent background timers
jest.mock('../../utils/analytics-logger', () => {
  const mockAnalyticsLogger = {
    logOperation: jest.fn(),
    cleanup: jest.fn()
  };
  
  // Prevent the setInterval from running
  return {
    analyticsLogger: mockAnalyticsLogger
  };
});

// Mock the cache service more completely to prevent background sync timer
jest.mock('../../services/real-time-analytics-cache.service', () => {
  const mockRealTimeAnalyticsCacheService = {
    getSessionMetrics: jest.fn(),
    updateSessionMetrics: jest.fn(),
    syncCacheToDatabriks: jest.fn()
  };

  return {
    realTimeAnalyticsCacheService: mockRealTimeAnalyticsCacheService,
    RealTimeAnalyticsCacheService: jest.fn().mockImplementation(() => mockRealTimeAnalyticsCacheService)
  };
});

const mockDatabricksService = databricksService as jest.Mocked<typeof databricksService>;
const mockWebsocketService = websocketService as jest.Mocked<typeof websocketService>;
const mockRealTimeAnalyticsCacheService = realTimeAnalyticsCacheService as jest.Mocked<typeof realTimeAnalyticsCacheService>;
const mockAnalyticsLogger = analyticsLogger as jest.Mocked<typeof analyticsLogger>;

describe('AnalyticsComputationService', () => {
  let service: AnalyticsComputationService;
  const sessionId = 'test-session-123';
  
  // Define mock data at top level for reuse across tests
  const mockSessionData = {
    id: sessionId,
    teacher_id: 'teacher-123',
    school_id: 'school-123',
    status: 'ended',
    actual_start: '2024-01-01T10:00:00Z',
    actual_end: '2024-01-01T11:00:00Z'
  };

  const mockGroupsData = [
    {
      id: 'group-1',
      name: 'Group A',
      expected_member_count: 4,
      leader_id: 'leader-1',
      user_id: 'member-1',
      joined_at: '2024-01-01T10:05:00Z'
    },
    {
      id: 'group-1',
      name: 'Group A',
      expected_member_count: 4,
      leader_id: 'leader-1',
      user_id: 'member-2',
      joined_at: '2024-01-01T10:06:00Z'
    },
    {
      id: 'group-2',
      name: 'Group B',
      expected_member_count: 3,
      leader_id: 'leader-2',
      user_id: 'member-3',
      joined_at: '2024-01-01T10:07:00Z'
    }
  ];
  
  beforeAll(() => {
    // Use fake timers to prevent real timers from running during tests
    jest.useFakeTimers();
  });

  beforeEach(() => {
    service = new AnalyticsComputationService();
    jest.clearAllMocks();
    
    // Setup default mocks
    mockAnalyticsLogger.logOperation = jest.fn();
    mockWebsocketService.emitToSession = jest.fn();
  });

  afterEach(() => {
    // Clear any pending timers after each test
    jest.clearAllTimers();
  });

  afterAll(() => {
    // Restore real timers and clean up
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('computeSessionAnalytics', () => {

    it('should compute comprehensive session analytics successfully', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Set up complete mock sequence for successful computation
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics (getExistingAnalytics)
        .mockResolvedValueOnce(mockSessionData); // Session data (fetchSessionData)

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Group membership data (computeMembershipSummary)
        .mockResolvedValueOnce([]) // Timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce([]); // Group performance data (computeGroupPerformance)

      // Mock cache service (for engagement metrics)
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 3,
        activeGroups: 2,
        averageEngagement: 0.75,
        averageParticipation: 0.8,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 2
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result).toBeDefined();
      expect(result?.sessionAnalyticsOverview.sessionId).toBe(sessionId);
      expect(result?.sessionAnalyticsOverview.membershipSummary).toEqual(
        expect.objectContaining({
          totalConfiguredMembers: 7, // 4 + 3
          totalActualMembers: 3,
          groupsWithLeadersPresent: 2,
          groupsAtFullCapacity: 0
        })
      );
    });

    it('should be idempotent - return cached result if already computed', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();

      const existingAnalyticsData = {
        sessionId,
        computedAt: '2024-01-01T11:00:00Z',
        membershipSummary: {
          totalConfiguredMembers: 7,
          totalActualMembers: 3,
          groupsWithLeadersPresent: 2,
          groupsAtFullCapacity: 0,
          averageMembershipAdherence: 0.43,
          membershipFormationTime: {
            avgFormationTime: 60000,
            fastestGroup: null
          }
        },
        engagementMetrics: {
          totalParticipants: 3,
          activeGroups: 2,
          averageEngagement: 0.75,
          participationRate: 0.8
        },
        timelineAnalysis: {
          sessionDuration: 60,
          groupFormationTime: 5,
          activeParticipationTime: 55,
          keyMilestones: []
        },
        groupPerformance: []
      };

      const existingComputationMetadata = {
        status: 'completed',
        computedAt: new Date('2024-01-01T11:00:00Z'),
        version: '2.0',
        processingTime: 2000
      };

      // Mock ONLY the getExistingAnalytics call (first queryOne call)
      mockDatabricksService.queryOne.mockResolvedValueOnce({
        analytics_data: JSON.stringify(existingAnalyticsData),
        computation_metadata: JSON.stringify(existingComputationMetadata)
      });

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result).toBeDefined();
      expect(result?.sessionAnalyticsOverview.sessionId).toBe(sessionId);
      expect(result?.computationMetadata.status).toBe('completed');
      
      // Should return cached result without calling other database methods
      expect(mockDatabricksService.query).not.toHaveBeenCalled();
      expect(mockDatabricksService.queryOne).toHaveBeenCalledTimes(1); // Only getExistingAnalytics
      expect(mockDatabricksService.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT analytics_data, computation_metadata'),
        [sessionId]
      );
    });

    it('should compute membership summary with formation times correctly', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Set up complete mock sequence
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics (getExistingAnalytics)
        .mockResolvedValueOnce(mockSessionData); // Session data (fetchSessionData)

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Group membership data (computeMembershipSummary)
        .mockResolvedValueOnce([]) // Timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce([]); // Group performance data (computeGroupPerformance)

      // Mock cache service (for engagement metrics)
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 3,
        activeGroups: 2,
        averageEngagement: 0.75,
        averageParticipation: 0.8,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 2
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      const membershipSummary = result?.sessionAnalyticsOverview.membershipSummary;
      expect(membershipSummary?.totalConfiguredMembers).toBe(7);
      expect(membershipSummary?.totalActualMembers).toBe(3);
      expect(membershipSummary?.averageMembershipAdherence).toBeCloseTo(0.43, 2);
      expect(membershipSummary?.membershipFormationTime.avgFormationTime).toBeGreaterThan(0);
    });

    it('should compute engagement metrics from cache when available', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Set up complete mock sequence
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics (getExistingAnalytics)
        .mockResolvedValueOnce(mockSessionData); // Session data (fetchSessionData)

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Group membership data (computeMembershipSummary)
        .mockResolvedValueOnce([]) // Timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce([]); // Group performance data (computeGroupPerformance)

      // Mock cache service to return cached metrics (for engagement metrics)
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 3,
        activeGroups: 2,
        averageEngagement: 0.75,
        averageParticipation: 0.8,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 2
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      const engagementMetrics = result?.sessionAnalyticsOverview.engagementMetrics;
      expect(engagementMetrics?.totalParticipants).toBe(3);
      expect(engagementMetrics?.activeGroups).toBe(2);
      expect(engagementMetrics?.averageEngagement).toBe(0.75);
      expect(engagementMetrics?.participationRate).toBe(0.8);
    });

    it('should fall back to database calculation when cache unavailable', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Setup fresh mocks for this test - cache returns null to trigger fallback
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue(null);
      
      // Mock database queries in the exact sequence they'll be called
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics (getExistingAnalytics)
        .mockResolvedValueOnce(mockSessionData) // Session data (fetchSessionData)
        .mockResolvedValueOnce({ // Engagement metrics from DB fallback (computeEngagementMetrics)
          total_participants: 3,
          active_groups: 2,
          avg_engagement: 0.7,
          participation_rate: 0.75
        });

      // Mock other database queries that will be called
      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Group membership data (computeMembershipSummary)
        .mockResolvedValueOnce([]) // Timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce([]); // Group performance data (computeGroupPerformance)

      // Mock other required services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      // Verify cache was checked first and returned null
      expect(mockRealTimeAnalyticsCacheService.getSessionMetrics).toHaveBeenCalledWith(sessionId);
      
      // Verify database fallback was used for engagement metrics
      expect(result?.sessionAnalyticsOverview.engagementMetrics).toEqual({
        totalParticipants: 3,
        activeGroups: 2,
        averageEngagement: 0.7,
        participationRate: 0.75
      });
    });

    it('should handle computation errors gracefully', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Setup mocks to trigger the session not found error
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics (getExistingAnalytics)
        .mockResolvedValueOnce(null); // fetchSessionData returns null -> triggers "Session not found" error

      // Mock logger
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn(); // markComputationFailed will be called

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result).toBeNull();
      expect(mockAnalyticsLogger.logOperation).toHaveBeenCalledWith(
        'analytics_computation_failed',
        'session_analytics',
        expect.any(Number),
        false,
        expect.objectContaining({
          sessionId,
          error: 'Session test-session-123 not found or incomplete',
          metadata: expect.objectContaining({
            computationId: expect.stringMatching(/^analytics_test-session-123_\d+$/),
            processingTimeMs: expect.any(Number)
          })
        })
      );
    });

    it('should persist analytics to database after successful computation', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Set up complete mock sequence for successful computation
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics (getExistingAnalytics)
        .mockResolvedValueOnce(mockSessionData); // Session data (fetchSessionData)

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Group membership data (computeMembershipSummary)
        .mockResolvedValueOnce([]) // Timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce([]); // Group performance data (computeGroupPerformance)

      // Mock cache service (for engagement metrics)
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 3,
        activeGroups: 2,
        averageEngagement: 0.75,
        averageParticipation: 0.8,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 2
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      await service.computeSessionAnalytics(sessionId);

      expect(mockDatabricksService.upsert).toHaveBeenCalledWith(
        'session_analytics',
        { session_id: sessionId, analysis_type: 'final_summary' },
        expect.objectContaining({
          session_id: sessionId,
          analysis_type: 'final_summary',
          analytics_data: expect.any(String),
          computation_metadata: expect.any(String),
          status: 'completed'
        })
      );
    });

    it('should calculate timeline analysis correctly', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Mock session events for timeline - need to set up complete mock sequence
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData); // Session data
        
      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Group membership data (computeMembershipSummary)
        .mockResolvedValueOnce([ // Timeline events (computeTimelineAnalysis)
          {
            event_type: 'session_started',
            event_data: {},
            created_at: '2024-01-01T10:00:00Z'
          },
          {
            event_type: 'group_ready', 
            event_data: { groupName: 'Group A' },
            created_at: '2024-01-01T10:05:00Z'
          }
        ])
        .mockResolvedValueOnce([]); // Group performance data (empty)

      // Mock cache service (for engagement metrics)
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 3,
        activeGroups: 2,
        averageEngagement: 0.75,
        averageParticipation: 0.8,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 2
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      const timeline = result?.sessionAnalyticsOverview.timelineAnalysis;
      expect(timeline?.sessionDuration).toBe(60); // 1 hour in minutes
      expect(timeline?.keyMilestones).toHaveLength(2);
      expect(timeline?.keyMilestones[0].event).toBe('Session Started');
    });

    it('should compute group performance summaries', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Mock group analytics data - this will be returned by computeGroupPerformance
      const mockGroupAnalytics = [
        {
          id: 'group-1',
          name: 'Group A',
          member_count: 2,
          engagement_score: 0.8,
          participation_rate: 0.85,
          first_member_joined: '2024-01-01T10:05:00Z'
        }
      ];

      // Set up complete mock sequence
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics (getExistingAnalytics)
        .mockResolvedValueOnce(mockSessionData); // Session data (fetchSessionData)

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Membership data (computeMembershipSummary)
        .mockResolvedValueOnce([]) // Timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce(mockGroupAnalytics); // Group performance (computeGroupPerformance)

      // Mock cache service (for engagement metrics)
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 3,
        activeGroups: 2,
        averageEngagement: 0.75,
        averageParticipation: 0.8,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 2
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      // Check that groupAnalytics is populated (it comes from groupPerformance)
      expect(result).toBeDefined();
      expect(result?.groupAnalytics).toBeDefined();
      expect(result?.groupAnalytics).toHaveLength(1);
      expect(result?.groupAnalytics[0]).toEqual(
        expect.objectContaining({
          groupId: 'group-1',
          groupName: 'Group A',
          memberCount: 2,
          engagementScore: 0.8,
          participationRate: 0.85,
          readyTime: '2024-01-01T10:05:00Z'
        })
      );
    });
  });

  describe('emitAnalyticsFinalized', () => {
    it('should emit analytics:finalized event via WebSocket', async () => {
      await service.emitAnalyticsFinalized(sessionId);

      expect(mockWebsocketService.emitToSession).toHaveBeenCalledWith(
        sessionId,
        'analytics:finalized',
        {
          sessionId,
          timestamp: expect.any(String)
        }
      );
    });

    it('should handle WebSocket emission errors gracefully', async () => {
      const mockError = new Error('WebSocket error');
      (mockWebsocketService.emitToSession as jest.Mock).mockRejectedValue(mockError);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await service.emitAnalyticsFinalized(sessionId);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to emit analytics:finalized for session ${sessionId}`),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Edge Cases', () => {
    it('should handle sessions with no groups', async () => {
      // Clear all previous mocks  
      jest.clearAllMocks();
      
      // Set up mocks for no groups scenario
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(mockSessionData); // Session data

      mockDatabricksService.query
        .mockResolvedValueOnce([]) // No groups (computeMembershipSummary)
        .mockResolvedValueOnce([]) // No timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce([]); // No group performance data (computeGroupPerformance)

      // Mock cache service with no data
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 0,
        activeGroups: 0,
        averageEngagement: 0,
        averageParticipation: 0,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 0
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result?.sessionAnalyticsOverview.membershipSummary).toEqual(
        expect.objectContaining({
          totalConfiguredMembers: 0,
          totalActualMembers: 0,
          groupsWithLeadersPresent: 0,
          groupsAtFullCapacity: 0,
          averageMembershipAdherence: 0
        })
      );
    });

    it('should handle sessions with incomplete group data', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();

      const incompleteGroupData = [
        {
          id: 'group-1',
          name: 'Group A',
          expected_member_count: null, // Missing expected count
          leader_id: null, // Missing leader
          user_id: 'member-1',
          joined_at: '2024-01-01T10:05:00Z'
        }
      ];

      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics (getExistingAnalytics)
        .mockResolvedValueOnce(mockSessionData); // Session data (fetchSessionData)
      
      mockDatabricksService.query
        .mockResolvedValueOnce(incompleteGroupData) // Incomplete group membership data (computeMembershipSummary)
        .mockResolvedValueOnce([]) // Timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce([]); // Group performance data (computeGroupPerformance)

      // Mock cache service (for engagement metrics)
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 1,
        activeGroups: 1,
        averageEngagement: 0.5,
        averageParticipation: 0.6,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 0
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result).toBeDefined();
      expect(result?.sessionAnalyticsOverview.membershipSummary.totalConfiguredMembers).toBe(0);
      expect(result?.sessionAnalyticsOverview.membershipSummary.groupsWithLeadersPresent).toBe(0);
    });

    it('should handle very long session durations', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      const longSessionData = {
        ...mockSessionData,
        actual_start: '2024-01-01T10:00:00Z',
        actual_end: '2024-01-02T10:00:00Z' // 24 hours
      };

      // Set up complete mock sequence
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics
        .mockResolvedValueOnce(longSessionData); // Long session data

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Group membership data (computeMembershipSummary)
        .mockResolvedValueOnce([]) // Timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce([]); // Group performance data (computeGroupPerformance)

      // Mock cache service
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 3,
        activeGroups: 2,
        averageEngagement: 0.75,
        averageParticipation: 0.8,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 2
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const result = await service.computeSessionAnalytics(sessionId);

      expect(result?.sessionAnalyticsOverview.timelineAnalysis.sessionDuration).toBe(1440); // 24 hours in minutes
    });
  });

  describe('Performance', () => {
    it('should complete analytics computation within timeout', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Set up complete mock sequence for performance test
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics (getExistingAnalytics)
        .mockResolvedValueOnce(mockSessionData); // Session data (fetchSessionData)

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Group membership data (computeMembershipSummary)
        .mockResolvedValueOnce([]) // Timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce([]); // Group performance data (computeGroupPerformance)

      // Mock cache service (for engagement metrics)
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 3,
        activeGroups: 2,
        averageEngagement: 0.75,
        averageParticipation: 0.8,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 2
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      const startTime = Date.now();
      
      await service.computeSessionAnalytics(sessionId);
      
      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
    });

    it('should log performance metrics', async () => {
      // Clear all previous mocks
      jest.clearAllMocks();
      
      // Set up complete mock sequence for performance test
      mockDatabricksService.queryOne
        .mockResolvedValueOnce(null) // No existing analytics (getExistingAnalytics)
        .mockResolvedValueOnce(mockSessionData); // Session data (fetchSessionData)

      mockDatabricksService.query
        .mockResolvedValueOnce(mockGroupsData) // Group membership data (computeMembershipSummary)
        .mockResolvedValueOnce([]) // Timeline events (computeTimelineAnalysis)
        .mockResolvedValueOnce([]); // Group performance data (computeGroupPerformance)

      // Mock cache service (for engagement metrics)
      mockRealTimeAnalyticsCacheService.getSessionMetrics.mockResolvedValue({
        sessionId,
        totalParticipants: 3,
        activeGroups: 2,
        averageEngagement: 0.75,
        averageParticipation: 0.8,
        alertsActive: [],
        lastUpdate: '2024-01-01T11:00:00Z',
        calculatedAt: '2024-01-01T11:00:00Z',
        readyGroups: 2
      });

      // Mock other services
      mockAnalyticsLogger.logOperation = jest.fn();
      mockDatabricksService.upsert = jest.fn().mockResolvedValue(undefined);

      await service.computeSessionAnalytics(sessionId);

      expect(mockAnalyticsLogger.logOperation).toHaveBeenCalledWith(
        'analytics_computation_completed',
        'session_analytics',
        expect.any(Number),
        true,
        expect.objectContaining({
          sessionId,
          metadata: expect.objectContaining({
            computationId: expect.stringMatching(/^analytics_test-session-123_\d+$/),
            processingTimeMs: expect.any(Number),
            version: '2.0'
          })
        })
      );
    });
  });
});
