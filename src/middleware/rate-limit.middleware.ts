import { Request, Response } from 'express';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { redisService } from '../services/redis.service';

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
        keyPrefix: 'rl:general',
        points: process.env.NODE_ENV === 'development' ? 1000 : 100, // Higher limit for dev
        duration: 900, // Per 15 minutes (in seconds)
        blockDuration: process.env.NODE_ENV === 'development' ? 60 : 900, // Shorter block for dev
        execEvenly: true, // Spread requests evenly
      });
      
      rateLimiterInitialized = true;
      console.log('✅ Rate limiter initialized with Redis');
    } else {
      throw new Error('Redis not connected');
    }
  } catch (error) {
    console.warn('⚠️  Rate limiter falling back to memory store:', error);
    
    rateLimiter = new RateLimiterMemory({
      keyPrefix: 'rl:general',
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
        keyPrefix: 'rl:auth',
        points: process.env.NODE_ENV === 'development' ? 50 : 5, // 50 for dev, 5 for prod
        duration: 900, // Per 15 minutes
        blockDuration: process.env.NODE_ENV === 'development' ? 60 : 900, // 1 min dev, 15 min prod
        execEvenly: false,
      });
      
      authRateLimiterInitialized = true;
      console.log('✅ Auth rate limiter initialized with Redis');
    } else {
      throw new Error('Redis not connected');
    }
  } catch (error) {
    console.warn('⚠️  Auth rate limiter falling back to memory store:', error);
    
    authRateLimiter = new RateLimiterMemory({
      keyPrefix: 'rl:auth',
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
  if (process.env.NODE_ENV === 'test') {
    return next();
  }
  // If rate limiter hasn't been initialized yet, allow the request but log warning
  if (!rateLimiterInitialized) {
    console.warn('⚠️  Rate limiter not initialized, allowing request');
    return next();
  }

  try {
    const key = req.ip || 'unknown';
    
    // Add timeout to prevent Redis hanging
    const rateLimitPromise = rateLimiter.consume(key);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Rate limit timeout')), 2000)
    );
    
    await Promise.race([rateLimitPromise, timeoutPromise]);
    next();
  } catch (rejRes: any) {
    if (rejRes.message === 'Rate limit timeout') {
      console.warn('⚠️  Rate limiter timeout, allowing request');
      return next();
    }
    
    res.status(429).json({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
      retryAfter: Math.round(rejRes.msBeforeNext / 1000) || 900,
    });
  }
};

// Stricter rate limiting for auth endpoints
export const authRateLimitMiddleware = async (req: Request, res: Response, next: Function) => {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }
  // If auth rate limiter hasn't been initialized yet, allow the request but log warning
  if (!authRateLimiterInitialized) {
    console.warn('⚠️  Auth rate limiter not initialized, allowing request');
    return next();
  }

  try {
    const key = req.ip || 'unknown';
    
    // Add timeout to prevent Redis hanging
    const rateLimitPromise = authRateLimiter.consume(key);
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Auth rate limit timeout')), 2000)
    );
    
    await Promise.race([rateLimitPromise, timeoutPromise]);
    next();
  } catch (rejRes: any) {
    if (rejRes.message === 'Auth rate limit timeout') {
      console.warn('⚠️  Auth rate limiter timeout, allowing request');
      return next();
    }
    
    res.status(429).json({
      error: 'AUTH_RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts, please try again later',
      retryAfter: Math.round(rejRes.msBeforeNext / 1000) || 900,
    });
  }
};

// Rate limiter for specific user actions
export const createUserRateLimiter = (keyPrefix: string, points: number, duration: number) => {
  return async (req: Request, res: Response, next: Function) => {
    try {
      let userRateLimiter: RateLimiterRedis | RateLimiterMemory;
      
      if (redisService.isConnected()) {
        const redisClient = redisService.getClient();
        userRateLimiter = new RateLimiterRedis({
          storeClient: redisClient,
          keyPrefix: `rl:${keyPrefix}`,
          points,
          duration,
          blockDuration: duration,
        });
      } else {
        userRateLimiter = new RateLimiterMemory({
          keyPrefix: `rl:${keyPrefix}`,
          points,
          duration,
          blockDuration: duration,
        });
      }
      
      const authReq = req as any;
      const key = authReq.user?.id || req.ip || 'unknown';
      
      await userRateLimiter.consume(key);
      next();
    } catch (rejRes: any) {
      res.status(429).json({
        error: 'USER_RATE_LIMIT_EXCEEDED',
        message: `Too many ${keyPrefix} requests, please try again later`,
        retryAfter: Math.round(rejRes.msBeforeNext / 1000) || duration,
      });
    }
  };
};