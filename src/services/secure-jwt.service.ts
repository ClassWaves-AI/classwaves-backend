import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { Request } from 'express';
import { Teacher, School } from '../types/auth.types';
import { redisService } from './redis.service';
import { JWTConfigService } from '../config/jwt.config';
import { logger } from '../utils/logger';

interface SecureJWTPayload {
  userId: string;
  email: string;
  schoolId: string;
  sessionId: string;
  fingerprint: string;
  type: 'access' | 'refresh';
  role: string;
  roles?: string[];
  permissions?: string[];
  iss?: string;
  sub?: string;
  iat: number;
  exp: number;
  jti: string; // JWT ID for anti-replay
}

interface StudentJWTPayload extends Omit<SecureJWTPayload, 'email' | 'schoolId' | 'fingerprint'> {
  studentId: string;
  groupId: string;
  sessionCode: string;
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  deviceFingerprint: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

/**
 * SecureJWTService - Enhanced JWT security with device fingerprinting
 * 
 * Features:
 * - Device fingerprinting to prevent token theft
 * - Short-lived access tokens (15 minutes)
 * - Long-lived refresh tokens (7 days)
 * - Anti-replay protection with JWT IDs
 * - Redis-based token blacklist for immediate revocation
 * - Comprehensive token verification
 */
export class SecureJWTService {
  private static readonly FINGERPRINT_ALGORITHM = 'sha256';
  private static readonly ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes
  private static readonly REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days
  private static readonly BLACKLIST_PREFIX = 'blacklist:';
  private static readonly BLACKLIST_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  
  // Centralized JWT configuration service
  private static readonly jwtConfig = JWTConfigService.getInstance();
  
    // SECURITY 1: Device fingerprinting to prevent token theft
static createDeviceFingerprint(req: Request): string {
    // Deterministic override for tests to avoid env-dependent IP/UA mismatches
    if (process.env.NODE_ENV === 'test') {
      const override = (req.headers['x-cw-fingerprint'] as string) || '';
      if (override) {
        try {
          return crypto
            .createHash(this.FINGERPRINT_ALGORITHM)
            .update(`test-override:${override}`)
            .digest('hex')
            .substring(0, 16);
        } catch {
          // fall through to normal path
        }
      }
    }
    logger.debug('Starting device fingerprint creation');
    
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || '';
    
    logger.debug('Fingerprint components received');
    
    // Handle potential CI environment issues
    if (!userAgent && !ip) {
      logger.warn('Both user-agent and IP are missing, using fallback fingerprint');
      const fallbackFingerprint = crypto
        .createHash(this.FINGERPRINT_ALGORITHM)
        .update('ci-environment-fallback')
        .digest('hex')
        .substring(0, 16);
      logger.debug('Fallback fingerprint created');
      return fallbackFingerprint;
    }
    
    const components = [userAgent, ip];
    logger.debug('Fingerprint components array computed');
    
    const fingerprint = crypto
      .createHash(this.FINGERPRINT_ALGORITHM)
      .update(components.join('|'))
      .digest('hex')
      .substring(0, 16); // First 16 chars for storage efficiency
    
    logger.debug('Device fingerprint created');
    return fingerprint;
  }
  
