import * as crypto from 'crypto';
import { Request } from 'express';
import { redisService } from './redis.service';
import { Teacher, School } from '../types/auth.types';
import { SecureJWTService } from './secure-jwt.service';
import { CacheTTLPolicy, ttlWithJitter } from './cache-ttl.policy';
import { cachePort } from '../utils/cache.port.instance';
import { makeKey, isPrefixEnabled, isDualWriteEnabled } from '../utils/key-prefix.util';

interface SecureSessionData {
  teacherId: string;
  teacher: Teacher;
  school: School;
  sessionId: string;
  deviceFingerprint: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  lastActivity: Date;
  loginAttempts?: number;
  isSuspicious?: boolean;
  geoLocation?: {
    country?: string;
    region?: string;
    city?: string;
  };
}

interface EncryptedSessionWrapper {
  iv: string;
  data: string;
  authTag: string;
  algorithm: string;
  sessionId: string; // Needed for AAD verification
}

interface LoginAttemptMetrics {
  attempts: number;
  firstAttempt: Date;
  lastAttempt: Date;
  suspiciousIPs: string[];
}

/**
 * SecureSessionService - Enhanced session management with encryption and security monitoring
 * 
 * Features:
 * - AES-256-GCM encryption for all sensitive session data
 * - Concurrent session limits enforcement (max 3 per user)
 * - Suspicious login pattern detection and alerting
 * - Session fingerprinting and validation
 * - Automatic session cleanup and security monitoring
 * - Geographic location tracking for anomaly detection
 */
export class SecureSessionService {
  private static readonly ENCRYPTION_ALGORITHM = 'aes-256-gcm';
  private static readonly ENCRYPTION_KEY_LENGTH = 32;
  private static readonly IV_LENGTH = 16;
  private static readonly AUTH_TAG_LENGTH = 16;
  private static readonly MAX_CONCURRENT_SESSIONS = 3;
  private static readonly SUSPICIOUS_LOGIN_THRESHOLD = 5;
  private static readonly SESSION_ACTIVITY_WINDOW = 5 * 60 * 1000; // 5 minutes
  private static readonly CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  
  // Derive encryption key from environment secret
  private static readonly ENCRYPTION_KEY = crypto.scryptSync(
    process.env.SESSION_ENCRYPTION_SECRET || 'fallback-insecure-key-replace-in-production', 
    'classwaves-session-salt', 
    SecureSessionService.ENCRYPTION_KEY_LENGTH
  );
  
  // SECURITY 1: Encrypt sensitive session data using AES-256-GCM
  private static encryptSessionData(data: SecureSessionData): string {
    try {
      const iv = crypto.randomBytes(this.IV_LENGTH);
      const cipher = crypto.createCipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, iv);
      cipher.setAAD(Buffer.from(data.sessionId)); // Additional authenticated data
      
      const serialized = JSON.stringify({
        ...data,
        createdAt: data.createdAt.toISOString(),
        lastActivity: data.lastActivity.toISOString()
      });
      
      let encrypted = cipher.update(serialized, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      const wrapper: EncryptedSessionWrapper = {
        iv: iv.toString('hex'),
        data: encrypted,
        authTag: authTag.toString('hex'),
        algorithm: this.ENCRYPTION_ALGORITHM,
        sessionId: data.sessionId
      };
      
      return JSON.stringify(wrapper);
    } catch (error) {
      console.error('❌ Session encryption failed:', error);
      throw new Error('Failed to encrypt session data');
    }
  }
  
