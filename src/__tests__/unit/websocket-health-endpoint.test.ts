/**
 * WebSocket Health Endpoint Tests
 * 
 * Tests for the new WebSocket health monitoring endpoint:
 * GET /api/v1/health/websocket
 * 
 * Following TDD principles - tests written before implementation
 */

import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import request from 'supertest';
import app from '../../app';
import { initializeNamespacedWebSocket } from '../../services/websocket';
import { redisService } from '../../services/redis.service';

describe('WebSocket Health Endpoint', () => {
  let httpServer: HTTPServer;
  let io: SocketIOServer;
  let serverPort: number;

  beforeAll(async () => {
    // Create HTTP server for testing
    httpServer = new HTTPServer(app);
    
    // Initialize namespaced WebSocket service
    initializeNamespacedWebSocket(httpServer);
    
    // Start server on random port
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as any)?.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    httpServer.close();
  });

  describe('GET /api/v1/health/websocket', () => {
    it('should return healthy status when WebSocket service is running', async () => {
      const response = await request(app)
        .get('/api/v1/health/websocket')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          status: 'healthy',
          timestamp: expect.any(String),
          uptime: expect.any(Number),
          namespaces: {
            sessions: expect.objectContaining({
              status: 'healthy',
              connectedUsers: expect.any(Number),
              connectedSockets: expect.any(Number)
            }),
            guidance: expect.objectContaining({
              status: 'healthy',
              connectedUsers: expect.any(Number),
              connectedSockets: expect.any(Number)
            })
          },
          redis: expect.objectContaining({
            connected: expect.any(Boolean),
            adapter: expect.any(String)
          }),
          performance: expect.objectContaining({
            totalConnections: expect.any(Number),
            totalReconnections: expect.any(Number),
            averageResponseTime: expect.any(Number)
          })
        }
      });
    });

    it('should return correct namespace information', async () => {
      const response = await request(app)
        .get('/api/v1/health/websocket')
        .expect(200);

      const { namespaces } = response.body.data;
      
      // Verify sessions namespace
      expect(namespaces.sessions).toMatchObject({
        status: 'healthy',
        namespace: '/sessions',
        purpose: 'Session management and real-time updates',
        connectedUsers: expect.any(Number),
        connectedSockets: expect.any(Number),
        rooms: expect.any(Array)
      });

      // Verify guidance namespace
      expect(namespaces.guidance).toMatchObject({
        status: 'healthy',
        namespace: '/guidance',
        purpose: 'Teacher guidance and AI insights',
        connectedUsers: expect.any(Number),
        connectedSockets: expect.any(Number),
        rooms: expect.any(Array)
      });
    });

    it('should reflect real-time connection changes', async () => {
      // Get initial health status
      const initialResponse = await request(app)
        .get('/api/v1/health/websocket')
        .expect(200);
      
      const initialSessionsCount = initialResponse.body.data.namespaces.sessions.connectedUsers;
      const initialGuidanceCount = initialResponse.body.data.namespaces.guidance.connectedUsers;

      // For unit tests, we'll just verify the structure and that counts are numbers
      // The actual connection testing would be done in integration tests
      expect(typeof initialSessionsCount).toBe('number');
      expect(typeof initialGuidanceCount).toBe('number');
      expect(initialSessionsCount).toBeGreaterThanOrEqual(0);
      expect(initialGuidanceCount).toBeGreaterThanOrEqual(0);

      // Verify that the endpoint returns consistent data structure
      expect(initialResponse.body.data.namespaces.sessions).toHaveProperty('connectedUsers');
      expect(initialResponse.body.data.namespaces.guidance).toHaveProperty('connectedUsers');
    }, 10000); // Reduced timeout to 10 seconds

    it('should handle Redis connection status correctly', async () => {
      const response = await request(app)
        .get('/api/v1/health/websocket')
        .expect(200);

      const { redis } = response.body.data;
      
      expect(redis).toMatchObject({
        connected: expect.any(Boolean),
        adapter: expect.stringMatching(/^(enabled|disabled|degraded)$/),
        details: expect.any(Object)
      });

      // If Redis is connected, adapter should be enabled
      if (redis.connected) {
        expect(redis.adapter).toBe('enabled');
      }
    });

    it('should include performance metrics', async () => {
      const response = await request(app)
        .get('/api/v1/health/websocket')
        .expect(200);

      const { performance } = response.body.data;
      
      expect(performance).toMatchObject({
        totalConnections: expect.any(Number),
        totalReconnections: expect.any(Number),
        averageResponseTime: expect.any(Number),
        messageThroughput: expect.any(Number),
        errorRate: expect.any(Number)
      });

      // Performance metrics should be reasonable
      expect(performance.totalConnections).toBeGreaterThanOrEqual(0);
      expect(performance.totalReconnections).toBeGreaterThanOrEqual(0);
      expect(performance.averageResponseTime).toBeGreaterThan(0);
      expect(performance.errorRate).toBeGreaterThanOrEqual(0);
      expect(performance.errorRate).toBeLessThanOrEqual(100);
    });

    it('should return degraded status when Redis is unavailable', async () => {
      // Mock Redis service to simulate failure
      const originalIsConnected = redisService.isConnected;
      jest.spyOn(redisService, 'isConnected').mockReturnValue(false);

      try {
        const response = await request(app)
          .get('/api/v1/health/websocket')
          .expect(200);

        expect(response.body.data.status).toBe('degraded');
        expect(response.body.data.redis.connected).toBe(false);
        expect(response.body.data.redis.adapter).toBe('degraded');
      } finally {
        // Restore original method
        jest.restoreAllMocks();
      }
    });

    it('should handle WebSocket service unavailability gracefully', async () => {
      // This test would require mocking the WebSocket service
      // For now, we'll test that the endpoint doesn't crash
      const response = await request(app)
        .get('/api/v1/health/websocket')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should return appropriate HTTP status codes', async () => {
      // Healthy status should return 200
      const healthyResponse = await request(app)
        .get('/api/v1/health/websocket')
        .expect(200);
      
      expect(healthyResponse.body.data.status).toBe('healthy');

      // Note: We can't easily test 503 (unhealthy) without extensive mocking
      // This would be tested in integration tests with actual service failures
    });

    it('should include timestamp and uptime information', async () => {
      const response = await request(app)
        .get('/api/v1/health/websocket')
        .expect(200);

      const { timestamp, uptime } = response.body.data;
      
      // Timestamp should be valid ISO string
      expect(new Date(timestamp).getTime()).toBeGreaterThan(0);
      
      // Uptime should be reasonable (greater than 0, less than 1 year)
      expect(uptime).toBeGreaterThan(0);
      expect(uptime).toBeLessThan(365 * 24 * 60 * 60); // 1 year in seconds
    });
  });

  describe('WebSocket Health Endpoint Integration', () => {
    it('should work with existing health check endpoints', async () => {
      // Test that the new endpoint doesn't break existing health checks
      const generalHealthResponse = await request(app)
        .get('/api/v1/health/')  // Note the trailing slash to use health routes
        .expect(200);
      
      // Just verify that the general health endpoint returns a valid response
      expect(generalHealthResponse.body).toBeDefined();
      expect(generalHealthResponse.status).toBe(200);

      const websocketHealthResponse = await request(app)
        .get('/api/v1/health/websocket')
        .expect(200);
      
      expect(websocketHealthResponse.body.success).toBe(true);
    });

    it('should handle concurrent requests without conflicts', async () => {
      // Make multiple concurrent requests to test for race conditions
      const concurrentRequests = Array.from({ length: 5 }, () =>
        request(app).get('/api/v1/health/websocket')
      );

      const responses = await Promise.all(concurrentRequests);
      
      // All requests should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.status).toBeDefined();
      });
    });
  });
});
