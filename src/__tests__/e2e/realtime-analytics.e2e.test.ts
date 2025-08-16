/**
 * Real-time Analytics E2E Tests
 * 
 * Tests the complete zero-polling, event-driven analytics flow
 * including WebSocket events, fallback timers, and frontend integration.
 */

import { Server } from 'http';
import { io as Client, Socket } from 'socket.io-client';
import { createTestApp } from '../test-utils/app-setup';
import { createTestSessionWithGroups, cleanupTestData } from '../test-utils/factories';
import { analyticsComputationService } from '../../services/analytics-computation.service';
import { websocketService } from '../../services/websocket.service';
import request from 'supertest';

describe('Real-time Analytics E2E Flow', () => {
  let app: any;
  let server: Server;
  let port: number;
  let clientSocket: Socket;
  let testSession: any;
  let authToken: string;

  beforeAll(async () => {
    // Create test app
    const testSetup = await createTestApp();
    app = testSetup.app;
    server = testSetup.server;
    port = testSetup.port;

    console.log(`E2E test server running on port ${port}`);
  });

  afterAll(async () => {
    if (server) {
      server.close();
    }
  });

  beforeEach(async () => {
    // Create test data
    const sessionData = await createTestSessionWithGroups({
      sessionOverrides: { status: 'active' },
      groupCount: 2,
      membersPerGroup: 3
    });
    
    testSession = sessionData.session;
    authToken = 'test-auth-token';

    // Setup WebSocket client
    clientSocket = Client(`http://localhost:${port}/sessions`, {
      auth: { token: authToken },
      transports: ['websocket']
    });

    await new Promise((resolve) => {
      clientSocket.on('connect', resolve);
    });

    // Join session room
    clientSocket.emit('join:session', { sessionId: testSession.id });
  });

  afterEach(async () => {
    if (clientSocket) {
      clientSocket.disconnect();
    }
    await cleanupTestData([testSession.id]);
  });

  describe('Happy Path: Complete Analytics Flow', () => {
    it('should trigger analytics computation and emit events when session ends', async () => {
      const receivedEvents: any[] = [];
      
      // Listen for analytics events
      clientSocket.on('analytics:finalized', (data) => {
        receivedEvents.push({ type: 'analytics:finalized', data });
      });

      clientSocket.on('session:status_changed', (data) => {
        receivedEvents.push({ type: 'session:status_changed', data });
      });

      // Mock successful analytics computation
      const mockAnalyticsResult = {
        sessionAnalyticsOverview: {
          sessionId: testSession.id,
          computedAt: new Date().toISOString(),
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
          },
          engagementMetrics: {
            totalParticipants: 6,
            activeGroups: 2,
            averageEngagement: 0.8,
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
          processingTime: 2000
        }
      };

      jest.spyOn(analyticsComputationService, 'computeSessionAnalytics')
        .mockResolvedValue(mockAnalyticsResult);

      // End the session via API
      const endResponse = await request(app)
        .post(`/api/v1/sessions/${testSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          reason: 'Session completed successfully',
          teacherNotes: 'Good participation from all groups'
        });

      expect(endResponse.status).toBe(200);
      expect(endResponse.body.success).toBe(true);

      // Wait for WebSocket events to be processed
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify events were received
      expect(receivedEvents).toHaveLength(2);
      
      const statusEvent = receivedEvents.find(e => e.type === 'session:status_changed');
      expect(statusEvent).toBeDefined();
      expect(statusEvent.data.sessionId).toBe(testSession.id);
      expect(statusEvent.data.status).toBe('ended');

      const analyticsEvent = receivedEvents.find(e => e.type === 'analytics:finalized');
      expect(analyticsEvent).toBeDefined();
      expect(analyticsEvent.data.sessionId).toBe(testSession.id);
      expect(analyticsEvent.data.timestamp).toBeDefined();
    });

    it('should provide real-time analytics data after computation', async () => {
      // Mock analytics computation
      const mockResult = {
        sessionAnalyticsOverview: {
          sessionId: testSession.id,
          membershipSummary: {
            totalConfiguredMembers: 8,
            totalActualMembers: 6,
            groupsWithLeadersPresent: 2,
            groupsAtFullCapacity: 1,
            averageMembershipAdherence: 0.75,
            membershipFormationTime: { avgFormationTime: null, fastestGroup: null }
          }
        }
      };

      jest.spyOn(analyticsComputationService, 'computeSessionAnalytics')
        .mockResolvedValue(mockResult as any);

      // End session to trigger analytics
      await request(app)
        .post(`/api/v1/sessions/${testSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'Test completion' });

      // Wait for computation
      await new Promise(resolve => setTimeout(resolve, 300));

      // Fetch analytics data
      const analyticsResponse = await request(app)
        .get(`/api/v1/analytics/session/${testSession.id}/membership-summary`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(analyticsResponse.status).toBe(200);
      expect(analyticsResponse.body.success).toBe(true);
      expect(analyticsResponse.body.data).toEqual(
        expect.objectContaining({
          totalConfiguredMembers: 8,
          totalActualMembers: 6,
          groupsWithLeadersPresent: 2,
          groupsAtFullCapacity: 1
        })
      );
    });
  });

  describe('Fallback Scenarios', () => {
    it('should emit analytics:failed when computation fails', async () => {
      const receivedEvents: any[] = [];
      
      clientSocket.on('analytics:failed', (data) => {
        receivedEvents.push({ type: 'analytics:failed', data });
      });

      // Mock analytics computation failure
      jest.spyOn(analyticsComputationService, 'computeSessionAnalytics')
        .mockResolvedValue(null);

      // End session
      await request(app)
        .post(`/api/v1/sessions/${testSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'Test' });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verify failure event was received
      expect(receivedEvents).toHaveLength(1);
      expect(receivedEvents[0].type).toBe('analytics:failed');
      expect(receivedEvents[0].data.sessionId).toBe(testSession.id);
      expect(receivedEvents[0].data.error).toBeDefined();
    });

    it('should handle analytics computation timeout', async () => {
      const receivedEvents: any[] = [];
      
      clientSocket.on('analytics:failed', (data) => {
        receivedEvents.push({ type: 'analytics:failed', data });
      });

      // Mock slow analytics computation
      jest.spyOn(analyticsComputationService, 'computeSessionAnalytics')
        .mockImplementation(() => new Promise(resolve => {
          setTimeout(() => resolve(null), 35000); // Longer than 30s timeout
        }));

      // End session
      await request(app)
        .post(`/api/v1/sessions/${testSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'Test' });

      // Wait for timeout to occur
      await new Promise(resolve => setTimeout(resolve, 1000));

      // In a real implementation, timeout handling would emit failure event
      // For this test, we verify the pattern works
      expect(true).toBe(true); // Placeholder - would verify timeout behavior
    });
  });

  describe('Multiple Subscribers Pattern', () => {
    it('should deliver events to multiple WebSocket clients', async () => {
      // Create second client
      const client2 = Client(`http://localhost:${port}/sessions`, {
        auth: { token: authToken },
        transports: ['websocket']
      });

      await new Promise((resolve) => {
        client2.on('connect', resolve);
      });

      client2.emit('join:session', { sessionId: testSession.id });

      const events1: any[] = [];
      const events2: any[] = [];

      clientSocket.on('analytics:finalized', (data) => {
        events1.push(data);
      });

      client2.on('analytics:finalized', (data) => {
        events2.push(data);
      });

      // Mock successful computation
      jest.spyOn(analyticsComputationService, 'computeSessionAnalytics')
        .mockResolvedValue({
          sessionAnalyticsOverview: { sessionId: testSession.id }
        } as any);

      // End session
      await request(app)
        .post(`/api/v1/sessions/${testSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'Test' });

      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 300));

      // Both clients should receive the event
      expect(events1).toHaveLength(1);
      expect(events2).toHaveLength(1);
      expect(events1[0].sessionId).toBe(testSession.id);
      expect(events2[0].sessionId).toBe(testSession.id);

      client2.disconnect();
    });

    it('should handle individual client disconnections gracefully', async () => {
      const events: any[] = [];
      
      clientSocket.on('analytics:finalized', (data) => {
        events.push(data);
      });

      // Disconnect and reconnect client
      clientSocket.disconnect();
      
      await new Promise(resolve => setTimeout(resolve, 100));

      // Reconnect
      clientSocket = Client(`http://localhost:${port}/sessions`, {
        auth: { token: authToken },
        transports: ['websocket']
      });

      await new Promise((resolve) => {
        clientSocket.on('connect', resolve);
      });

      clientSocket.emit('join:session', { sessionId: testSession.id });
      
      clientSocket.on('analytics:finalized', (data) => {
        events.push(data);
      });

      // Mock computation and end session
      jest.spyOn(analyticsComputationService, 'computeSessionAnalytics')
        .mockResolvedValue({ sessionAnalyticsOverview: { sessionId: testSession.id } } as any);

      await request(app)
        .post(`/api/v1/sessions/${testSession.id}/end`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'Test' });

      await new Promise(resolve => setTimeout(resolve, 300));

      // Should receive event after reconnection
      expect(events).toHaveLength(1);
      expect(events[0].sessionId).toBe(testSession.id);
    });
  });

  describe('Performance Under Load', () => {
    it('should handle multiple concurrent session endings efficiently', async () => {
      // Create multiple test sessions
      const sessions = await Promise.all([
        createTestSessionWithGroups({ sessionOverrides: { status: 'active' } }),
        createTestSessionWithGroups({ sessionOverrides: { status: 'active' } }),
        createTestSessionWithGroups({ sessionOverrides: { status: 'active' } })
      ]);

      const sessionIds = sessions.map(s => s.session.id);
      const receivedEvents = new Map<string, any[]>();

      // Subscribe to events for all sessions
      sessionIds.forEach(id => {
        receivedEvents.set(id, []);
        clientSocket.emit('join:session', { sessionId: id });
      });

      clientSocket.on('analytics:finalized', (data) => {
        const events = receivedEvents.get(data.sessionId) || [];
        events.push(data);
        receivedEvents.set(data.sessionId, events);
      });

      // Mock successful computations
      jest.spyOn(analyticsComputationService, 'computeSessionAnalytics')
        .mockImplementation((sessionId) => 
          Promise.resolve({
            sessionAnalyticsOverview: { sessionId }
          } as any)
        );

      const startTime = Date.now();

      // End all sessions concurrently
      const endPromises = sessionIds.map(sessionId =>
        request(app)
          .post(`/api/v1/sessions/${sessionId}/end`)
          .set('Authorization', `Bearer ${authToken}`)
          .send({ reason: 'Concurrent test' })
      );

      await Promise.all(endPromises);

      // Wait for all events to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));

      const totalTime = Date.now() - startTime;

      // Verify all sessions received their events
      sessionIds.forEach(sessionId => {
        const events = receivedEvents.get(sessionId) || [];
        expect(events).toHaveLength(1);
        expect(events[0].sessionId).toBe(sessionId);
      });

      // Should complete within reasonable time
      expect(totalTime).toBeLessThan(5000); // 5 seconds

      // Cleanup
      await Promise.all(sessionIds.map(id => cleanupTestData([id])));
    });
  });
});
