// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';

// Load the appropriate environment file based on NODE_ENV
if (process.env.NODE_ENV === 'test') {
  dotenv.config({ path: '.env.test' });
} else {
  dotenv.config();
}

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
import adminMetricsRoutes from './routes/admin.metrics.routes';
import budgetRoutes from './routes/budget.routes';
import aiAnalysisRoutes from './routes/ai-analysis.routes';
import audioUploadRoutes from './routes/audio-upload.routes';
import guidanceAnalyticsRoutes from './routes/guidance-analytics.routes';
import analyticsMonitoringRoutes from './routes/analytics-monitoring.routes';
import transcriptsRoutes from './routes/transcripts.routes';
import guidanceFixturesRoutes from './routes/guidance-fixtures.routes';

import healthRoutes from './routes/health.routes';
import debugRoutes from './routes/debug.routes';
import { redisService } from './services/redis.service';
import { databricksService } from './services/databricks.service';
import { openAIWhisperService } from './services/openai-whisper.service';
import { inMemoryAudioProcessor } from './services/audio/InMemoryAudioProcessor';
import { rateLimitMiddleware, authRateLimitMiddleware } from './middleware/rate-limit.middleware';
import { csrfTokenGenerator, requireCSRF } from './middleware/csrf.middleware';
import { errorLoggingHandler } from './middleware/error-logging.middleware';
import client from 'prom-client';
import { traceIdMiddleware } from './middleware/trace-id.middleware';
import { httpMetricsMiddleware } from './middleware/metrics.middleware';
import { requestLoggingMiddleware } from './middleware/request-logging.middleware';
import { transcriptPersistenceService } from './services/transcript-persistence.service';
import { databricksConfig } from './config/databricks.config';
import { fail } from './utils/api-response';
import { ErrorCodes } from '@classwaves/shared';
import { logger } from './utils/logger';
import { getCompositionRoot } from './app/composition-root';
import { initOtel, httpTraceMiddleware, createRouteSpanMiddleware } from './observability/otel';
import { getSchemaManifestHash } from './utils/manifest.utils';

// Optional OTEL: initialize and wire tracing when enabled
if (process.env.OTEL_ENABLED === '1') {
  void initOtel().catch((error) => {
    logger.warn('OTEL initialization failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

const app = express();

// In test environment, trust proxy so req.ip parsing matches x-forwarded-for
if (process.env.NODE_ENV === 'test') {
  // Use more restrictive trust proxy setting to avoid rate limiter validation errors
  app.set('trust proxy', 'loopback');
}

// CRITICAL DEBUG: Add global error handling to catch uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: (error as any)?.message || String(error) });
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason: (reason as any)?.message || String(reason) });
});

// CRITICAL DEBUG: Add request logging at the very top level before ANY middleware
app.use((req, res, next) => {
  if (process.env.API_DEBUG === '1') {
    logger.debug('TOP LEVEL - Request received', {
      method: req.method,
      url: req.url,
      path: req.path,
      headers: {
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
        'content-length': req.headers['content-length']
      }
    });
  }
  // Add response error handling
  const originalSend = res.send;
  res.send = function(data) {
    if (res.statusCode >= 400) {
      logger.error('Error response being sent', {
        statusCode: res.statusCode,
        method: req.method,
        path: req.path,
      });
    }
    return originalSend.call(this, data);
  };
  next();
});

// Correlation: assign/propagate X-Trace-Id for every request
app.use(traceIdMiddleware);

// Structured request logging (start/finish with correlation IDs)
app.use(requestLoggingMiddleware);

// Attach OTEL HTTP tracing middleware if enabled
if (process.env.OTEL_ENABLED === '1') {
  app.use(httpTraceMiddleware());
}

/**
 * SECURITY HARDENING - Phase 2 Implementation
 * 
 * Enhanced security middleware with:
 * - Strict CORS policy with whitelisted origins
 * - Enhanced Content Security Policy (CSP)
 * - Global rate limiting for brute force protection
 * - Additional security headers
 */

