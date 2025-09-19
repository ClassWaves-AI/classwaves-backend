/**
 * Session Analytics Integration Tests
 * 
 * Tests the complete flow from session end to analytics computation,
 * WebSocket event emission, and API endpoint responses.
 */

import request from 'supertest';
import { Server } from 'http';
import { createTestApp } from '../test-utils/app-setup';
import { createTestSession, createTestTeacher, createTestSchool } from '../test-utils/factories';
import { databricksService } from '../../services/databricks.service';
import { auditLogPort } from '../../utils/audit.port.instance';
import { websocketService } from '../../services/websocket';
import { analyticsComputationService } from '../../services/analytics-computation.service';
import { AuthRequest } from '../../types/auth.types';
import { afterAllWithCleanup } from '../../test/test-cleanup';

// Mock WebSocket service to capture events
jest.mock('../../services/websocket', () => ({
  websocketService: {
    endSession: jest.fn(),
    notifySessionUpdate: jest.fn(),
    emitToSession: jest.fn(),
    io: null
  }
}));

const mockWebsocketService = websocketService as jest.Mocked<typeof websocketService>;

// Mock audit port (port-based audit logging)
jest.mock('../../utils/audit.port.instance', () => ({
  auditLogPort: { enqueue: jest.fn().mockResolvedValue(undefined) }
}));

