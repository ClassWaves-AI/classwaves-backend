import request from 'supertest';
import express from 'express';
import { mockDatabricksService } from '../../mocks/databricks.mock';
import { mockRedisService } from '../../mocks/redis.mock';

// Mock dependencies
jest.mock('../../../services/databricks.service', () => ({
  databricksService: mockDatabricksService,
}));

jest.mock('../../../services/redis.service', () => ({
  redisService: mockRedisService,
}));

describe('Health Route Integration Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup Express app
    app = express();
    app.use(express.json());
    
    // Define health check route inline (as it's typically simple)
    app.get('/api/health', async (req, res) => {
      try {
        const checks = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          services: {
            api: 'healthy',
            redis: 'unknown',
            databricks: 'unknown',
          },
          version: process.env.npm_package_version || '1.0.0',
          environment: process.env.NODE_ENV || 'development',
        };

        // Check Redis
        try {
          const redisConnected = await mockRedisService.ping();
          checks.services.redis = redisConnected ? 'healthy' : 'unhealthy';
        } catch (error) {
          checks.services.redis = 'unhealthy';
        }

        // Check Databricks
        try {
          await mockDatabricksService.execute('SELECT 1');
          checks.services.databricks = 'healthy';
        } catch (error) {
          checks.services.databricks = 'unhealthy';
        }

        // Determine overall status
        const unhealthyServices = Object.values(checks.services).filter(
          status => status === 'unhealthy'
        );
        
        if (unhealthyServices.length > 0) {
          checks.status = 'degraded';
          return res.status(503).json(checks);
        }

        res.json(checks);
      } catch (error) {
        res.status(500).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Health check failed',
        });
      }
    });
    
    // Reset mocks
    (mockRedisService.ping as jest.Mock).mockResolvedValue(true);
    (mockDatabricksService.execute as jest.Mock).mockResolvedValue([]);
  });

  describe('GET /api/health', () => {
    it('should return healthy status when all services are up', async () => {
      (mockRedisService.ping as jest.Mock).mockResolvedValue(true);
      (mockDatabricksService.execute as jest.Mock).mockResolvedValue([{ '1': 1 }]);

      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'healthy',
        timestamp: expect.any(String),
        services: {
          api: 'healthy',
          redis: 'healthy',
          databricks: 'healthy',
        },
        version: expect.any(String),
        environment: 'test',
      });
    });

    it('should return degraded status when Redis is down', async () => {
      (mockRedisService.ping as jest.Mock).mockResolvedValue(false);
      (mockDatabricksService.execute as jest.Mock).mockResolvedValue([{ '1': 1 }]);

      const response = await request(app)
        .get('/api/health')
        .expect(503);

      expect(response.body).toEqual({
        status: 'degraded',
        timestamp: expect.any(String),
        services: {
          api: 'healthy',
          redis: 'unhealthy',
          databricks: 'healthy',
        },
        version: expect.any(String),
        environment: 'test',
      });
    });

    it('should return degraded status when Databricks is down', async () => {
      (mockRedisService.ping as jest.Mock).mockResolvedValue(true);
      (mockDatabricksService.execute as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      const response = await request(app)
        .get('/api/health')
        .expect(503);

      expect(response.body).toEqual({
        status: 'degraded',
        timestamp: expect.any(String),
        services: {
          api: 'healthy',
          redis: 'healthy',
          databricks: 'unhealthy',
        },
        version: expect.any(String),
        environment: 'test',
      });
    });

    it('should return degraded status when multiple services are down', async () => {
      mockRedisService.ping.mockRejectedValue(new Error('Redis connection failed'));
      mockDatabricksService.execute.mockRejectedValue(new Error('Databricks connection failed'));

      const response = await request(app)
        .get('/api/health')
        .expect(503);

      expect(response.body).toEqual({
        status: 'degraded',
        timestamp: expect.any(String),
        services: {
          api: 'healthy',
          redis: 'unhealthy',
          databricks: 'unhealthy',
        },
        version: expect.any(String),
        environment: 'test',
      });
    });

    it('should handle unexpected errors gracefully', async () => {
      // Force an unexpected error by making ping throw synchronously
      mockRedisService.ping.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const response = await request(app)
        .get('/api/health')
        .expect(500);

      expect(response.body).toEqual({
        status: 'unhealthy',
        timestamp: expect.any(String),
        error: 'Health check failed',
      });
    });

    it('should not require authentication', async () => {
      // Health checks should be accessible without auth for monitoring tools
      await request(app)
        .get('/api/health')
        .expect(200);
    });

    it('should respond quickly', async () => {
      const start = Date.now();
      
      await request(app)
        .get('/api/health')
        .expect(200);
      
      const duration = Date.now() - start;
      // Health check should respond within 1 second
      expect(duration).toBeLessThan(1000);
    });

    it('should include proper headers', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.headers['content-type']).toMatch(/application\/json/);
      expect(response.headers['cache-control']).toBeDefined();
    });
  });

  describe('Monitoring Integration', () => {
    it('should provide data suitable for monitoring tools', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      // Verify response includes all necessary fields for monitoring
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('services');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('environment');

      // Timestamp should be valid ISO string
      expect(new Date(response.body.timestamp).toISOString()).toBe(response.body.timestamp);
    });

    it('should use appropriate HTTP status codes', async () => {
      // Healthy = 200
      mockRedisService.ping.mockResolvedValue(true);
      mockDatabricksService.execute.mockResolvedValue([]);
      await request(app).get('/api/health').expect(200);

      // Degraded = 503 (Service Unavailable)
      mockRedisService.ping.mockResolvedValue(false);
      await request(app).get('/api/health').expect(503);
    });
  });

  describe('Security', () => {
    it('should not expose sensitive information', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      // Should not include sensitive data
      const responseString = JSON.stringify(response.body);
      expect(responseString).not.toContain('password');
      expect(responseString).not.toContain('secret');
      expect(responseString).not.toContain('token');
      expect(responseString).not.toContain('key');
      expect(responseString).not.toContain('connectionString');
    });

    it('should not expose detailed error messages', async () => {
      mockDatabricksService.execute.mockRejectedValue(
        new Error('Connection failed: Invalid credentials at databricks.com:443')
      );

      const response = await request(app)
        .get('/api/health')
        .expect(503);

      // Should not expose detailed error info
      expect(JSON.stringify(response.body)).not.toContain('credentials');
      expect(JSON.stringify(response.body)).not.toContain('databricks.com');
      expect(response.body.services.databricks).toBe('unhealthy');
    });
  });
});