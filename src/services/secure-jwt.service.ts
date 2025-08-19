import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Request } from 'express';
import { Teacher, School } from '../types/auth.types';
import { redisService } from './redis.service';

interface SecureJWTPayload {
  userId: string;
  email: string;
  schoolId: string;
  sessionId: string;
  fingerprint: string;
  type: 'access' | 'refresh';
  role: string;
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
  
    // SECURITY 1: Device fingerprinting to prevent token theft
static createDeviceFingerprint(req: Request): string {
    console.log('🔧 DEBUG: Starting device fingerprint creation');
    
    const userAgent = req.headers['user-agent'] || '';
    const ip = req.ip || '';
    
    console.log('🔧 DEBUG: Fingerprint components:', {
      userAgent: userAgent,
      ip: ip,
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip']
    });
    
    // Handle potential CI environment issues
    if (!userAgent && !ip) {
      console.log('🔧 DEBUG: WARNING - Both user-agent and IP are missing, using fallback');
      const fallbackFingerprint = crypto
        .createHash(this.FINGERPRINT_ALGORITHM)
        .update('ci-environment-fallback')
        .digest('hex')
        .substring(0, 16);
      console.log('🔧 DEBUG: Fallback fingerprint created:', fallbackFingerprint);
      return fallbackFingerprint;
    }
    
    const components = [userAgent, ip];
    console.log('🔧 DEBUG: Components array:', components);
    
    const fingerprint = crypto
      .createHash(this.FINGERPRINT_ALGORITHM)
      .update(components.join('|'))
      .digest('hex')
      .substring(0, 16); // First 16 chars for storage efficiency
      
    console.log('🔧 DEBUG: Device fingerprint created:', fingerprint);
    return fingerprint;
  }
  
