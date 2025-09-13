import { Request, Response } from 'express';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { redisService } from '../services/redis.service';
import { fail } from '../utils/api-response';
import { ErrorCodes } from '@classwaves/shared';
import { logger } from '../utils/logger';

function buildRlPrefix(name: string): string {
  const env = process.env.NODE_ENV || 'development';
  // Enabled by default; disable by setting CW_RL_PREFIX_ENABLED=0
  return process.env.CW_RL_PREFIX_ENABLED !== '0' ? `cw:${env}:rl:${name}` : `rl:${name}`;
}

// Fallback to memory store if Redis is not available
let rateLimiter: RateLimiterRedis | RateLimiterMemory;
let authRateLimiter: RateLimiterRedis | RateLimiterMemory;
let rateLimiterInitialized = false;
let authRateLimiterInitialized = false;

// Initialize rate limiter with Redis or memory fallback
async function initializeRateLimiter() {
  try {
    if (redisService.isConnected()) {
      const redisClient = redisService.getClient();
      
      rateLimiter = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: buildRlPrefix('general'),
        points: process.env.NODE_ENV === 'development' ? 1000 : 100, // Higher limit for dev
        duration: 900, // Per 15 minutes (in seconds)
        blockDuration: process.env.NODE_ENV === 'development' ? 60 : 900, // Shorter block for dev
        execEvenly: true, // Spread requests evenly
      });
      
      rateLimiterInitialized = true;
      logger.info('Rate limiter initialized with Redis');
    } else {
      throw new Error('Redis not connected');
    }
  } catch (error) {
    logger.warn('Rate limiter falling back to memory store', { error: (error as any)?.message || String(error) });
    
    rateLimiter = new RateLimiterMemory({
      keyPrefix: buildRlPrefix('general'),
      points: process.env.NODE_ENV === 'development' ? 1000 : 100, // Higher limit for dev
      duration: 900,
      blockDuration: process.env.NODE_ENV === 'development' ? 60 : 900, // Shorter block for dev
      execEvenly: true,
    });
    
    rateLimiterInitialized = true;
  }
}

// Auth endpoints rate limiter (stricter)

async function initializeAuthRateLimiter() {
  try {
    if (redisService.isConnected()) {
      const redisClient = redisService.getClient();
      
      authRateLimiter = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: buildRlPrefix('auth'),
        points: process.env.NODE_ENV === 'development' ? 50 : 5, // 50 for dev, 5 for prod
        duration: 900, // Per 15 minutes
        blockDuration: process.env.NODE_ENV === 'development' ? 60 : 900, // 1 min dev, 15 min prod
        execEvenly: false,
      });
      
      authRateLimiterInitialized = true;
      logger.info('Auth rate limiter initialized with Redis');
    } else {
      throw new Error('Redis not connected');
    }
  } catch (error) {
    logger.warn('Auth rate limiter falling back to memory store', { error: (error as any)?.message || String(error) });
    
    authRateLimiter = new RateLimiterMemory({
      keyPrefix: buildRlPrefix('auth'),
      points: process.env.NODE_ENV === 'development' ? 50 : 5, // 50 for dev, 5 for prod
      duration: 900,
      blockDuration: process.env.NODE_ENV === 'development' ? 60 : 900, // 1 min dev, 15 min prod
      execEvenly: false,
    });
    
    authRateLimiterInitialized = true;
  }
}

// Initialize both rate limiters
export async function initializeRateLimiters() {
  await initializeRateLimiter();
  await initializeAuthRateLimiter();
}