  // SECURITY 2: Generate secure token pair with short-lived access tokens
  static async generateSecureTokens(
    teacher: Teacher, 
    school: School, 
    sessionId: string, 
    req: Request
  ): Promise<TokenPair> {
    logger.debug('Starting SecureJWTService.generateSecureTokens');
    
    try {
      logger.debug('Creating device fingerprint');
      const deviceFingerprint = this.createDeviceFingerprint(req);
      logger.debug('Device fingerprint created', { deviceFingerprint });
      
      const now = Math.floor(Date.now() / 1000);
      logger.debug('Current timestamp set for JWT');
      
      const basePayload = {
        userId: teacher.id,
        email: teacher.email,
        schoolId: school.id,
        sessionId,
        fingerprint: deviceFingerprint,
        role: teacher.role,
        roles: [teacher.role],
        permissions: [],
        iss: 'classwaves',
        sub: teacher.id,
        iat: now
      };
      logger.debug('JWT base payload created');
      
      // Generate unique JTIs for anti-replay protection
      logger.debug('Generating JTIs');
      const accessJti = crypto.randomUUID();
      const refreshJti = crypto.randomUUID();
      logger.debug('JTIs generated');
      
      // Check JWT secrets
      logger.debug('Checking JWT secrets availability');
      const jwtSecret = process.env.JWT_SECRET;
      const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
      logger.debug('JWT secrets presence checked');
      
      if (!jwtSecret || !jwtRefreshSecret) {
        throw new Error('JWT secrets not available');
      }
      
      // Short-lived access token (15 minutes) - Use centralized JWT configuration
      logger.debug('Signing access token');
      const accessSigningKey = SecureJWTService.jwtConfig.getSigningKey();
      const accessAlgorithm = SecureJWTService.jwtConfig.getAlgorithm();
      logger.debug('Using access token algorithm');
      
      const accessToken = jwt.sign({
        ...basePayload,
        type: 'access',
        exp: now + this.ACCESS_TOKEN_TTL,
        jti: accessJti
      }, accessSigningKey, {
        algorithm: accessAlgorithm
      });
      logger.debug('Access token signed successfully');
      
      // Longer-lived refresh token (7 days) - Use HS256 with refresh secret per auth design
      logger.debug('Signing refresh token');
      const refreshToken = jwt.sign({
        ...basePayload,
        type: 'refresh',
        exp: now + this.REFRESH_TOKEN_TTL,
        jti: refreshJti
      }, jwtRefreshSecret || SecureJWTService.jwtConfig.getJWTSecret(), {
        algorithm: 'HS256'
      });
      logger.debug('Refresh token signed successfully');
      
      // Store token metadata for tracking and revocation
      logger.debug('Storing token metadata');
      await this.storeTokenMetadata(accessJti, refreshJti, teacher.id, sessionId);
      logger.debug('Token metadata stored successfully');
      
      logger.info('Generated secure tokens for user', { userId: teacher.id, accessTtl: this.ACCESS_TOKEN_TTL, refreshTtl: this.REFRESH_TOKEN_TTL });
      
      const result = { 
        accessToken, 
        refreshToken, 
        deviceFingerprint,
        expiresIn: this.ACCESS_TOKEN_TTL,
        refreshExpiresIn: this.REFRESH_TOKEN_TTL
      };
      
      logger.debug('SecureJWTService.generateSecureTokens completed successfully');
      return result;
      
    } catch (error) {
      logger.error('ERROR in SecureJWTService.generateSecureTokens', { error: (error as any)?.message || String(error) });
      throw error;
    }
  }
  
