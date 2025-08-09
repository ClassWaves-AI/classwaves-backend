import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import sessionRoutes from './routes/session.routes';
import rosterRoutes from './routes/roster.routes';
import kioskRoutes from './routes/kiosk.routes';
import jwksRoutes from './routes/jwks.routes';
import adminRoutes from './routes/admin.routes';
import { redisService } from './services/redis.service';
import { databricksService } from './services/databricks.service';
import { rateLimitMiddleware, authRateLimitMiddleware } from './middleware/rate-limit.middleware';
import { csrfTokenGenerator, requireCSRF } from './middleware/csrf.middleware';
import { initializeRateLimiters } from './middleware/rate-limit.middleware';
import client from 'prom-client';

// Load environment variables
dotenv.config();

const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "https://accounts.google.com", "https://apis.google.com"],
      imgSrc: ["'self'", "data:", "https:", "https://accounts.google.com"],
      connectSrc: ["'self'", "https://accounts.google.com", "https://oauth2.googleapis.com"],
      frameSrc: ["https://accounts.google.com"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  crossOriginOpenerPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://classwaves.com', 'https://app.classwaves.com']
    : ['http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
}));

// Initialize rate limiters (non-blocking)
initializeRateLimiters().catch((err) => {
  console.warn('Rate limiter initialization failed, continuing without enforced limits:', err);
});

// Apply rate limiting
app.use('/api/', rateLimitMiddleware);
app.use('/api/v1/auth', authRateLimitMiddleware);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parsing middleware
app.use(cookieParser());

// CSRF token generation
app.use(csrfTokenGenerator);

// Apply CSRF protection
app.use(requireCSRF({
  skipRoutes: [
    '/api/v1/health',
    '/.well-known',
    '/api/v1/auth/google',
    '/api/v1/auth/generate-test-token',
    '/api/v1/sessions', // allow factory to skip via startsWith; join is unauthenticated
  ]
}));

// Health check endpoint
app.get('/api/v1/health', async (_req, res) => {
  try {
    const checks: any = {
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

    try {
      const redisOk = await redisService.ping();
      checks.services.redis = redisOk ? 'healthy' : 'unhealthy';
    } catch {
      checks.services.redis = 'unhealthy';
    }

    try {
      await databricksService.query('SELECT 1');
      checks.services.databricks = 'healthy';
    } catch {
      checks.services.databricks = 'unhealthy';
    }

    const unhealthy = Object.values(checks.services).some((s) => s === 'unhealthy');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    if (unhealthy) {
      checks.status = 'degraded';
      res.status(503).json(checks);
    } else {
      res.json(checks);
    }
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

// Metrics endpoint
const register = new client.Registry();
client.collectDefaultMetrics({ register });
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// JWKS routes
app.use('/', jwksRoutes);

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/sessions', sessionRoutes);
app.use('/api/v1/roster', rosterRoutes);
app.use('/api/v1/kiosk', kioskRoutes);
app.use('/api/v1/admin', adminRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'The requested resource was not found',
  });
});

// Error handling middleware
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Error:', err);
  const isDevelopment = process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({
    error: err.code || 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred',
    ...(isDevelopment && { stack: err.stack }),
  });
});

export default app;
