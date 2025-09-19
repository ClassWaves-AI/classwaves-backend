import { OAuth2Client } from 'google-auth-library';
import { Request } from 'express';
import { Teacher, School, GoogleUser } from '../types/auth.types';
import { redisService } from '../services/redis.service';
import { SecureSessionService } from '../services/secure-session.service';
import { databricksService } from '../services/databricks.service';
import { getExpiresInSeconds } from './jwt.utils';
import { logger } from './logger';

/**
 * Verify Google token with timeout and enhanced error handling
 */
export async function verifyGoogleTokenWithTimeout(
  googleClient: OAuth2Client,
  credential?: string,
  code?: string,
  timeoutMs: number = parseInt(process.env.GOOGLE_OAUTH_TIMEOUT || '5000', 10),
  codeVerifier?: string,
  redirectUri?: string
): Promise<GoogleUser> {
  const verificationPromise = (async () => {
    let payload;
    
    if (code) {
      // Handle authorization code flow (PKCE-aware)
      logger.debug('🔑 Exchanging authorization code...', { pkce: true, hasCodeVerifier: Boolean(codeVerifier) });
      const tokenParams = codeVerifier || redirectUri
        ? { code, codeVerifier, redirect_uri: redirectUri || process.env.GOOGLE_REDIRECT_URI }
        : (code as unknown as { code: string });
      const { tokens } = await googleClient.getToken(tokenParams as any);
      googleClient.setCredentials(tokens);
      
      // Get user information from Google
      const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token!,
        audience: process.env.GOOGLE_CLIENT_ID!,
      });
      payload = ticket.getPayload();
    } else {
      throw new Error('Authorization code is required');
    }

    if (!payload) {
      throw new Error('Invalid Google token payload');
    }

    // Map JWT payload to GoogleUser interface
    logger.debug('🔄 Mapping Google JWT payload to GoogleUser object');
    return {
      id: payload.sub!, // THIS IS THE KEY MAPPING: sub -> id -> google_id
      email: payload.email!,
      verified_email: payload.email_verified || false,
      name: payload.name || '',
      given_name: payload.given_name || '',
      family_name: payload.family_name || '',
      picture: payload.picture || '',
      locale: payload.locale || 'en',
      hd: payload.hd,
    } as GoogleUser;
  })();

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Google token verification timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const googleUser = await Promise.race([verificationPromise, timeoutPromise]);
    return googleUser as GoogleUser;
  } catch (error) {
    logger.error('❌ Google token verification failed:', error);
    
    // Enhanced error categorization
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new Error('GOOGLE_TIMEOUT');
      } else if (error.message.includes('invalid')) {
        throw new Error('GOOGLE_INVALID_TOKEN');
      } else if (error.message.includes('network')) {
        throw new Error('GOOGLE_NETWORK_ERROR');
      }
    }
    
    throw new Error('GOOGLE_VERIFICATION_FAILED');
  }
}

/**
 * Secure session storage with encryption and security monitoring
 */
export async function storeSessionOptimized(
  sessionId: string, 
  teacher: Teacher, 
  school: School, 
  req: Request
): Promise<void> {
  const storeStart = performance.now();
  
  try {
    // Use SecureSessionService for encrypted storage with security features
    await SecureSessionService.storeSecureSession(sessionId, teacher, school, req);
    
    logger.debug(`🔒 Secure session storage completed: ${sessionId} (${(performance.now() - storeStart).toFixed(2)}ms)`);
  } catch (error) {
    logger.error(`❌ Secure session storage failed for ${sessionId}:`, error);
    throw new Error(`Session storage failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Parallel authentication operations for maximum performance
 */
export async function executeParallelAuthOperations(
  googleUser: GoogleUser,
  domain: string,
  sessionId: string,
  req: Request
): Promise<{
  school: School;
  teacher: Teacher;
  sessionStored: boolean;
  refreshTokenStored: boolean;
}> {
  logger.debug('🚀 PARALLEL AUTH OPERATIONS START');
  const parallelStart = performance.now();
  
  try {
    // Execute database operations and token generation in parallel
    const { school, teacher } = await databricksService.batchAuthOperations(googleUser, domain);

    // Now execute session and refresh token storage in parallel
    const [sessionResult, refreshTokenResult] = await Promise.allSettled([
      // Store session with optimized Redis service
      storeSessionOptimized(sessionId, teacher, school, req),
      
      // Store refresh token
      redisService.storeRefreshToken(
        sessionId,
        teacher.id,
        30 * 24 * 60 * 60 // 30 days
      ),
    ]);

    const sessionStored = sessionResult.status === 'fulfilled';
    const refreshTokenStored = refreshTokenResult.status === 'fulfilled';

    // Log any storage failures but don't fail the auth if one storage operation fails
    if (sessionResult.status === 'rejected') {
      logger.error('❌ Session storage failed:', sessionResult.reason);
    }
    if (refreshTokenResult.status === 'rejected') {
      logger.error('❌ Refresh token storage failed:', refreshTokenResult.reason);
    }

    logger.debug(`🎉 PARALLEL AUTH OPERATIONS COMPLETE (${(performance.now() - parallelStart).toFixed(2)}ms)`);
    
    return {
      school,
      teacher,
      sessionStored,
      refreshTokenStored,
    };
  } catch (error) {
    logger.error('❌ Parallel auth operations failed:', error);
    throw error;
  }
}

/**
 * Enhanced error response generator with performance metrics
 */
export function createAuthErrorResponse(
  error: string,
  message: string,
  statusCode: number = 500,
  additionalData?: Record<string, any>
): {
  error: string;
  message: string;
  statusCode: number;
  timestamp: string;
  additionalData?: Record<string, any>;
} {
  return {
    error,
    message,
    statusCode,
    timestamp: new Date().toISOString(),
    ...(additionalData && { additionalData }),
  };
}

/**
 * Circuit breaker for external service calls
 */
export class AuthCircuitBreaker {
  private failures: number = 0;
  private lastFailureTime: number = 0;
  private readonly maxFailures: number;
  private readonly resetTimeMs: number;
  private readonly enabled: boolean;

  constructor() {
    this.maxFailures = parseInt(process.env.CIRCUIT_BREAKER_MAX_FAILURES || '5', 10);
    this.resetTimeMs = parseInt(process.env.CIRCUIT_BREAKER_RESET_TIME_MS || '60000', 10);
    this.enabled = process.env.CIRCUIT_BREAKER_ENABLED === 'true';
  }

  async execute<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    if (!this.enabled) {
      return await operation();
    }

    // Check if circuit is open
    if (this.isOpen()) {
      throw new Error(`Circuit breaker is OPEN for ${operationName}`);
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private isOpen(): boolean {
    if (this.failures >= this.maxFailures) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure < this.resetTimeMs) {
        return true;
      } else {
        // Reset circuit breaker
        this.failures = 0;
        return false;
      }
    }
    return false;
  }

  private onSuccess(): void {
    this.failures = 0;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    logger.warn(`⚠️  Circuit breaker failure count: ${this.failures}/${this.maxFailures}`);
  }

  getStatus(): { failures: number; isOpen: boolean; maxFailures: number } {
    return {
      failures: this.failures,
      isOpen: this.isOpen(),
      maxFailures: this.maxFailures,
    };
  }
}

// Singleton circuit breaker instance
export const authCircuitBreaker = new AuthCircuitBreaker();