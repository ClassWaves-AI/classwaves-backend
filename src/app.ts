// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth.routes';
import sessionRoutes from './routes/session.routes';
import rosterRoutes from './routes/roster.routes';
import kioskRoutes from './routes/kiosk.routes';
import jwksRoutes from './routes/jwks.routes';
import adminRoutes from './routes/admin.routes';
import budgetRoutes from './routes/budget.routes';
import aiAnalysisRoutes from './routes/ai-analysis.routes';
import guidanceAnalyticsRoutes from './routes/guidance-analytics.routes';
import analyticsMonitoringRoutes from './routes/analytics-monitoring.routes';

import healthRoutes from './routes/health.routes';
import debugRoutes from './routes/debug.routes';
import { redisService } from './services/redis.service';
import { databricksService } from './services/databricks.service';
import { openAIWhisperService } from './services/openai-whisper.service';
import { rateLimitMiddleware, authRateLimitMiddleware } from './middleware/rate-limit.middleware';
import { csrfTokenGenerator, requireCSRF } from './middleware/csrf.middleware';
import { initializeRateLimiters } from './middleware/rate-limit.middleware';
import client from 'prom-client';

const app = express();

// CRITICAL DEBUG: Add global error handling to catch uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('🔧 DEBUG: Uncaught Exception:', error);
  console.error('🔧 DEBUG: Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔧 DEBUG: Unhandled Rejection at:', promise, 'reason:', reason);
});

// CRITICAL DEBUG: Add request logging at the very top level before ANY middleware
app.use((req, res, next) => {
  console.log('🔧 DEBUG: TOP LEVEL - Request received:', {
    method: req.method,
    url: req.url,
    path: req.path,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      'content-length': req.headers['content-length']
    }
  });
  
  // Add response error handling
  const originalSend = res.send;
  res.send = function(data) {
    if (res.statusCode >= 400) {
      console.error('🔧 DEBUG: Error response being sent:', {
        statusCode: res.statusCode,
        method: req.method,
        path: req.path,
        data: typeof data === 'string' ? data.substring(0, 200) : data
      });
    }
    return originalSend.call(this, data);
  };
  
  next();
});

/**
 * SECURITY HARDENING - Phase 2 Implementation
 * 
 * Enhanced security middleware with:
 * - Strict CORS policy with whitelisted origins
 * - Enhanced Content Security Policy (CSP)
 * - Global rate limiting for brute force protection
 * - Additional security headers
 */

// SECURITY 1: Global rate limiting to prevent brute-force attacks
const globalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    console.log('🔧 DEBUG: Global rate limit check for path:', req.path);
    // Skip rate limiting for health checks and internal monitoring
    const shouldSkip = req.path === '/api/v1/health' || req.path === '/metrics';
    console.log('🔧 DEBUG: Global rate limit skip decision:', shouldSkip);
    return shouldSkip;
  },
  handler: (req, res) => {
    console.error('🔧 DEBUG: Global rate limit exceeded for path:', req.path);
    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    });
  }
  // Use default IP-based key generator (handles IPv6 correctly)
});

// Add debugging wrapper for global rate limit
app.use((req, res, next) => {
  console.log('🔧 DEBUG: Request received - path:', req.path, 'method:', req.method);
  console.log('🔧 DEBUG: About to apply global rate limit');
  globalRateLimit(req, res, (err) => {
    if (err) {
      console.error('🔧 DEBUG: Global rate limit error:', err);
      return res.status(500).json({
        error: 'RATE_LIMIT_ERROR', 
        message: 'Rate limiting service error'
      });
    }
    console.log('🔧 DEBUG: Global rate limit passed');
    next();
  });
});

// SECURITY 2: Enhanced CORS with strict origin validation
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // In dev, allow all origins for simplicity, but log violations
    if (process.env.NODE_ENV !== 'production') {
      const allowedDevOrigins = [
        'http://localhost:3001',  // Frontend
        'http://127.0.0.1:3001', // Frontend (alternative)
        'http://localhost:3003',  // Student Portal
        'http://127.0.0.1:3003'   // Student Portal (alternative)
      ];
      if (origin && !allowedDevOrigins.includes(origin)) {
        console.warn(`🚨 CORS VIOLATION: Origin ${origin} not in dev whitelist`);
      }
      callback(null, true);
      return;
    }

    const whitelist = (process.env.CORS_WHITELIST || '').split(',');
    if (origin && whitelist.includes(origin)) {
      callback(null, true);
    } else {
      const error = new Error(`CORS policy: Origin ${origin} is not allowed`);
      console.error(error);
      callback(error);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};
app.use(cors(corsOptions));