describe('Session Analytics Integration', () => {
  let server: Server;
  let app: any;
  let authToken: string;
  let testTeacher: any;
  let testSchool: any;
  let testSession: any;

  beforeAll(async () => {
    const testSetup = await createTestApp();
    app = testSetup.app;
    server = testSetup.server;
  });

  afterAll(afterAllWithCleanup(async () => {
    // Close HTTP server
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => {
          console.log('✅ Test server closed');
          resolve();
        });
      });
    }
  }));

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Create test data
    testSchool = await createTestSchool();
    testTeacher = await createTestTeacher({ school_id: testSchool.id });
    testSession = await createTestSession({
      teacher_id: testTeacher.id,
      school_id: testSchool.id,
      status: 'active'
    });

    // Create auth token
    authToken = 'test-auth-token';
  });

  describe('POST /api/v1/sessions/:id/end', () => {
    it('should trigger analytics computation and emit events on session end', async () => {
      // Mock analytics computation success
      const mockAnalyticsResult = {
        sessionAnalyticsOverview: {
          sessionId: testSession.id,
          computedAt: new Date().toISOString(),
          membershipSummary: {
            totalConfiguredMembers: 6,
            totalActualMembers: 4,
            groupsWithLeadersPresent: 2,
            groupsAtFullCapacity: 1,
            averageMembershipAdherence: 0.67,
            membershipFormationTime: {
              avgFormationTime: 45000,
              fastestGroup: {
                name: 'Group A',
                first_member_joined: '2024-01-01T10:05:00Z',
                last_member_joined: '2024-01-01T10:06:30Z'
              }
            }
          },
          engagementMetrics: {
            totalParticipants: 4,
            activeGroups: 2,
            averageEngagement: 0.78,
            participationRate: 0.85
          },
          timelineAnalysis: {
            sessionDuration: 45,
            groupFormationTime: 5,
            activeParticipationTime: 40,
            keyMilestones: []
          },
          groupPerformance: []
        },
        groupAnalytics: [],
        computationMetadata: {
          computedAt: new Date(),
          version: '2.0',
          status: 'completed' as const,
          processingTime: 1500
        }
      };

      const computeSpy = jest.spyOn(analyticsComputationService, 'computeSessionAnalytics')
        .mockResolvedValue(mockAnalyticsResult);
      
      const emitSpy = jest.spyOn(analyticsComputationService, 'emitAnalyticsFinalized')
        .mockResolvedValue();

      const response = await request(app)
        .post(`/api/v1/sessions/${testSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reason: 'Completed successfully',
          teacherNotes: 'Great session with good participation'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify WebSocket notifications were called
      expect(mockWebsocketService.endSession).toHaveBeenCalledWith(testSession.id);
      expect(mockWebsocketService.notifySessionUpdate).toHaveBeenCalledWith(
        testSession.id,
        { type: 'session_ended', sessionId: testSession.id }
      );

      // Wait for async analytics computation to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify analytics computation was triggered
      expect(computeSpy).toHaveBeenCalledWith(testSession.id);
      expect(emitSpy).toHaveBeenCalledWith(testSession.id);
    });

    it('should emit error event when analytics computation fails', async () => {
      jest.spyOn(analyticsComputationService, 'computeSessionAnalytics')
        .mockResolvedValue(null);

      const response = await request(app)
        .post(`/api/v1/sessions/${testSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'Completed' });

      expect(response.status).toBe(200);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should emit analytics:failed event
      expect(mockWebsocketService.emitToSession).toHaveBeenCalledWith(
        testSession.id,
        'analytics:failed',
        expect.objectContaining({
          sessionId: testSession.id,
          error: 'Analytics computation failed'
        })
      );
    });

    it('should handle analytics computation errors gracefully', async () => {
      jest.spyOn(analyticsComputationService, 'computeSessionAnalytics')
        .mockRejectedValue(new Error('Database timeout'));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const response = await request(app)
        .post(`/api/v1/sessions/${testSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'Completed' });

      expect(response.status).toBe(200);

      // Wait for async processing
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockWebsocketService.emitToSession).toHaveBeenCalledWith(
        testSession.id,
        'analytics:failed',
        expect.objectContaining({
          error: 'Database timeout'
        })
      );

      consoleSpy.mockRestore();
    });
  });

  describe('GET /api/v1/analytics/session/:sessionId/membership-summary', () => {
    beforeEach(async () => {
      // Set up session with computed analytics
      await databricksService.upsert('session_analytics', 
        { session_id: testSession.id, analysis_type: 'final_summary' },
        {
          session_id: testSession.id,
          analysis_type: 'final_summary',
          analytics_data: JSON.stringify({
            sessionId: testSession.id,
            membershipSummary: {
              totalConfiguredMembers: 8,
              totalActualMembers: 6,
              groupsWithLeadersPresent: 2,
              groupsAtFullCapacity: 1,
              averageMembershipAdherence: 0.75,
              membershipFormationTime: {
                avgFormationTime: 30000,
                fastestGroup: {
                  name: 'Group A',
                  first_member_joined: '2024-01-01T10:05:00Z',
                  last_member_joined: '2024-01-01T10:05:30Z'
                }
              }
            }
          }),
          status: 'completed',
          computed_at: new Date()
        }
      );
    });

    it('should return computed membership summary with proper authorization', async () => {
      const response = await request(app)
        .get(`/api/v1/analytics/session/${testSession.id}/membership-summary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(
        expect.objectContaining({
          groupsAtFullCapacity: 1,
          groupsWithLeadersPresent: 2,
          averageMembershipAdherence: 0.75,
          totalConfiguredMembers: 8,
          totalActualMembers: 6
        })
      );
    });

    it('should reject unauthorized access to other teachers\' sessions', async () => {
      const otherTeacher = await createTestTeacher({ school_id: testSchool.id });
      const otherSession = await createTestSession({
        teacher_id: otherTeacher.id,
        school_id: testSchool.id
      });

      const response = await request(app)
        .get(`/api/v1/analytics/session/${otherSession.id}/membership-summary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(403);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('SESSION_ACCESS_DENIED');
    });

    it('should prevent cross-school access', async () => {
      const otherSchool = await createTestSchool();
      const otherTeacher = await createTestTeacher({ school_id: otherSchool.id });
      const crossSchoolSession = await createTestSession({
        teacher_id: otherTeacher.id,
        school_id: otherSchool.id
      });

      const response = await request(app)
        .get(`/api/v1/analytics/session/${crossSchoolSession.id}/membership-summary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('CROSS_SCHOOL_ACCESS_DENIED');
    });

    it('should allow admin access to sessions in same school', async () => {
      const adminTeacher = await createTestTeacher({ 
        school_id: testSchool.id,
        role: 'admin'
      });
      
      // Create admin auth token
      const adminToken = 'admin-auth-token';

      const response = await request(app)
        .get(`/api/v1/analytics/session/${testSession.id}/membership-summary`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent sessions', async () => {
      const response = await request(app)
        .get('/api/v1/analytics/session/non-existent-session/membership-summary')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('SESSION_NOT_FOUND');
    });

    it('should return partial data when analytics not yet computed', async () => {
      const newSession = await createTestSession({
        teacher_id: testTeacher.id,
        school_id: testSchool.id,
        status: 'ended'
      });

      // Set up basic group structure for partial calculation
      await databricksService.insert('student_groups', {
        id: 'group-1',
        session_id: newSession.id,
        name: 'Group A',
        max_size: 4,
        leader_id: 'leader-1'
      });

      const response = await request(app)
        .get(`/api/v1/analytics/session/${newSession.id}/membership-summary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.metadata.partial).toBe(true);
      expect(response.body.metadata.computed).toBe(false);
    });

    it('should log analytics access for compliance', async () => {
      const enqueueSpy = jest.spyOn(auditLogPort, 'enqueue').mockResolvedValue();

      await request(app)
        .get(`/api/v1/analytics/session/${testSession.id}/membership-summary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(enqueueSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'analytics_access',
          resourceType: 'session_analytics',
          resourceId: testSession.id,
          complianceBasis: 'legitimate_interest',
          dataAccessed: 'membership_analytics'
        })
      );
    });
  });

  describe('Rate Limiting and Security', () => {
    it('should apply rate limiting to analytics endpoints', async () => {
      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .get(`/api/v1/analytics/session/${testSession.id}/membership-summary`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      const responses = await Promise.all(requests);
      
      // Some requests should be rate limited (depends on configuration)
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });

    it('should require authentication for all analytics endpoints', async () => {
      const response = await request(app)
        .get(`/api/v1/analytics/session/${testSession.id}/membership-summary`);

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('UNAUTHORIZED');
    });

    it('should validate session ID format', async () => {
      const response = await request(app)
        .get('/api/v1/analytics/session/invalid-session-id/membership-summary')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(400);
    });
  });

  describe('Performance', () => {
    it('should respond within acceptable time limits', async () => {
      const startTime = Date.now();
      
      const response = await request(app)
        .get(`/api/v1/analytics/session/${testSession.id}/membership-summary`)
        .set('Authorization', `Bearer ${authToken}`);

      const duration = Date.now() - startTime;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(5000); // Should respond within 5 seconds
    });

    it('should handle concurrent requests efficiently', async () => {
      const concurrentRequests = Array.from({ length: 5 }, () =>
        request(app)
          .get(`/api/v1/analytics/session/${testSession.id}/membership-summary`)
          .set('Authorization', `Bearer ${authToken}`)
      );

      const startTime = Date.now();
      const responses = await Promise.all(concurrentRequests);
      const duration = Date.now() - startTime;

      expect(responses.every(r => r.status === 200)).toBe(true);
      expect(duration).toBeLessThan(10000); // All requests within 10 seconds
    });
  });
});
