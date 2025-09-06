/**
 * Analytics Computation Distributed Lock Service
 * 
 * Platform Stabilization P1 3.1: Implements distributed locking to prevent
 * duplicate analytics computation triggers across multiple server instances.
 */

import { redisService } from './redis.service';

interface LockOptions {
  ttl: number; // Lock TTL in seconds
  retryDelay: number; // Delay between retry attempts in ms
  retryAttempts: number; // Maximum retry attempts
  identifier?: string; // Unique identifier for this lock holder
}

interface LockResult {
  acquired: boolean;
  lockId?: string;
  lockedBy?: string;
  expiresAt?: Date;
  retryAfter?: number;
}

export class AnalyticsComputationLockService {
  private readonly LOCK_PREFIX = 'analytics_computation_lock';
  private readonly DEFAULT_TTL = 300; // 5 minutes default TTL
  private readonly DEFAULT_RETRY_DELAY = 1000; // 1 second
  private readonly DEFAULT_RETRY_ATTEMPTS = 3;
  
  private activeLocks = new Map<string, { lockId: string; expiresAt: Date }>();

  /**
   * Acquire distributed lock for analytics computation
   */
  async acquireComputationLock(
    sessionId: string,
    options?: Partial<LockOptions>
  ): Promise<LockResult> {
    const config = {
      ttl: options?.ttl || this.DEFAULT_TTL,
      retryDelay: options?.retryDelay || this.DEFAULT_RETRY_DELAY,
      retryAttempts: options?.retryAttempts || this.DEFAULT_RETRY_ATTEMPTS,
      identifier: options?.identifier || `${process.pid}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };

    const lockKey = `${this.LOCK_PREFIX}:${sessionId}`;
    const lockValue = JSON.stringify({
      identifier: config.identifier,
      pid: process.pid,
      hostname: process.env.HOSTNAME || 'unknown',
      acquiredAt: new Date().toISOString(),
      ttl: config.ttl
    });

    console.log(`🔒 Attempting to acquire analytics computation lock for session ${sessionId}`);

    for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
      try {
        // Try to set lock with NX (only if not exists) and EX (expiration)
        const result = await redisService.setWithOptions(
          lockKey,
          lockValue,
          config.ttl,
          'NX'
        );

        if (result === 'OK') {
          const expiresAt = new Date(Date.now() + (config.ttl * 1000));
          const lockId = `${sessionId}:${config.identifier}`;
          
          // Track active lock locally
          this.activeLocks.set(sessionId, {
            lockId,
            expiresAt
          });

          console.log(`✅ Analytics computation lock acquired for session ${sessionId} (expires: ${expiresAt.toISOString()})`);

          return {
            acquired: true,
            lockId,
            expiresAt
          };
        }

        // Lock exists, check who owns it and when it expires
        const existingLock = await redisService.get(lockKey);
        if (existingLock) {
          try {
            const lockData = JSON.parse(existingLock);
            console.log(`⏳ Analytics computation already locked for session ${sessionId} by ${lockData.identifier} (attempt ${attempt}/${config.retryAttempts})`);
            
            // Get remaining TTL
            const ttl = await redisService.ttl(lockKey);
            const retryAfter = ttl > 0 ? ttl * 1000 : config.retryDelay;

            if (attempt < config.retryAttempts) {
              await this.sleep(config.retryDelay);
              continue;
            }

            return {
              acquired: false,
              lockedBy: lockData.identifier,
              retryAfter
            };
          } catch (parseError) {
            console.warn(`⚠️ Invalid lock data format for session ${sessionId}:`, parseError);
          }
        }

      } catch (error) {
        console.error(`❌ Error acquiring analytics computation lock for session ${sessionId} (attempt ${attempt}):`, error);
        
        if (attempt < config.retryAttempts) {
          await this.sleep(config.retryDelay);
          continue;
        }
        
        throw new Error(`Failed to acquire analytics computation lock after ${config.retryAttempts} attempts: ${error}`);
      }
    }

    return { acquired: false };
  }

  /**
   * Release distributed lock for analytics computation
   */
  async releaseComputationLock(sessionId: string, lockId?: string): Promise<boolean> {
    const lockKey = `${this.LOCK_PREFIX}:${sessionId}`;
    
    try {
      // If lockId provided, verify we own the lock before releasing
      if (lockId) {
        const existingLock = await redisService.get(lockKey);
        if (existingLock) {
          const lockData = JSON.parse(existingLock);
          const expectedIdentifier = lockId.split(':')[1]; // Extract identifier from lockId
          
          if (lockData.identifier !== expectedIdentifier) {
            console.warn(`⚠️ Cannot release lock for session ${sessionId}: lock owned by ${lockData.identifier}, not ${expectedIdentifier}`);
            return false;
          }
        }
      }

      const result = await redisService.del(lockKey);
      const released = result > 0;

      if (released) {
        this.activeLocks.delete(sessionId);
        console.log(`🔓 Analytics computation lock released for session ${sessionId}`);
      } else {
        console.warn(`⚠️ No lock found to release for session ${sessionId}`);
      }

      return released;

    } catch (error) {
      console.error(`❌ Error releasing analytics computation lock for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Extend existing lock TTL
   */
  async extendComputationLock(sessionId: string, additionalTtl: number): Promise<boolean> {
    const lockKey = `${this.LOCK_PREFIX}:${sessionId}`;
    
    try {
      const currentTtl = await redisService.ttl(lockKey);
      if (currentTtl <= 0) {
        console.warn(`⚠️ Cannot extend expired lock for session ${sessionId}`);
        return false;
      }

      const newTtl = currentTtl + additionalTtl;
      const result = await redisService.expire(lockKey, newTtl);
      
      if (result === 1) {
        // Update local tracking
        const activeLock = this.activeLocks.get(sessionId);
        if (activeLock) {
          activeLock.expiresAt = new Date(Date.now() + (newTtl * 1000));
          this.activeLocks.set(sessionId, activeLock);
        }

        console.log(`⏰ Analytics computation lock extended for session ${sessionId} (new TTL: ${newTtl}s)`);
        return true;
      }

      return false;

    } catch (error) {
      console.error(`❌ Error extending analytics computation lock for session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Check if analytics computation is currently locked
   */
  async isComputationLocked(sessionId: string): Promise<{
    locked: boolean;
    lockedBy?: string;
    expiresAt?: Date;
    remainingTtl?: number;
  }> {
    const lockKey = `${this.LOCK_PREFIX}:${sessionId}`;
    
    try {
      const lockData = await redisService.get(lockKey);
      
      if (!lockData) {
        return { locked: false };
      }

      const parsedLock = JSON.parse(lockData);
      const ttl = await redisService.ttl(lockKey);
      const expiresAt = ttl > 0 ? new Date(Date.now() + (ttl * 1000)) : undefined;

      return {
        locked: true,
        lockedBy: parsedLock.identifier,
        expiresAt,
        remainingTtl: ttl > 0 ? ttl : 0
      };

    } catch (error) {
      console.error(`❌ Error checking analytics computation lock status for session ${sessionId}:`, error);
      return { locked: false };
    }
  }

  /**
   * Execute analytics computation with automatic locking
   */
  async executeWithLock<T>(
    sessionId: string,
    computationFn: () => Promise<T>,
    options?: Partial<LockOptions & { 
      lockExtensionInterval?: number;
      maxExecutionTime?: number;
    }>
  ): Promise<T> {
    const lockOptions = {
      ttl: options?.ttl || 300, // 5 minutes
      retryDelay: options?.retryDelay || 2000,
      retryAttempts: options?.retryAttempts || 2
    };

    const lockExtensionInterval = options?.lockExtensionInterval || 120000; // 2 minutes
    const maxExecutionTime = options?.maxExecutionTime || 600000; // 10 minutes

    // Acquire lock
    const lockResult = await this.acquireComputationLock(sessionId, lockOptions);
    
    if (!lockResult.acquired) {
      throw new Error(
        `Cannot start analytics computation for session ${sessionId}: ` +
        `${lockResult.lockedBy ? `locked by ${lockResult.lockedBy}` : 'lock acquisition failed'}` +
        `${lockResult.retryAfter ? `, retry after ${Math.round(lockResult.retryAfter / 1000)}s` : ''}`
      );
    }

    let extensionInterval: NodeJS.Timeout | null = null;
    let executionTimeout: NodeJS.Timeout | null = null;

    try {
      // Set up periodic lock extension
      extensionInterval = setInterval(async () => {
        try {
          await this.extendComputationLock(sessionId, 180); // Extend by 3 minutes
        } catch (error) {
          console.error(`❌ Failed to extend analytics computation lock for ${sessionId}:`, error);
        }
      }, lockExtensionInterval);

      // Set up maximum execution timeout
      const executionPromise = computationFn();
      const timeoutPromise = new Promise<never>((_, reject) => {
        executionTimeout = setTimeout(() => {
          reject(new Error(`Analytics computation timeout: exceeded ${maxExecutionTime}ms for session ${sessionId}`));
        }, maxExecutionTime);
      });

      const result = await Promise.race([executionPromise, timeoutPromise]);
      
      if (executionTimeout) {
        clearTimeout(executionTimeout);
      }

      return result;

    } finally {
      // Clean up timers
      if (extensionInterval) {
        clearInterval(extensionInterval);
      }
      if (executionTimeout) {
        clearTimeout(executionTimeout);
      }

      // Release lock
      await this.releaseComputationLock(sessionId, lockResult.lockId);
    }
  }

  /**
   * Get all currently active locks (for monitoring)
   */
  async getActiveLocks(): Promise<Array<{
    sessionId: string;
    lockedBy: string;
    expiresAt: Date;
    remainingTtl: number;
  }>> {
    const activeLocks: Array<{
      sessionId: string;
      lockedBy: string;
      expiresAt: Date;
      remainingTtl: number;
    }> = [];

    try {
      // Get all lock keys
      // Scan for lock keys without blocking Redis
      const client = redisService.getClient();
      let cursor = '0';
      const lockKeys: string[] = [];
      do {
        // @ts-ignore
        const [nextCursor, batch]: [string, string[]] = await (client as any).scan(cursor, 'MATCH', `${this.LOCK_PREFIX}:*`, 'COUNT', 1000);
        if (Array.isArray(batch) && batch.length) lockKeys.push(...batch);
        cursor = nextCursor;
      } while (cursor !== '0');
      
      for (const lockKey of lockKeys) {
        const sessionId = lockKey.replace(`${this.LOCK_PREFIX}:`, '');
        const lockStatus = await this.isComputationLocked(sessionId);
        
        if (lockStatus.locked && lockStatus.lockedBy && lockStatus.expiresAt) {
          activeLocks.push({
            sessionId,
            lockedBy: lockStatus.lockedBy,
            expiresAt: lockStatus.expiresAt,
            remainingTtl: lockStatus.remainingTtl || 0
          });
        }
      }

    } catch (error) {
      console.error('❌ Error retrieving active analytics computation locks:', error);
    }

    return activeLocks;
  }

  /**
   * Clean up expired locks (maintenance operation)
   */
  async cleanupExpiredLocks(): Promise<number> {
    let cleanedCount = 0;
    
    try {
      const client = redisService.getClient();
      let cursor = '0';
      const lockKeys: string[] = [];
      do {
        // @ts-ignore
        const [nextCursor, batch]: [string, string[]] = await (client as any).scan(cursor, 'MATCH', `${this.LOCK_PREFIX}:*`, 'COUNT', 1000);
        if (Array.isArray(batch) && batch.length) lockKeys.push(...batch);
        cursor = nextCursor;
      } while (cursor !== '0');
      
      for (const lockKey of lockKeys) {
        const ttl = await redisService.ttl(lockKey);
        if (ttl <= 0) {
          await redisService.del(lockKey);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`🧹 Cleaned up ${cleanedCount} expired analytics computation locks`);
      }

    } catch (error) {
      console.error('❌ Error cleaning up expired locks:', error);
    }

    return cleanedCount;
  }

  /**
   * Helper: Sleep function for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance for global use
export const analyticsComputationLockService = new AnalyticsComputationLockService();

// Set up periodic cleanup of expired locks (every 5 minutes)
if (process.env.NODE_ENV !== 'test') {
  const t = setInterval(async () => {
    try {
      await analyticsComputationLockService.cleanupExpiredLocks();
    } catch (error) {
      console.error('❌ Periodic lock cleanup failed:', error);
    }
  }, 300000); // 5 minutes
  (t as any).unref?.();
}