// General rate limiting middleware
export const rateLimitMiddleware = async (req: Request, res: Response, next: Function) => {
  // Skip preflight and safe methods
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return next();
  // Skip audio uploads and infra endpoints
  const path = req.path || '';
  const ctype = String(req.headers['content-type'] || '').toLowerCase();
  if (path.startsWith('/api/v1/audio/') || path === '/api/v1/ready' || path === '/api/v1/health' || path === '/metrics' || ctype.startsWith('multipart/form-data')) {
    return next();
  }
  if (process.env.NODE_ENV === 'test') {
    return next();
  }
  // If rate limiter hasn't been initialized yet, allow the request but log warning
  if (!rateLimiterInitialized) {
    if (process.env.API_DEBUG === '1') logger.warn('Rate limiter not initialized, allowing request');
    return next();
  }

  try {
    const key = req.ip || 'unknown';
    
    // Add timeout and ensure any late rejection is handled to avoid unhandled promise noise
    const rateLimitPromise = (rateLimiter as any).consume(key).catch((e: any) => {
      if (process.env.API_DEBUG === '1') logger.warn('Rate limiter consume error (deferred)', { error: e?.message || e });
      return null;
    });
    const timeoutPromise = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 2000));
    const outcome = await Promise.race([rateLimitPromise, timeoutPromise]);
    if (outcome === 'timeout' || outcome === null) {
      logger.warn('Rate limiter timeout/deferred error, allowing request');
      return next();
    }
    next();
  } catch (rejRes: any) {
    if (rejRes.message === 'Rate limit timeout') {
      logger.warn('Rate limiter timeout, allowing request');
      return next();
    }

    const retryAfter = Math.round(rejRes.msBeforeNext / 1000) || 900;
    return fail(res, ErrorCodes.RATE_LIMITED, 'Too many requests, please try again later', 429, { retryAfter });
  }
};

// Stricter rate limiting for auth endpoints
export const authRateLimitMiddleware = async (req: Request, res: Response, next: Function) => {
  if (process.env.API_DEBUG === '1') {
    logger.debug('Auth rate limit middleware called', { nodeEnv: process.env.NODE_ENV, path: req.path, initialized: authRateLimiterInitialized });
  }
  
  // Skip preflight and safe methods
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return next();
  
  if (process.env.NODE_ENV === 'test') {
    logger.debug('Skipping auth rate limit in test environment');
    return next();
  }
  // If auth rate limiter hasn't been initialized yet, allow the request but log warning
  if (!authRateLimiterInitialized) {
    if (process.env.API_DEBUG === '1') logger.warn('Auth rate limiter not initialized, allowing request');
    return next();
  }

  try {
    const key = req.ip || 'unknown';
    if (process.env.API_DEBUG === '1') logger.debug('Auth rate limiter key computed');
    
    // Add timeout and ensure late rejections are handled
    const rateLimitPromise = (authRateLimiter as any).consume(key).catch((e: any) => {
      if (process.env.API_DEBUG === '1') logger.warn('Auth rate limiter consume error (deferred)', { error: e?.message || e });
      return null;
    });
    const timeoutPromise = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), 2000));
    
    if (process.env.API_DEBUG === '1') logger.debug('About to check auth rate limit');
    const outcome = await Promise.race([rateLimitPromise, timeoutPromise]);
    if (outcome === 'timeout' || outcome === null) {
      logger.warn('Auth rate limiter timeout/deferred error, allowing request');
      return next();
    }
    if (process.env.API_DEBUG === '1') logger.debug('Auth rate limit check passed');
    next();
  } catch (rejRes: any) {
    logger.error('Auth rate limiter error', { error: rejRes?.message || rejRes });
    
    if (rejRes.message === 'Auth rate limit timeout') {
      logger.warn('Auth rate limiter timeout, allowing request');
      return next();
    }
    
    if (rejRes.message && rejRes.message.includes('timeout')) {
      logger.warn('Auth rate limiter general timeout, allowing request');
      return next();
    }
    
    const retryAfter = Math.round(rejRes.msBeforeNext / 1000) || 900;
    return fail(res, ErrorCodes.RATE_LIMITED, 'Too many authentication attempts, please try again later', 429, { retryAfter });
  }
};

// Rate limiter for specific user actions
export const createUserRateLimiter = (keyPrefix: string, points: number, duration: number) => {
  let userRateLimiter: RateLimiterRedis | RateLimiterMemory;
  if (redisService.isConnected()) {
    const redisClient = redisService.getClient();
    userRateLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: buildRlPrefix(keyPrefix),
      points,
      duration,
      blockDuration: duration,
    });
  } else {
    userRateLimiter = new RateLimiterMemory({
      keyPrefix: buildRlPrefix(keyPrefix),
      points,
      duration,
      blockDuration: duration,
    });
  }
  return async (req: Request, res: Response, next: Function) => {
    try {
      const authReq = req as any;
      const key = authReq.user?.id || req.ip || 'unknown';
      await (userRateLimiter as any).consume(key);
      next();
    } catch (rejRes: any) {
      const retryAfter = Math.round(rejRes?.msBeforeNext / 1000) || duration;
      return fail(res, ErrorCodes.RATE_LIMITED, `Too many ${keyPrefix} requests, please try again later`, 429, { retryAfter });
    }
  };
};