  // SECURITY 2: Generate secure token pair with short-lived access tokens
  static async generateSecureTokens(
    teacher: Teacher, 
    school: School, 
    sessionId: string, 
    req: Request
  ): Promise<TokenPair> {
    console.log('🔧 DEBUG: Starting SecureJWTService.generateSecureTokens');
    console.log('🔧 DEBUG: Input parameters:', {
      teacherId: teacher.id,
      schoolId: school.id,
      sessionId: sessionId,
      requestHeaders: {
        'user-agent': req.headers['user-agent'],
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'ip': req.ip
      }
    });
    
    try {
      console.log('🔧 DEBUG: Creating device fingerprint');
      const deviceFingerprint = this.createDeviceFingerprint(req);
      console.log('🔧 DEBUG: Device fingerprint created:', deviceFingerprint);
      
      const now = Math.floor(Date.now() / 1000);
      console.log('🔧 DEBUG: Current timestamp:', now);
      
      const basePayload = {
        userId: teacher.id,
        email: teacher.email,
        schoolId: school.id,
        sessionId,
        fingerprint: deviceFingerprint,
        role: teacher.role,
        iat: now
      };
      console.log('🔧 DEBUG: Base payload created:', basePayload);
      
      // Generate unique JTIs for anti-replay protection
      console.log('🔧 DEBUG: Generating JTIs');
      const accessJti = crypto.randomUUID();
      const refreshJti = crypto.randomUUID();
      console.log('🔧 DEBUG: JTIs generated:', { accessJti, refreshJti });
      
      // Check JWT secrets
      console.log('🔧 DEBUG: Checking JWT secrets availability');
      const jwtSecret = process.env.JWT_SECRET;
      const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
      console.log('🔧 DEBUG: JWT_SECRET present:', !!jwtSecret);
      console.log('🔧 DEBUG: JWT_REFRESH_SECRET present:', !!jwtRefreshSecret);
      
      if (!jwtSecret || !jwtRefreshSecret) {
        throw new Error('JWT secrets not available');
      }
      
      // Short-lived access token (15 minutes)
      console.log('🔧 DEBUG: Signing access token');
      const accessToken = jwt.sign({
        ...basePayload,
        type: 'access',
        exp: now + this.ACCESS_TOKEN_TTL,
        jti: accessJti
      }, jwtSecret);
      console.log('🔧 DEBUG: Access token signed successfully');
      
      // Longer-lived refresh token (7 days)
      console.log('🔧 DEBUG: Signing refresh token');
      const refreshToken = jwt.sign({
        ...basePayload,
        type: 'refresh',
        exp: now + this.REFRESH_TOKEN_TTL,
        jti: refreshJti
      }, jwtRefreshSecret);
      console.log('🔧 DEBUG: Refresh token signed successfully');
      
      // Store token metadata for tracking and revocation
      console.log('🔧 DEBUG: Storing token metadata');
      await this.storeTokenMetadata(accessJti, refreshJti, teacher.id, sessionId);
      console.log('🔧 DEBUG: Token metadata stored successfully');
      
      console.log(`🔐 Generated secure tokens for user ${teacher.id} - Access: ${this.ACCESS_TOKEN_TTL}s, Refresh: ${this.REFRESH_TOKEN_TTL}s`);
      
      const result = { 
        accessToken, 
        refreshToken, 
        deviceFingerprint,
        expiresIn: this.ACCESS_TOKEN_TTL,
        refreshExpiresIn: this.REFRESH_TOKEN_TTL
      };
      
      console.log('🔧 DEBUG: SecureJWTService.generateSecureTokens completed successfully');
      return result;
      
    } catch (error) {
      console.error('🔧 DEBUG: ERROR in SecureJWTService.generateSecureTokens:', error);
      console.error('🔧 DEBUG: JWT Generation error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        name: error instanceof Error ? error.name : 'Unknown'
      });
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
      const secret = tokenType === 'access' 
        ? process.env.JWT_SECRET! 
        : process.env.JWT_REFRESH_SECRET!;
        
      const payload = jwt.verify(token, secret) as SecureJWTPayload;
      
      // SECURITY 4: Verify token type matches expected
      if (payload.type !== tokenType) {
        console.warn(`🚨 Token type mismatch: expected ${tokenType}, got ${payload.type}`);
        return null;
      }
      
      // SECURITY 5: Verify device fingerprint
      const currentFingerprint = this.createDeviceFingerprint(req);
      if (payload.fingerprint !== currentFingerprint) {
        console.warn(`🚨 Device fingerprint mismatch for user ${payload.userId}:`, {
          expected: payload.fingerprint,
          actual: currentFingerprint,
          userAgent: req.headers['user-agent'],
          ip: req.ip
        });
        
        // Log suspicious activity for monitoring
        await this.logSuspiciousActivity(payload.userId, 'fingerprint_mismatch', req);
        return null;
      }
      
      // SECURITY 6: Check token blacklist (for logout/revocation)
      const isBlacklisted = await this.isTokenBlacklisted(payload.jti);
      if (isBlacklisted) {
        console.warn(`🚨 Blacklisted token attempted: ${payload.jti} for user ${payload.userId}`);
        return null;
      }
      
      // SECURITY 7: Verify token hasn't been replayed (check unique usage)
      const replayKey = `replay:${payload.jti}`;
      const hasBeenUsed = await redisService.get(replayKey);
      if (hasBeenUsed && tokenType === 'refresh') {
        console.warn(`🚨 Token replay detected: ${payload.jti} for user ${payload.userId}`);
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
      
      console.warn(`🚨 Token verification failed (${errorType}):`, error instanceof Error ? error.message : 'Unknown error');
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

    const accessToken = jwt.sign(
      { ...payload, jti },
      process.env.JWT_SECRET!,
      {
        expiresIn: this.ACCESS_TOKEN_TTL,
        // The 'iat' (issued at) claim is automatically added by the library
      }
    );

    return accessToken;
  }

  // SECURITY 8: Token rotation for enhanced security
  static async rotateTokens(
    refreshToken: string,
    req: Request
  ): Promise<TokenPair | null> {
    try {
      // Verify the refresh token
      const payload = await this.verifyTokenSecurity(refreshToken, req, 'refresh');
      if (!payload) {
        console.warn(`🚨 Invalid refresh token used for rotation`);
        return null;
      }
      
      // Get teacher and school data for new tokens
      const [teacher, school] = await Promise.all([
        this.getTeacherById(payload.userId),
        this.getSchoolById(payload.schoolId)
      ]);
      
      if (!teacher || !school) {
        console.warn(`🚨 Teacher or school not found for token rotation: ${payload.userId}`);
        return null;
      }
      
      // Blacklist the old refresh token to prevent reuse
      await this.revokeToken(payload.jti, 'Token rotation');
      
      // Generate new token pair
      const newTokens = await this.generateSecureTokens(teacher, school, payload.sessionId, req);
      
      console.log(`🔄 Token rotation successful for user ${teacher.id}`);
      return newTokens;
    } catch (error) {
      console.error(`❌ Token rotation failed:`, error);
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
    
    console.log(`🚫 Token revoked: ${jti} - Reason: ${reason}`);
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
      
      console.log(`🚫 All tokens revoked for user ${userId} - Reason: ${reason}`);
    } catch (error) {
      console.error(`❌ Failed to revoke all tokens for user ${userId}:`, error);
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
    
    console.warn(`🚨 SUSPICIOUS ACTIVITY LOGGED:`, suspiciousActivity);
    
    // In production: send to security monitoring system
    // await securityMonitoringService.alert(suspiciousActivity);
  }
  
  // Helper methods for database queries
  private static async getTeacherById(teacherId: string): Promise<Teacher | null> {
    try {
      // Import databricks service dynamically to avoid circular dependencies
      const { databricksService } = await import('./databricks.service');
      return await databricksService.queryOne<Teacher>(
        `SELECT * FROM classwaves.users.teachers WHERE id = ? AND status = 'active'`,
        [teacherId]
      );
    } catch (error) {
      console.error(`❌ Failed to get teacher ${teacherId}:`, error);
      return null;
    }
  }
  
  private static async getSchoolById(schoolId: string): Promise<School | null> {
    try {
      const { databricksService } = await import('./databricks.service');
      return await databricksService.queryOne<School>(
        `SELECT * FROM classwaves.users.schools WHERE id = ? AND subscription_status IN ('active', 'trial')`,
        [schoolId]
      );
    } catch (error) {
      console.error(`❌ Failed to get school ${schoolId}:`, error);
      return null;
    }
  }
  
  // SECURITY 14: Periodic cleanup of blacklisted tokens
  static startBlacklistCleanup(): void {
    setInterval(async () => {
      try {
        console.log('🧹 Starting blacklist cleanup...');
        
        // Get all blacklist keys
        const pattern = `${this.BLACKLIST_PREFIX}*`;
        const blacklistKeys = await redisService.getClient().keys(pattern);
        
        let cleanupCount = 0;
        for (const key of blacklistKeys) {
          const ttl = await redisService.getClient().ttl(key);
          if (ttl <= 0) {
            await redisService.getClient().del(key);
            cleanupCount++;
          }
        }
        
        if (cleanupCount > 0) {
          console.log(`🧹 Cleaned up ${cleanupCount} expired blacklist entries`);
        }
      } catch (error) {
        console.error('❌ Blacklist cleanup failed:', error);
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
      const [blacklistKeys, suspiciousKeys, tokenKeys] = await Promise.all([
        redisService.getClient().keys(`${this.BLACKLIST_PREFIX}*`),
        redisService.getClient().keys('suspicious:*'),
        redisService.getClient().keys('tokens:*')
      ]);
      
      return {
        blacklistedTokens: blacklistKeys.length,
        suspiciousActivities: suspiciousKeys.length,
        activeTokens: tokenKeys.length
      };
    } catch (error) {
      console.error('❌ Failed to get security metrics:', error);
      return { blacklistedTokens: 0, suspiciousActivities: 0, activeTokens: 0 };
    }
  }
}

// Start blacklist cleanup on service initialization
if (process.env.NODE_ENV !== 'test') {
  SecureJWTService.startBlacklistCleanup();
}