  // SECURITY 3: Comprehensive token verification
  static async verifyTokenSecurity(
    token: string, 
    req: Request, 
    tokenType: 'access' | 'refresh' = 'access'
  ): Promise<SecureJWTPayload | null> {
    try {
      // Use centralized JWT configuration for verification
      const verificationKey = tokenType === 'access' 
        ? SecureJWTService.jwtConfig.getVerificationKey()
        : (process.env.JWT_REFRESH_SECRET! || SecureJWTService.jwtConfig.getJWTSecret());
      
      const algorithm = tokenType === 'access'
        ? SecureJWTService.jwtConfig.getAlgorithm()
        : 'HS256'; // Refresh tokens always use HS256
        
      const payload = jwt.verify(token, verificationKey, {
        algorithms: [algorithm]
      }) as SecureJWTPayload;
      
      // SECURITY 4: Verify token type matches expected
      if (payload.type !== tokenType) {
        logger.warn('Token type mismatch', { expected: tokenType, actual: payload.type });
        return null;
      }
      
      // SECURITY 5: Verify device fingerprint
      const currentFingerprint = this.createDeviceFingerprint(req);
      if (payload.fingerprint !== currentFingerprint) {
        logger.warn('Device fingerprint mismatch', { userId: payload.userId });
        
        // Log suspicious activity for monitoring
        await this.logSuspiciousActivity(payload.userId, 'fingerprint_mismatch', req);
        return null;
      }
      
      // SECURITY 6: Check token blacklist (for logout/revocation)
      const isBlacklisted = await this.isTokenBlacklisted(payload.jti);
      if (isBlacklisted) {
        logger.warn('Blacklisted token attempted', { jti: '[REDACTED]', userId: payload.userId });
        return null;
      }
      
      // SECURITY 7: Verify token hasn't been replayed (check unique usage)
      const replayKey = `replay:${payload.jti}`;
      const hasBeenUsed = await redisService.get(replayKey);
      if (hasBeenUsed && tokenType === 'refresh') {
        logger.warn('Token replay detected', { jti: '[REDACTED]', userId: payload.userId });
        await this.logSuspiciousActivity(payload.userId, 'token_replay', req);
        return null;
      }
      
      // Mark refresh token as used to prevent replay
      if (payload.type === 'refresh') {
        await redisService.set(replayKey, 'used', this.ACCESS_TOKEN_TTL);
      }
      
      return payload;
    } catch (error) {
      const errorType = error instanceof jwt.TokenExpiredError ? 'expired' : 
                       error instanceof jwt.JsonWebTokenError ? 'invalid' : 'unknown';
      logger.warn('Token verification failed', { type: errorType });
      return null;
    }
  }

  static async generateStudentToken(
    studentId: string,
    sessionId: string,
    groupId: string,
    sessionCode: string,
  ): Promise<string> {
    const jti = crypto.randomBytes(16).toString('hex');
    const now = Math.floor(Date.now() / 1000);

    const payload: Omit<StudentJWTPayload, 'iat' | 'exp' | 'jti'> = {
      userId: studentId, // For consistency with teacher payload
      studentId,
      sessionId,
      groupId,
      sessionCode,
      type: 'access',
      role: 'student',
    };

    // Generate token using centralized JWT configuration
    const accessToken = jwt.sign(
      { ...payload, jti },
      SecureJWTService.jwtConfig.getSigningKey(),
      {
        expiresIn: this.ACCESS_TOKEN_TTL,
        algorithm: SecureJWTService.jwtConfig.getAlgorithm(),
        // The 'iat' (issued at) claim is automatically added by the library
      }
    );

    return accessToken;
  }

  // REMOVED: getSigningKey() and getAlgorithm() methods
  // Now using centralized JWTConfigService for consistent algorithm detection and key management

  // SECURITY 8: Token rotation for enhanced security
  static async rotateTokens(
    refreshToken: string,
    req: Request
  ): Promise<TokenPair | null> {
    try {
      // Verify the refresh token
      const payload = await this.verifyTokenSecurity(refreshToken, req, 'refresh');
      if (!payload) {
        logger.warn('Invalid refresh token used for rotation');
        return null;
      }
      
      // Get teacher and school data for new tokens
      const [teacher, school] = await Promise.all([
        this.getTeacherById(payload.userId),
        this.getSchoolById(payload.schoolId)
      ]);
      
      if (!teacher || !school) {
        logger.warn('Teacher or school not found for token rotation', { userId: payload.userId });
        return null;
      }
      
      // Blacklist the old refresh token to prevent reuse
      await this.revokeToken(payload.jti, 'Token rotation');
      
      // Generate new token pair
      const newTokens = await this.generateSecureTokens(teacher, school, payload.sessionId, req);
      
      // CRITICAL: Update session data in Redis to sync with new device fingerprint
      // This prevents auth middleware fallback issues when session cookie is used
      try {
        const { SecureSessionService } = await import('./secure-session.service');
        logger.debug('Updating Redis session data with new device fingerprint');
        
        // Update existing session with new device fingerprint and activity timestamp
        await SecureSessionService.updateSessionOnRotation(
          payload.sessionId, 
          newTokens.deviceFingerprint, 
          req
        );
        
        logger.debug('Session updated with new device fingerprint');
      } catch (sessionError) {
        logger.error('Failed to update session data during token rotation', { error: (sessionError as any)?.message || String(sessionError) });
        // Don't fail the entire rotation, but log the issue for monitoring
        // The tokens are still valid, just the session fallback might have issues
      }
      
      logger.info('Token rotation successful', { userId: teacher.id });
      return newTokens;
    } catch (error) {
      logger.error('Token rotation failed', { error: (error as any)?.message || String(error) });
      return null;
    }
  }
  