// SECURITY 2: Enhanced CORS with strict origin validation (must be BEFORE rate limiting)
const corsOptions = {
  origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // In dev and test, apply a strict whitelist to avoid echoing malicious origins in headers
    if (process.env.NODE_ENV !== 'production') {
      const allowedDevOrigins = [
        'http://localhost:3001',  // Frontend
        'http://127.0.0.1:3001', // Frontend (alternative)
        'http://localhost:3003',  // Student Portal
        'http://127.0.0.1:3003'   // Student Portal (alternative)
      ];
      if (origin && !allowedDevOrigins.includes(origin)) {
        logger.warn(`🚨 CORS VIOLATION: Origin ${origin} not in dev whitelist`);
        // Do not allow unknown origins in test/dev either
        return callback(null, false);
      }
      return callback(null, true);
    }

    const whitelist = (process.env.CORS_WHITELIST || '').split(',').filter(Boolean);
    if (origin && whitelist.includes(origin)) {
      callback(null, true);
    } else {
      const error = new Error(`CORS policy: Origin ${origin} is not allowed`);
      logger.error('CORS policy violation', { error: error.message });
      callback(error);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-E2E-Test-Secret', 'X-CW-Fingerprint'],
};
app.use(cors(corsOptions));

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
    logger.debug('Global rate limit check', { path: req.path });
    // Skip rate limiting for preflight and safe/infra endpoints
    const isPreflight = req.method === 'OPTIONS' || req.method === 'HEAD';
    const isInfra = req.path === '/api/v1/health' || req.path === '/metrics' || req.path === '/api/v1/ready';
    // Skip for audio upload windows to avoid interfering with 10s cadence
    const isAudioUpload = req.path.startsWith('/api/v1/audio/');
    const shouldSkip = isPreflight || isInfra || isAudioUpload;
    logger.debug('Global rate limit skip decision', { shouldSkip });
    return shouldSkip;
  },
  handler: (req, res) => {
    logger.warn('Global rate limit exceeded', { path: req.path });
    return fail(res, ErrorCodes.RATE_LIMITED, 'Too many requests from this IP, please try again later.', 429, { retryAfter: '15 minutes' as any });
  }
  // Use default IP-based key generator (handles IPv6 correctly)
});

// Add debugging wrapper for global rate limit (after CORS so preflight succeeds)
app.use((req, res, next) => {
  if (process.env.API_DEBUG === '1') {
    logger.debug('Request received - applying global rate limit', { path: req.path, method: req.method });
  }
  globalRateLimit(req, res, (err) => {
    if (err) {
      logger.error('Global rate limit error', { error: (err as any)?.message || String(err) });
      return fail(res, ErrorCodes.INTERNAL_ERROR, 'Rate limiting service error', 500);
    }
    if (process.env.API_DEBUG === '1') logger.debug('Global rate limit passed');
    next();
  });
});

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
  if (process.env.API_DEBUG === '1' && (req.headers['content-type'] || '').includes('application/json')) {
    logger.debug('🔧 DEBUG: About to parse JSON body for:', req.method, req.path);
  }
  next();
});

app.use(express.json({ 
  limit: '10mb',
  verify: (req: any, res, buf) => {
    if (process.env.API_DEBUG === '1') logger.debug('🔧 DEBUG: JSON parsing - body length:', buf.length);
  }
}));

app.use((err: any, req: any, res: any, next: any) => {
  if (err && err.type === 'entity.parse.failed') {
    logger.error('🔧 DEBUG: JSON parsing error:', err);
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
    '/api/v1/audio', // REST-first audio uploads use Bearer token; CSRF not required
  ]
}));