  // SECURITY 2: Decrypt and verify session data integrity
  private static decryptSessionData(encryptedData: string): SecureSessionData | null {
    try {
      const wrapper: EncryptedSessionWrapper = JSON.parse(encryptedData);
      
      // Verify algorithm matches expected
      if (wrapper.algorithm !== this.ENCRYPTION_ALGORITHM) {
        console.error('🚨 Session decryption failed: algorithm mismatch');
        return null;
      }
      
      const decipher = crypto.createDecipheriv(this.ENCRYPTION_ALGORITHM, this.ENCRYPTION_KEY, Buffer.from(wrapper.iv, 'hex'));
      decipher.setAAD(Buffer.from(wrapper.sessionId)); // Use actual sessionId for AAD
      decipher.setAuthTag(Buffer.from(wrapper.authTag, 'hex'));
      
      let decrypted = decipher.update(wrapper.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const sessionData = JSON.parse(decrypted);
      
      return {
        ...sessionData,
        createdAt: new Date(sessionData.createdAt),
        lastActivity: new Date(sessionData.lastActivity)
      };
    } catch (error) {
      console.error('🚨 Session decryption failed:', error);
      return null;
    }
  }
  
  // SECURITY 3: Store session with comprehensive security features
  static async storeSecureSession(
    sessionId: string, 
    teacher: Teacher, 
    school: School, 
    req: Request
  ): Promise<void> {
    console.log('🔧 DEBUG: Starting SecureSessionService.storeSecureSession');
    console.log('🔧 DEBUG: Session storage input:', {
      sessionId,
      teacherId: teacher.id,
      schoolId: school.id,
      requestIP: req.ip,
      userAgent: req.headers['user-agent']
    });
    
    const storeStart = performance.now();
    
    try {
      // SECURITY 4: Enforce concurrent session limits
      console.log('🔧 DEBUG: Enforcing session limits');
      await this.enforceSessionLimits(teacher.id);
      console.log('🔧 DEBUG: Session limits enforced successfully');
      
      // SECURITY 5: Track and analyze login patterns
      console.log('🔧 DEBUG: Tracking login metrics');
      const isFirstLogin = await this.trackLoginMetrics(teacher.id, req.ip!);
      console.log('🔧 DEBUG: Login metrics tracked - First login:', isFirstLogin);
      
      // SECURITY 6: Detect suspicious login patterns
      console.log('🔧 DEBUG: Detecting suspicious activity');
      const isSuspicious = await this.detectSuspiciousActivity(teacher.id, req);
      console.log('🔧 DEBUG: Suspicious activity check completed - Suspicious:', isSuspicious);
      
      console.log('🔧 DEBUG: Creating session data object');
      const sessionData: SecureSessionData = {
        teacherId: teacher.id,
        teacher,
        school,
        sessionId,
        deviceFingerprint: SecureJWTService.createDeviceFingerprint(req),
        ipAddress: req.ip!,
        userAgent: req.headers['user-agent'] || '',
        createdAt: new Date(),
        lastActivity: new Date(),
        isSuspicious
      };
      console.log('🔧 DEBUG: Session data object created');
      
      // Add geographic information if available
      if (req.headers['cf-ipcountry']) {
        console.log('🔧 DEBUG: Adding geographic information');
        sessionData.geoLocation = {
          country: req.headers['cf-ipcountry'] as string,
          region: req.headers['cf-ipregion'] as string,
          city: req.headers['cf-ipcity'] as string
        };
      } else {
        console.log('🔧 DEBUG: No geographic information available');
      }
      
      console.log('🔧 DEBUG: Encrypting session data');
      const encryptedData = this.encryptSessionData(sessionData);
      console.log('🔧 DEBUG: Session data encrypted successfully');
      
      // Store encrypted session with sliding expiration
      console.log('🔧 DEBUG: Storing encrypted session in Redis');
      const sessionTTL = ttlWithJitter(CacheTTLPolicy.secureSession);
      {
        const legacy = `secure_session:${sessionId}`;
        const prefixed = makeKey('secure_session', sessionId);
        if (isPrefixEnabled()) {
          await cachePort.set(prefixed, encryptedData, sessionTTL);
          if (isDualWriteEnabled()) {
            await cachePort.set(legacy, encryptedData, sessionTTL);
          }
        } else {
          await cachePort.set(legacy, encryptedData, sessionTTL);
        }
      }
      console.log('🔧 DEBUG: Encrypted session stored in Redis successfully');
      
      // Track active sessions for the teacher
      console.log('🔧 DEBUG: Adding session to teacher active sessions set');
      {
        const legacySet = `teacher_sessions:${teacher.id}`;
        const prefixedSet = makeKey('teacher_sessions', teacher.id);
        const client = redisService.getClient();
        if (isPrefixEnabled()) {
          await client.sadd(prefixedSet, sessionId);
          await client.expire(prefixedSet, ttlWithJitter(CacheTTLPolicy.teacherSessionsSet));
          if (isDualWriteEnabled()) {
            await client.sadd(legacySet, sessionId);
            await client.expire(legacySet, ttlWithJitter(CacheTTLPolicy.teacherSessionsSet));
          }
        } else {
          await client.sadd(legacySet, sessionId);
          await client.expire(legacySet, ttlWithJitter(CacheTTLPolicy.teacherSessionsSet));
        }
      }
      console.log('🔧 DEBUG: Session added to teacher active sessions set');
      
      // Store session metadata for monitoring
      console.log('🔧 DEBUG: Storing session metadata');
      await this.storeSessionMetadata(sessionId, teacher.id, req);
      console.log('🔧 DEBUG: Session metadata stored successfully');
      
      const storeTime = performance.now() - storeStart;
      console.log(`🔒 Secure session stored: ${sessionId} (${storeTime.toFixed(2)}ms) - Suspicious: ${isSuspicious}`);
      
      // Alert if suspicious activity detected
      if (isSuspicious) {
        console.log('🔧 DEBUG: Alerting suspicious session');
        await this.alertSuspiciousSession(teacher.id, sessionId, req);
        console.log('🔧 DEBUG: Suspicious session alert sent');
      }
      
      console.log('🔧 DEBUG: SecureSessionService.storeSecureSession completed successfully');
      
    } catch (error) {
      console.error('🔧 DEBUG: ERROR in SecureSessionService.storeSecureSession:', error);
      console.error('🔧 DEBUG: Session storage error details:', {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack trace',
        name: error instanceof Error ? error.name : 'Unknown'
      });
      console.error(`❌ Secure session storage failed for ${sessionId}:`, error);
      throw error;
    }
  }
  
  // SECURITY 6.5: Update session data during token rotation
  static async updateSessionOnRotation(
    sessionId: string,
    newDeviceFingerprint: string,
    req: Request
  ): Promise<void> {
    console.log('🔄 Starting session update for token rotation');
    
    try {
      // First retrieve the existing session data
      const existingSessionData = await this.getSecureSession(sessionId, req);
      
      if (!existingSessionData) {
        console.warn(`⚠️ Session ${sessionId} not found during rotation - may have expired`);
        return;
      }
      
      // Update session data with new device fingerprint and activity timestamp
      const updatedSessionData: SecureSessionData = {
        ...existingSessionData,
        deviceFingerprint: newDeviceFingerprint,
        lastActivity: new Date(),
        // Clear any suspicious flags since this is a valid rotation
        isSuspicious: false
      };
      
      console.log('🔄 Encrypting updated session data...');
      const encryptedSessionData = this.encryptSessionData(updatedSessionData);
      
      // Store the updated session with same TTL as original
      const sessionTtl = 86400; // 24 hours in seconds (SESSION_TTL equivalent)
      {
        const legacy = `secure_session:${sessionId}`;
        const prefixed = makeKey('secure_session', sessionId);
        const payload = JSON.stringify(encryptedSessionData);
        if (isPrefixEnabled()) {
          await cachePort.set(prefixed, payload, sessionTtl);
          if (isDualWriteEnabled()) {
            await cachePort.set(legacy, payload, sessionTtl);
          }
        } else {
          await cachePort.set(legacy, payload, sessionTtl);
        }
      }
      
      console.log(`✅ Session ${sessionId} successfully updated with new device fingerprint`);
      
    } catch (error) {
      console.error(`❌ Failed to update session during token rotation for ${sessionId}:`, error);
      throw new Error(`Session update failed during token rotation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // SECURITY 7: Retrieve and verify secure session
  static async getSecureSession(sessionId: string, req?: Request): Promise<SecureSessionData | null> {
    const retrieveStart = performance.now();
    
    try {
      const legacy = `secure_session:${sessionId}`;
      const prefixed = makeKey('secure_session', sessionId);
      const encryptedData = isPrefixEnabled()
        ? (await cachePort.get(prefixed)) ?? (await cachePort.get(legacy))
        : await cachePort.get(legacy);
      
      if (!encryptedData) {
        console.log(`ℹ️  Session not found: ${sessionId}`);
        return null;
      }
      
      const sessionData = this.decryptSessionData(encryptedData);
      
      if (!sessionData) {
        console.error(`🚨 Failed to decrypt session: ${sessionId}`);
        await this.removeCorruptedSession(sessionId);
        return null;
      }
      
      // SECURITY 8: Validate session integrity
      if (req) {
        const isValid = await this.validateSessionIntegrity(sessionData, req);
        if (!isValid) {
          console.warn(`🚨 Session integrity validation failed: ${sessionId}`);
          await this.invalidateSession(sessionId, 'Integrity validation failed');
          return null;
        }
      }
      
      // Update last activity
      sessionData.lastActivity = new Date();
      const updatedEncryptedData = this.encryptSessionData(sessionData);
      {
        const legacy = `secure_session:${sessionId}`;
        const prefixed = makeKey('secure_session', sessionId);
        const ttl = ttlWithJitter(CacheTTLPolicy.secureSession);
        if (isPrefixEnabled()) {
          await cachePort.set(prefixed, updatedEncryptedData, ttl);
          if (isDualWriteEnabled()) await cachePort.set(legacy, updatedEncryptedData, ttl);
        } else {
          await cachePort.set(legacy, updatedEncryptedData, ttl);
        }
      }
      
      const retrieveTime = performance.now() - retrieveStart;
      console.log(`🔓 Secure session retrieved: ${sessionId} (${retrieveTime.toFixed(2)}ms)`);
      
      return sessionData;
    } catch (error) {
      console.error(`❌ Secure session retrieval failed for ${sessionId}:`, error);
      return null;
    }
  }
  
  // SECURITY 9: Enforce concurrent session limits
  private static async enforceSessionLimits(teacherId: string): Promise<void> {
    try {
      const client = redisService.getClient();
      const legacySet = `teacher_sessions:${teacherId}`;
      const prefixedSet = makeKey('teacher_sessions', teacherId);
      const activeSessions = isPrefixEnabled()
        ? (await client.smembers(prefixedSet)).length > 0
          ? await client.smembers(prefixedSet)
          : await client.smembers(legacySet)
        : await client.smembers(legacySet);
      
      // Remove expired sessions from the set
      const validSessions: string[] = [];
      for (const sessionId of activeSessions) {
        const legacy = `secure_session:${sessionId}`;
        const prefixed = makeKey('secure_session', sessionId);
        const exists = isPrefixEnabled()
          ? (await client.exists(prefixed)) || (await client.exists(legacy))
          : await client.exists(legacy);
        if (exists) {
          validSessions.push(sessionId);
        }
      }
      
      // Update the set with only valid sessions
      if (validSessions.length !== activeSessions.length) {
        if (isPrefixEnabled()) {
          await client.del(prefixedSet);
          if (validSessions.length > 0) {
            await client.sadd(prefixedSet, ...validSessions);
            await client.expire(prefixedSet, ttlWithJitter(CacheTTLPolicy.teacherSessionsSet));
          }
          if (isDualWriteEnabled()) {
            await client.del(legacySet);
            if (validSessions.length > 0) {
              await client.sadd(legacySet, ...validSessions);
              await client.expire(legacySet, ttlWithJitter(CacheTTLPolicy.teacherSessionsSet));
            }
          }
        } else {
          await client.del(legacySet);
          if (validSessions.length > 0) {
            await client.sadd(legacySet, ...validSessions);
            await client.expire(legacySet, ttlWithJitter(CacheTTLPolicy.teacherSessionsSet));
          }
        }
      }
      
      // Enforce limit by removing oldest sessions
      if (validSessions.length >= this.MAX_CONCURRENT_SESSIONS) {
        // Get creation times to determine oldest sessions
        const sessionTimes: { sessionId: string; createdAt: Date }[] = [];
        
        for (const sessionId of validSessions) {
          const sessionData = await this.getSecureSession(sessionId);
          if (sessionData) {
            sessionTimes.push({ sessionId, createdAt: sessionData.createdAt });
          }
        }
        
        // Sort by creation time (oldest first)
        sessionTimes.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        
        // Remove oldest sessions to make room for new one
        const sessionsToRemove = sessionTimes.slice(0, validSessions.length - this.MAX_CONCURRENT_SESSIONS + 1);
        
        for (const { sessionId } of sessionsToRemove) {
          await this.invalidateSession(sessionId, 'Concurrent session limit exceeded');
          await redisService.getClient().srem(`teacher_sessions:${teacherId}`, sessionId);
        }
        
        console.log(`🔒 Enforced session limit for teacher ${teacherId}, removed ${sessionsToRemove.length} sessions`);
      }
    } catch (error) {
      console.error(`❌ Session limit enforcement failed for teacher ${teacherId}:`, error);
    }
  }
  
  // SECURITY 10: Track and analyze login metrics for suspicious activity detection
  private static async trackLoginMetrics(teacherId: string, ipAddress: string): Promise<boolean> {
    try {
      const timeWindow = Math.floor(Date.now() / (5 * 60 * 1000)); // 5-minute windows
      const ipKey = `login_attempts:${ipAddress}:${timeWindow}`;
      const teacherKey = `teacher_logins:${teacherId}:${timeWindow}`;
      
      // Track IP-based attempts
      const ipAttempts = await redisService.getClient().incr(ipKey);
      await redisService.getClient().expire(ipKey, 300); // 5 minutes
      
      // Track teacher-based attempts
      const teacherAttempts = await redisService.getClient().incr(teacherKey);
      await redisService.getClient().expire(teacherKey, 300); // 5 minutes
      
      // Store detailed metrics
      const metricsKey = `login_metrics:${teacherId}`;
      const existingMetrics = await redisService.get(metricsKey);
      
      let metrics: LoginAttemptMetrics;
      if (existingMetrics) {
        metrics = JSON.parse(existingMetrics);
        metrics.attempts++;
        metrics.lastAttempt = new Date();
        if (!metrics.suspiciousIPs.includes(ipAddress) && ipAttempts > this.SUSPICIOUS_LOGIN_THRESHOLD) {
          metrics.suspiciousIPs.push(ipAddress);
        }
      } else {
        metrics = {
          attempts: 1,
          firstAttempt: new Date(),
          lastAttempt: new Date(),
          suspiciousIPs: ipAttempts > this.SUSPICIOUS_LOGIN_THRESHOLD ? [ipAddress] : []
        };
      }
      
      await redisService.set(metricsKey, JSON.stringify(metrics), 86400); // 24 hours
      
      // Return true if this appears to be the first login from this location
      return !existingMetrics;
    } catch (error) {
      console.error(`❌ Login metrics tracking failed:`, error);
      return false;
    }
  }
  
  // SECURITY 11: Detect suspicious login activity
  private static async detectSuspiciousActivity(teacherId: string, req: Request): Promise<boolean> {
    try {
      const checks = await Promise.all([
        this.checkRapidLoginAttempts(teacherId),
        this.checkUnusualLocation(teacherId, req),
        this.checkDeviceFingerprint(teacherId, req),
        this.checkTimeBasedAnomalies(teacherId)
      ]);
      
      const suspiciousFlags = checks.filter(Boolean).length;
      const isSuspicious = suspiciousFlags >= 2; // Require 2+ flags for suspicious classification
      
      if (isSuspicious) {
        console.warn(`🚨 Suspicious login detected for teacher ${teacherId}: ${suspiciousFlags} flags`);
      }
      
      return isSuspicious;
    } catch (error) {
      console.error(`❌ Suspicious activity detection failed:`, error);
      return false;
    }
  }
  
  // Check for rapid login attempts
  private static async checkRapidLoginAttempts(teacherId: string): Promise<boolean> {
    const key = `rapid_logins:${teacherId}`;
    const attempts = await redisService.getClient().incr(key);
    await redisService.getClient().expire(key, 300); // 5 minutes
    
    return attempts > 3; // More than 3 logins in 5 minutes
  }
  
  // Check for unusual geographic location
  private static async checkUnusualLocation(teacherId: string, req: Request): Promise<boolean> {
    const currentCountry = req.headers['cf-ipcountry'] as string;
    if (!currentCountry) return false;
    
    const locationKey = `teacher_locations:${teacherId}`;
    const knownLocations = await redisService.get(locationKey);
    
    if (!knownLocations) {
      // First time login, store location
      await redisService.set(locationKey, JSON.stringify([currentCountry]), 86400 * 30); // 30 days
      return false;
    }
    
    const locations: string[] = JSON.parse(knownLocations);
    const isNewLocation = !locations.includes(currentCountry);
    
    if (isNewLocation) {
      // Add new location
      locations.push(currentCountry);
      await redisService.set(locationKey, JSON.stringify(locations), 86400 * 30);
    }
    
    return isNewLocation;
  }
  
  // Check for unusual device fingerprint
  private static async checkDeviceFingerprint(teacherId: string, req: Request): Promise<boolean> {
    const currentFingerprint = SecureJWTService.createDeviceFingerprint(req);
    const fingerprintKey = `teacher_devices:${teacherId}`;
    const knownDevices = await redisService.get(fingerprintKey);
    
    if (!knownDevices) {
      // First time login, store device
      await redisService.set(fingerprintKey, JSON.stringify([currentFingerprint]), 86400 * 30); // 30 days
      return false;
    }
    
    const devices: string[] = JSON.parse(knownDevices);
    const isNewDevice = !devices.includes(currentFingerprint);
    
    if (isNewDevice) {
      // Add new device (limit to 5 devices)
      devices.push(currentFingerprint);
      if (devices.length > 5) {
        devices.shift(); // Remove oldest device
      }
      await redisService.set(fingerprintKey, JSON.stringify(devices), 86400 * 30);
    }
    
    return isNewDevice;
  }
  
  // Check for time-based anomalies
  private static async checkTimeBasedAnomalies(teacherId: string): Promise<boolean> {
    const now = new Date();
    const hour = now.getHours();
    
    // Flag logins outside typical work hours (6 AM - 10 PM)
    if (hour < 6 || hour > 22) {
      return true;
    }
    
    // Flag weekend logins (basic check - in production, consider school schedules)
    const dayOfWeek = now.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return true;
    }
    
    return false;
  }
  
  // SECURITY 12: Validate session integrity
  private static async validateSessionIntegrity(
    sessionData: SecureSessionData, 
    req: Request
  ): Promise<boolean> {
    try {
      // Check device fingerprint consistency
      const currentFingerprint = SecureJWTService.createDeviceFingerprint(req);
      if (sessionData.deviceFingerprint !== currentFingerprint) {
        console.warn(`🚨 Device fingerprint mismatch for session ${sessionData.sessionId}`);
        return false;
      }
      
      // Check for session hijacking indicators
      if (sessionData.ipAddress !== req.ip) {
        console.warn(`🚨 IP address changed for session ${sessionData.sessionId}: ${sessionData.ipAddress} -> ${req.ip}`);
        // Don't immediately fail - IP can change legitimately, but log for monitoring
      }
      
      // Check session age
      const sessionAge = Date.now() - sessionData.createdAt.getTime();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours
      if (sessionAge > maxAge) {
        console.warn(`🚨 Session expired due to age: ${sessionData.sessionId}`);
        return false;
      }
      
      // Check last activity
      const inactiveTime = Date.now() - sessionData.lastActivity.getTime();
      const maxInactiveTime = 4 * 60 * 60 * 1000; // 4 hours
      if (inactiveTime > maxInactiveTime) {
        console.warn(`🚨 Session expired due to inactivity: ${sessionData.sessionId}`);
        return false;
      }
      
      return true;
    } catch (error) {
      console.error(`❌ Session integrity validation failed:`, error);
      return false;
    }
  }
  
  // SECURITY 13: Store session metadata for monitoring
  private static async storeSessionMetadata(
    sessionId: string, 
    teacherId: string, 
    req: Request
  ): Promise<void> {
    const metadata = {
      sessionId,
      teacherId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      createdAt: new Date().toISOString(),
      country: req.headers['cf-ipcountry'],
      region: req.headers['cf-ipregion']
    };
    
    await redisService.set(
      `session_metadata:${sessionId}`, 
      JSON.stringify(metadata), 
      86400 // 24 hours
    );
  }
  
  // SECURITY 14: Alert on suspicious session creation
  private static async alertSuspiciousSession(
    teacherId: string, 
    sessionId: string, 
    req: Request
  ): Promise<void> {
    const alert = {
      type: 'suspicious_session',
      teacherId,
      sessionId,
      timestamp: new Date().toISOString(),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      country: req.headers['cf-ipcountry'],
      severity: 'medium'
    };
    
    console.warn(`🚨 SUSPICIOUS SESSION ALERT:`, alert);
    
    // Store alert for security monitoring
    await redisService.set(
      `security_alert:${sessionId}`, 
      JSON.stringify(alert), 
      86400 * 7 // 7 days
    );
    
    // In production: send to security monitoring system
    // await securityMonitoringService.sendAlert(alert);
  }
  
  // SECURITY 15: Invalidate session with reason logging
  static async invalidateSession(sessionId: string, reason: string): Promise<void> {
    try {
      // Get session data before deletion for logging
      const sessionData = await this.getSecureSession(sessionId);
      
      // Remove encrypted session (both legacy and prefixed when applicable)
      {
        const legacy = `secure_session:${sessionId}`;
        const prefixed = makeKey('secure_session', sessionId);
        if (isPrefixEnabled()) {
          await cachePort.del(prefixed);
          if (isDualWriteEnabled()) {
            await cachePort.del(legacy);
          }
        } else {
          await cachePort.del(legacy);
        }
      }
      
      // Remove from teacher's active sessions
      if (sessionData) {
        const legacySet = `teacher_sessions:${sessionData.teacherId}`;
        const prefixedSet = makeKey('teacher_sessions', sessionData.teacherId);
        const client = redisService.getClient();
        if (isPrefixEnabled()) {
          await client.srem(prefixedSet, sessionId);
          if (isDualWriteEnabled()) await client.srem(legacySet, sessionId);
        } else {
          await client.srem(legacySet, sessionId);
        }
      }
      
      // Remove metadata
      await redisService.getClient().del(`session_metadata:${sessionId}`);
      
      // Log invalidation
      const invalidationLog = {
        sessionId,
        teacherId: sessionData?.teacherId,
        reason,
        timestamp: new Date().toISOString()
      };
      
      await redisService.set(
        `session_invalidation:${sessionId}`, 
        JSON.stringify(invalidationLog), 
        86400 * 7 // 7 days
      );
      
      console.log(`🔒 Session invalidated: ${sessionId} - Reason: ${reason}`);
    } catch (error) {
      console.error(`❌ Session invalidation failed for ${sessionId}:`, error);
    }
  }
  
  // Helper method to remove corrupted sessions
  // Avoid recursion by directly removing keys instead of calling invalidateSession
  private static async removeCorruptedSession(sessionId: string): Promise<void> {
    try {
      const legacy = `secure_session:${sessionId}`;
      const prefixed = makeKey('secure_session', sessionId);
      // Remove encrypted session keys
      if (isPrefixEnabled()) {
        await cachePort.del(prefixed);
        if (isDualWriteEnabled()) {
          await cachePort.del(legacy);
        }
      } else {
        await cachePort.del(legacy);
      }
      // Remove metadata (best-effort)
      try { await redisService.getClient().del(`session_metadata:${sessionId}`); } catch {}
      // Record minimal invalidation log (without teacherId)
      try {
        await redisService.set(
          `session_invalidation:${sessionId}`,
          JSON.stringify({ sessionId, reason: 'Corrupted session data', timestamp: new Date().toISOString() }),
          86400 * 7
        );
      } catch {}
    } catch (e) {
      console.error('❌ removeCorruptedSession failed:', e instanceof Error ? e.message : String(e));
    }
  }
  
  // SECURITY 16: Get security metrics for monitoring
  static async getSecurityMetrics(): Promise<{
    activeSessions: number;
    suspiciousSessions: number;
    securityAlerts: number;
    sessionInvalidations: number;
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
      const [sessionKeys, alertKeys, invalidationKeys] = await Promise.all([
        scanAll('secure_session:*'),
        scanAll('security_alert:*'),
        scanAll('session_invalidation:*')
      ]);
      
      // Count suspicious sessions
      let suspiciousSessions = 0;
      for (const key of sessionKeys) {
        const sessionId = key.replace('secure_session:', '');
        const sessionData = await this.getSecureSession(sessionId);
        if (sessionData?.isSuspicious) {
          suspiciousSessions++;
        }
      }
      
      return {
        activeSessions: sessionKeys.length,
        suspiciousSessions,
        securityAlerts: alertKeys.length,
        sessionInvalidations: invalidationKeys.length
      };
    } catch (error) {
      console.error('❌ Failed to get security metrics:', error);
      return { activeSessions: 0, suspiciousSessions: 0, securityAlerts: 0, sessionInvalidations: 0 };
    }
  }
  
  // SECURITY 17: Cleanup expired sessions and alerts (periodic maintenance)
  static async performSecurityCleanup(): Promise<void> {
    try {
      console.log('🧹 Starting security cleanup...');
      
      const patterns = [
        'security_alert:*',
        'session_invalidation:*', 
        'login_metrics:*',
        'teacher_locations:*',
        'teacher_devices:*'
      ];
      
      let cleanupCount = 0;
      for (const pattern of patterns) {
        let cursor = '0';
        const client = redisService.getClient();
        do {
          // @ts-ignore ioredis scan
          const [nextCursor, batch]: [string, string[]] = await (client as any).scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
          for (const key of batch || []) {
            const ttl = await redisService.getClient().ttl(key);
            if (ttl <= 0) {
              await redisService.getClient().del(key);
              cleanupCount++;
            }
          }
          cursor = nextCursor;
        } while (cursor !== '0');
      }
      
      if (cleanupCount > 0) {
        console.log(`🧹 Cleaned up ${cleanupCount} expired security records`);
      }
    } catch (error) {
      console.error('❌ Security cleanup failed:', error);
    }
  }
}

// Start periodic security cleanup
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    SecureSessionService.performSecurityCleanup();
  }, SecureSessionService['CLEANUP_INTERVAL']);
}