// SECURITY 3: Enhanced Content Security Policy and security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'", // Required for Google OAuth widget
        "https://accounts.google.com",
        "https://apis.google.com",
        "https://www.google.com", // Google reCAPTCHA if used
        // Nonce-based CSP would be better, but requires frontend changes
      ],
      styleSrc: [
        "'self'", 
        "'unsafe-inline'", // Required for dynamic styling
        "https://fonts.googleapis.com"
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com"
      ],
      imgSrc: [
        "'self'", 
        "data:", 
        "https:", 
        "https://accounts.google.com",
        "https://www.google.com"
      ],
      connectSrc: [
        "'self'",
        "https://accounts.google.com",
        "https://oauth2.googleapis.com",
        "https://www.googleapis.com",
        // Add Databricks if needed
        process.env.DATABRICKS_HOST ? `https://${process.env.DATABRICKS_HOST}` : ""
      ].filter(Boolean),
      frameSrc: [
        "https://accounts.google.com",
        "https://www.google.com" // For reCAPTCHA
      ],
      frameAncestors: ["'self'"], // Prevent embedding in foreign frames
      objectSrc: ["'none'"], // Block Flash, Java, etc.
      baseUri: ["'self'"], // Restrict base tag
      formAction: ["'self'"], // Restrict form submissions
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  // SECURITY 4: Enhanced security headers
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  crossOriginOpenerPolicy: { 
    policy: "same-origin-allow-popups" // Required for OAuth popups
  },
  crossOriginResourcePolicy: { 
    policy: "same-origin" 
  },
  crossOriginEmbedderPolicy: false, // Disabled for OAuth compatibility
  referrerPolicy: {
    policy: "strict-origin-when-cross-origin"
  },
  noSniff: true, // X-Content-Type-Options: nosniff
  frameguard: { action: 'sameorigin' }, // X-Frame-Options: SAMEORIGIN
  xssFilter: true, // X-XSS-Protection: 1; mode=block
  dnsPrefetchControl: { allow: false }, // X-DNS-Prefetch-Control: off
  permittedCrossDomainPolicies: false // X-Permitted-Cross-Domain-Policies: none
}));

// SECURITY 5: Additional custom security headers
app.use((req, res, next) => {
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Feature Policy / Permissions Policy
  res.setHeader('Permissions-Policy', 
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), speaker=()'
  );
  
  // Expect-CT header for certificate transparency (production only)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Expect-CT', 'max-age=86400, enforce');
  }
  
  next();
});

// Enhanced CORS configuration is applied above in the security hardening section

// Rate limiters will be initialized by service manager after Redis connection
// Middleware below will gracefully handle uninitialized state

// Apply rate limiting
app.use('/api/', rateLimitMiddleware);
app.use('/api/v1/auth', authRateLimitMiddleware);

// Body parsing middleware with debugging
app.use((req, res, next) => {
  console.log('🔧 DEBUG: About to parse JSON body for:', req.method, req.path);
  next();
});

app.use(express.json({ 
  limit: '10mb',
  verify: (req: any, res, buf) => {
    console.log('🔧 DEBUG: JSON parsing - body length:', buf.length);
  }
}));

app.use((err: any, req: any, res: any, next: any) => {
  if (err && err.type === 'entity.parse.failed') {
    console.error('🔧 DEBUG: JSON parsing error:', err);
    return res.status(400).json({ error: 'JSON_PARSE_ERROR', message: err.message });
  }
  next(err);
});

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parsing middleware
app.use(cookieParser());

// CSRF token generation
app.use(csrfTokenGenerator);

// Apply CSRF protection
app.use(requireCSRF({
  skipRoutes: [
    '/api/v1/health',
    '/api/v1/ready',
    '/.well-known',
    '/api/v1/auth/google',
    '/api/v1/auth/generate-test-token',
    '/api/v1/sessions', // allow factory to skip via startsWith; join is unauthenticated
  ]
}));

// Lightweight readiness endpoint for orchestration/tests
// Always returns 200 once the HTTP server is up, regardless of downstream service health
app.get('/api/v1/ready', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.json({
    status: 'ready',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

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
        openai_whisper: 'unknown',
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

    // Skip Databricks health check in test mode
    if (process.env.NODE_ENV === 'test' || process.env.DATABRICKS_ENABLED === 'false') {
      checks.services.databricks = 'disabled';
    } else {
      try {
        await databricksService.query('SELECT 1');
        checks.services.databricks = 'healthy';
      } catch {
        checks.services.databricks = 'unhealthy';
      }
    }

    try {
      const whisperHealth = await openAIWhisperService.healthCheck();
      checks.services.openai_whisper = whisperHealth ? 'healthy' : 'unhealthy';
    } catch {
      checks.services.openai_whisper = 'unhealthy';
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
app.use('/api/v1/schools', budgetRoutes);
app.use('/api/v1/ai', aiAnalysisRoutes);
app.use('/api/v1/analytics', guidanceAnalyticsRoutes);
app.use('/api/v1/analytics/monitoring', analyticsMonitoringRoutes);
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/debug', debugRoutes);


// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'The requested resource was not found',
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('🔧 DEBUG: Error middleware triggered:', {
    error: err,
    message: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    headers: req.headers
  });
  
  const isDevelopment = process.env.NODE_ENV === 'development';
  const response = {
    error: err.code || 'INTERNAL_ERROR',
    message: err.message || 'An unexpected error occurred',
    ...(isDevelopment && { stack: err.stack }),
  };
  
  console.error('🔧 DEBUG: Sending error response:', response);
  res.status(err.status || 500).json(response);
});

export default app;