  // SECURITY 9: Token revocation for logout and security incidents
  static async revokeToken(jti: string, reason: string = 'Manual revocation'): Promise<void> {
    const blacklistKey = `${this.BLACKLIST_PREFIX}${jti}`;
    const blacklistData = {
      revokedAt: new Date().toISOString(),
      reason,
      timestamp: Date.now()
    };
    
    // Store in blacklist with TTL equal to max token lifetime
    await redisService.set(blacklistKey, JSON.stringify(blacklistData), this.REFRESH_TOKEN_TTL);
    
    logger.info('Token revoked', { jti, reason });
  }
  
  // SECURITY 10: Check if token is blacklisted
  static async isTokenBlacklisted(jti: string): Promise<boolean> {
    const blacklistKey = `${this.BLACKLIST_PREFIX}${jti}`;
    const blacklistedData = await redisService.get(blacklistKey);
    return blacklistedData !== null;
  }
  
  // SECURITY 11: Revoke all tokens for a user (security incident response)
  static async revokeAllUserTokens(
    userId: string, 
    reason: string = 'Security incident'
  ): Promise<void> {
    try {
      // Get all active sessions for the user
      const activeSessions = await redisService.getTeacherActiveSessions(userId);
      
      // Get token metadata for all sessions
      const tokenMetadataKeys = activeSessions.map(sessionId => `tokens:${sessionId}`);
      const tokenMetadataList = await Promise.all(
        tokenMetadataKeys.map(key => redisService.get(key))
      );
      
      // Revoke all tokens
      const revocationPromises: Promise<void>[] = [];
      for (const metadata of tokenMetadataList) {
        if (metadata) {
          const { accessJti, refreshJti } = JSON.parse(metadata);
          revocationPromises.push(
            this.revokeToken(accessJti, reason),
            this.revokeToken(refreshJti, reason)
          );
        }
      }
      
      await Promise.all(revocationPromises);
      
      // Invalidate all sessions
      await redisService.invalidateAllTeacherSessions(userId);
      
      logger.info('All tokens revoked for user', { userId, reason });
    } catch (error) {
      logger.error('Failed to revoke all tokens for user', { userId, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
  
  // SECURITY 12: Store token metadata for tracking
  private static async storeTokenMetadata(
    accessJti: string,
    refreshJti: string,
    userId: string,
    sessionId: string
  ): Promise<void> {
    const metadata = {
      accessJti,
      refreshJti,
      userId,
      sessionId,
      createdAt: new Date().toISOString()
    };
    
    // Store with session expiration
    await redisService.set(
      `tokens:${sessionId}`, 
      JSON.stringify(metadata), 
      this.REFRESH_TOKEN_TTL
    );
  }
  
  // SECURITY 13: Log suspicious activity for monitoring
  private static async logSuspiciousActivity(
    userId: string,
    activityType: string,
    req: Request
  ): Promise<void> {
    const suspiciousActivity = {
      userId,
      activityType,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      headers: {
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'accept-language': req.headers['accept-language']
      }
    };
    
    // Store in Redis for security monitoring
    const key = `suspicious:${userId}:${Date.now()}`;
    await redisService.set(key, JSON.stringify(suspiciousActivity), 86400); // 24 hours
    
    logger.warn('SUSPICIOUS ACTIVITY LOGGED');
    
    // In production: send to security monitoring system
    // await securityMonitoringService.alert(suspiciousActivity);
  }
  
  // Helper methods for database queries
  private static async getTeacherById(teacherId: string): Promise<Teacher | null> {
    try {
      // Import databricks service dynamically to avoid circular dependencies
      const { databricksService } = await import('./databricks.service');
      return await databricksService.queryOne<Teacher>(
        `SELECT id, email, name, school_id, role, status FROM classwaves.users.teachers WHERE id = ? AND status = 'active'`,
        [teacherId]
      );
    } catch (error) {
      logger.error('Failed to get teacher for metrics', { teacherId, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
  
  private static async getSchoolById(schoolId: string): Promise<School | null> {
    try {
      const { databricksService } = await import('./databricks.service');
      return await databricksService.queryOne<School>(
        `SELECT id, name, domain, subscription_status, subscription_tier, ferpa_agreement, coppa_compliant FROM classwaves.users.schools WHERE id = ? AND subscription_status IN ('active', 'trial')`,
        [schoolId]
      );
    } catch (error) {
      logger.error('Failed to get school for metrics', { schoolId, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
  
  // SECURITY 14: Periodic cleanup of blacklisted tokens
  static startBlacklistCleanup(): void {
    setInterval(async () => {
      try {
        logger.debug('Starting blacklist cleanup');
        
        // Get all blacklist keys
        const pattern = `${this.BLACKLIST_PREFIX}*`;
        const client = redisService.getClient();
        let cursor = '0';
        let blacklistKeys: string[] = [];
        do {
          // @ts-ignore ioredis scan
          const [nextCursor, batch]: [string, string[]] = await (client as any).scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
          if (Array.isArray(batch) && batch.length) blacklistKeys.push(...batch);
          cursor = nextCursor;
        } while (cursor !== '0');
        
        let cleanupCount = 0;
        for (const key of blacklistKeys) {
          const ttl = await redisService.getClient().ttl(key);
          if (ttl <= 0) {
            await redisService.getClient().del(key);
            cleanupCount++;
          }
        }
        
        if (cleanupCount > 0) {
          logger.debug('Cleaned expired blacklist entries', { cleanupCount });
        }
      } catch (error) {
        logger.error('Blacklist cleanup failed', { error: error instanceof Error ? error.message : String(error) });
      }
    }, this.BLACKLIST_CLEANUP_INTERVAL);
  }
  
  // SECURITY 15: Get security metrics for monitoring
  static async getSecurityMetrics(): Promise<{
    blacklistedTokens: number;
    suspiciousActivities: number;
    activeTokens: number;
  }> {
    try {
      const client = redisService.getClient();
      const scanAll = async (pattern: string): Promise<string[]> => {
        let cursor = '0'; const acc: string[] = [];
        do {
          // @ts-ignore ioredis scan
          const [nextCursor, batch]: [string, string[]] = await (client as any).scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
          if (Array.isArray(batch) && batch.length) acc.push(...batch);
          cursor = nextCursor;
        } while (cursor !== '0');
        return acc;
      };
      const [blacklistKeys, suspiciousKeys, tokenKeys] = await Promise.all([
        scanAll(`${this.BLACKLIST_PREFIX}*`),
        scanAll('suspicious:*'),
        scanAll('tokens:*')
      ]);
      
      return {
        blacklistedTokens: blacklistKeys.length,
        suspiciousActivities: suspiciousKeys.length,
        activeTokens: tokenKeys.length
      };
    } catch (error) {
      logger.error('Failed to get security metrics', { error: error instanceof Error ? error.message : String(error) });
      return { blacklistedTokens: 0, suspiciousActivities: 0, activeTokens: 0 };
    }
  }
}

// Start blacklist cleanup on service initialization
if (process.env.NODE_ENV !== 'test') {
  SecureJWTService.startBlacklistCleanup();
}
