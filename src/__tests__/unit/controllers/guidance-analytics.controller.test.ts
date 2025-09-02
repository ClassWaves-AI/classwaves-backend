/**
 * Unit tests for Guidance Analytics REST controllers
 * Focus: ai_insights alignment, safe defaults on empty data, and audit logging
 */

import { Request, Response } from 'express';

// Mock external services used by the controller
jest.mock('../../../services/databricks.service');
jest.mock('../../../services/analytics-query-router.service', () => ({
  analyticsQueryRouterService: {
    routeTeacherAnalyticsQuery: jest.fn().mockResolvedValue(undefined),
    routeSessionAnalyticsQuery: jest.fn().mockResolvedValue(undefined),
  }
}));
jest.mock('../../../services/query-cache.service', () => ({
  queryCacheService: {
    getCachedQuery: jest.fn((cacheKey: string, _type: string, fetcher: any) => fetcher()),
  }
}));
jest.mock('../../../services/recommendation-engine.service', () => ({
  recommendationEngineService: {
    getTeacherRecommendationStats: jest.fn().mockResolvedValue({
      totalGenerated: 0,
      totalUsed: 0,
      averageRating: 0,
      topCategories: [],
      improvementTrends: {}
    })
  }
}));
jest.mock('../../../services/alert-prioritization.service', () => ({
  alertPrioritizationService: {
    getAlertStatistics: jest.fn().mockResolvedValue({
      totalPending: 0,
      byPriority: {},
      byCategory: {},
      averageResponseTime: 0,
      deliveryRate: 0
    })
  }
}));

import { databricksService } from '../../../services/databricks.service';
import { getTeacherAnalytics, getSessionAnalytics, getEffectivenessReport } from '../../../controllers/guidance-analytics.controller';

const mockDb = databricksService as jest.Mocked<typeof databricksService>;

function createRes(): Partial<Response> {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('Guidance Analytics Controller', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /analytics/teacher → getTeacherAnalytics', () => {
    it('returns safe defaults when ai_insights has no rows and logs audit', async () => {
      const req = {
        params: {},
        query: { timeframe: 'weekly', includeComparisons: false, includeRecommendations: true },
        user: { id: 'teacher-1', role: 'teacher' },
        school: { id: 'school-1' }
      } as unknown as Request;

      const res = createRes();
      mockDb.recordAuditLog.mockResolvedValue();

      await getTeacherAnalytics(req as any, res as Response);

      // Assert response
      expect(res!.status as any).not.toHaveBeenCalledWith(500);
      expect(res!.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        analytics: expect.objectContaining({
          teacherId: 'teacher-1',
          promptMetrics: expect.objectContaining({
            totalGenerated: 0,
            totalAcknowledged: 0,
            totalUsed: 0,
            totalDismissed: 0,
            acknowledgmentRate: 0,
            usageRate: 0
          })
        })
      }));

      // Audit log recorded via canonical API
      expect(mockDb.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'teacher-1',
        eventType: 'teacher_analytics_access',
        eventCategory: 'data_access',
        resourceType: 'teacher_analytics',
        schoolId: 'school-1'
      }));
    });

    it('denies access when requesting another teacher without admin role', async () => {
      const req = {
        params: { teacherId: 'someone-else' },
        query: { timeframe: 'weekly', includeComparisons: false, includeRecommendations: true },
        user: { id: 'teacher-1', role: 'teacher' },
        school: { id: 'school-1' }
      } as unknown as Request;
      const res = createRes();

      await getTeacherAnalytics(req as any, res as Response);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'UNAUTHORIZED' }));
    });
  });

  describe('GET /analytics/session/:sessionId → getSessionAnalytics', () => {
    it('returns analytics with defaults and respects includeRealtimeMetrics param', async () => {
      // Mock session ownership check
      mockDb.query.mockResolvedValueOnce([
        { teacher_id: 'teacher-1', topic: 'Algebra', scheduled_start: new Date().toISOString(), actual_end: null, status: 'active' }
      ]);

      const req = {
        params: { sessionId: 'session-1' },
        query: { includeGroupBreakdown: true, includeRealtimeMetrics: false },
        user: { id: 'teacher-1', role: 'teacher' },
        school: { id: 'school-1' },
        method: 'GET',
        route: { path: '/analytics/session/:sessionId' }
      } as unknown as Request;
      const res = createRes();

      mockDb.recordAuditLog.mockResolvedValue();

      await getSessionAnalytics(req as any, res as Response);

      expect(res.status).not.toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        analytics: expect.objectContaining({
          sessionId: 'session-1',
          overview: expect.any(Object),
          guidanceActivity: expect.any(Object),
          aiAnalysis: expect.any(Object),
          timeline: expect.any(Array),
          successMetrics: expect.any(Object)
        })
      }));

      // Ensure audit logging is invoked within the analytics operation wrapper
      expect(mockDb.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'teacher-1',
        eventType: 'session_analytics_access',
        resourceType: 'session_metrics',
        resourceId: 'session-1',
      }));
    });
  });

  describe('GET /analytics/effectiveness → getEffectivenessReport', () => {
    it('returns report and logs audit access', async () => {
      const req = {
        query: { timeframe: 'month', includeSuccessStories: false },
        user: { id: 'teacher-1', role: 'teacher' },
        school: { id: 'school-1' }
      } as unknown as Request;
      const res = createRes();

      mockDb.recordAuditLog.mockResolvedValue();

      await getEffectivenessReport(req as any, res as Response);

      expect(res.status).not.toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        success: true,
        report: expect.any(Object),
        processingTime: expect.any(Number)
      }));

      expect(mockDb.recordAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'teacher-1',
        eventType: 'effectiveness_report_access',
        eventCategory: 'data_access',
        resourceType: 'effectiveness_report',
        schoolId: 'school-1'
      }));
    });
  });
});