// HTTP request metrics (after security middleware, before routes)
app.use(httpMetricsMiddleware);

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
        audio_processor: 'unknown',
        whisper_breaker: 'unknown',
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

    // Skip Databricks health check in test mode unless explicitly enabled
    if ((process.env.NODE_ENV === 'test' && process.env.DATABRICKS_ENABLED !== 'true') || process.env.DATABRICKS_ENABLED === 'false') {
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
      const breaker = databricksService.getBreakerStatus?.();
      if (breaker) checks.services.databricks_breaker = breaker.state;
    } catch (error) {
      logger.debug('Databricks breaker status fetch failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Whisper health check can cause outbound traffic/errors; gate behind env flag
    if (process.env.OPENAI_WHISPER_HEALTH_ENABLED === '1') {
      try {
        const whisperHealth = await openAIWhisperService.healthCheck?.();
        checks.services.openai_whisper = whisperHealth ? 'healthy' : 'unhealthy';
      } catch {
        checks.services.openai_whisper = 'unhealthy';
      }
    } else {
      checks.services.openai_whisper = 'skipped';
    }

    // Include audio processor / breaker state for resilience visibility
    try {
      const audioHealth = await inMemoryAudioProcessor.healthCheck();
      checks.services.audio_processor = audioHealth?.status || 'unknown';
      const breaker = audioHealth?.details?.breaker || 'unknown';
      checks.services.whisper_breaker = breaker; // 'open' | 'closed'
    } catch {
      checks.services.audio_processor = 'unhealthy';
      checks.services.whisper_breaker = 'unknown';
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
    logger.error('Health check failed unexpectedly', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

// Metrics endpoint (use default global registry to include metrics from all modules)
// Avoid starting default metrics collector during tests to prevent Jest open-handle leaks
if (process.env.NODE_ENV !== 'test' && process.env.METRICS_DEFAULT_DISABLED !== '1') {
  try {
    client.collectDefaultMetrics();
  } catch (error) {
    logger.debug('Failed to start default Prometheus metrics collection', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const appInfoGauge = (() => {
  const name = 'classwaves_app_info';
  const existing = client.register.getSingleMetric(name) as client.Gauge<string> | undefined;
  if (existing) return existing;
  return new client.Gauge({
    name,
    help: 'ClassWaves app metadata',
    labelNames: ['db_provider', 'manifest_hash'],
  });
})();

function updateAppInfoGauge(): void {
  try {
    const provider = getCompositionRoot().getDbProvider();
    const manifestHash = provider === 'postgres' ? getSchemaManifestHash() ?? 'unknown' : 'not_applicable';
    appInfoGauge.set({ db_provider: provider, manifest_hash: manifestHash }, 1);
  } catch (error) {
    if (process.env.API_DEBUG === '1') {
      logger.warn('Unable to update app info gauge', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

updateAppInfoGauge();

app.get('/metrics', async (_req, res) => {
  updateAppInfoGauge();
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// No explicit stop for default metrics (prom-client types may not expose stopper)

// JWKS routes
app.use('/', jwksRoutes);

// API routes
// Add OTEL route-level spans for key controllers
if (process.env.OTEL_ENABLED === '1') {
  app.use('/api/v1/sessions', createRouteSpanMiddleware('sessions'));
  app.use('/api/v1/analytics', createRouteSpanMiddleware('analytics'));
}

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/sessions', sessionRoutes);
app.use('/api/v1/roster', rosterRoutes);
app.use('/api/v1/kiosk', kioskRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/admin', adminMetricsRoutes);
app.use('/api/v1/schools', budgetRoutes);
app.use('/api/v1/ai', aiAnalysisRoutes);
app.use('/api/v1/analytics', guidanceAnalyticsRoutes);
app.use('/api/v1/analytics/monitoring', analyticsMonitoringRoutes);
app.use('/api/v1/audio', audioUploadRoutes);
app.use('/api/v1/transcripts', transcriptsRoutes);
app.use('/api/v1/dev/guidance/fixtures', guidanceFixturesRoutes);
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/debug', debugRoutes);


// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: 'The requested resource was not found',
  });
});

// Error logging middleware (must come before error handling)
app.use(errorLoggingHandler);

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('🔧 DEBUG: Error middleware triggered:', {
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
  
  logger.error('🔧 DEBUG: Sending error response:', response);
  res.status(err.status || 500).json(response);
});

export default app;

// Background transcript batch flush (disabled in tests)
try {
  const secs = parseInt(process.env.TRANSCRIPT_BATCH_FLUSH_SECS || '0', 10);
  const canDb = !!databricksConfig.token && process.env.DATABRICKS_ENABLED !== 'false';
  if (secs > 0 && process.env.NODE_ENV !== 'test' && canDb) {
    const interval = setInterval(() => {
      transcriptPersistenceService.flushAll().catch((e) => {
        logger.warn('Transcript periodic flush failed:', e instanceof Error ? e.message : String(e));
      });
    }, secs * 1000);
    (interval as any).unref?.();
  }
} catch (error) {
  logger.warn('Transcript batch flush scheduler failed to initialize', {
    error: error instanceof Error ? error.message : String(error),
  });
}
