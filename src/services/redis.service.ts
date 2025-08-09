import Redis from 'ioredis';
import { Teacher, School } from '../types/auth.types';

interface SessionData {
  teacherId: string;
  teacher: Teacher;
  school: School;
  sessionId: string;
  createdAt: Date;
  expiresAt: Date;
  ipAddress?: string;
  userAgent?: string;
}

class RedisService {
  private client: Redis;
  private connected: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const redisPassword = process.env.REDIS_PASSWORD || 'classwaves-redis-pass';
    
    // Parse Redis URL or use direct config
    let redisConfig: any = {};
    
    try {
      if (redisUrl.startsWith('redis://')) {
        const url = new URL(redisUrl);
        redisConfig = {
          host: url.hostname,
          port: parseInt(url.port || '6379', 10),
          password: url.password || redisPassword,
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
          retryStrategy: (times: number) => {
            const delay = Math.min(times * 50, 2000);
            if (times > 10) {
              console.error('Redis connection failed after 10 retries');
              return null;
            }
            return delay;
          },
          reconnectOnError: (err: Error) => {
            const targetError = 'READONLY';
            if (err.message.includes(targetError)) {
              return true;
            }
            return false;
          }
        };
      }
    } catch (error) {
      console.error('Error parsing Redis URL, using defaults:', error);
      redisConfig = {
        host: 'localhost',
        port: 6379,
        password: redisPassword,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false
      };
    }
    
    this.client = new Redis(redisConfig);

    // Attach event handlers; mocked client in tests should record these
    (this.client as any).on('connect', () => {
      this.connected = true;
    });

    (this.client as any).on('error', (_err: any) => {
      this.connected = false;
    });

    (this.client as any).on('close', () => {
      this.connected = false;
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  async storeSession(sessionId: string, data: SessionData, expiresIn: number = 3600): Promise<void> {
    const key = `session:${sessionId}`;
    const serializedData = JSON.stringify({
      ...data,
      createdAt: data.createdAt.toISOString(),
      expiresAt: data.expiresAt.toISOString()
    });
    
    await this.client.setex(key, expiresIn, serializedData);
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    const key = `session:${sessionId}`;
    
    try {
      // Add timeout to prevent Redis hanging
      const getPromise = this.client.get(key);
      const timeoutPromise = new Promise<string | null>((_, reject) => 
        setTimeout(() => reject(new Error('Redis get timeout')), 3000)
      );
      
      const data = await Promise.race([getPromise, timeoutPromise]) as string | null;
      
      if (!data) {
        return null;
      }
      
      const parsedData = JSON.parse(data);
      return {
        ...parsedData,
        createdAt: new Date(parsedData.createdAt),
        expiresAt: new Date(parsedData.expiresAt)
      };
    } catch (error) {
      // Invalid JSON should throw (unit test expectation)
      if (error instanceof SyntaxError) {
        throw error;
      }
      console.warn(`⚠️  Redis getSession timeout or error for key: ${key}`, error);
      return null; // Return null to trigger session expiry flow
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const key = `session:${sessionId}`;
    await this.client.del(key);
  }

  async extendSession(sessionId: string, expiresIn: number = 3600): Promise<boolean> {
    const key = `session:${sessionId}`;
    const result = await this.client.expire(key, expiresIn);
    return result === 1;
  }

  async getTeacherActiveSessions(teacherId: string): Promise<string[]> {
    const pattern = 'session:*';
    const keys = await this.client.keys(pattern);
    const activeSessions: string[] = [];
    
    for (const key of keys) {
      const data = await this.client.get(key);
      if (data) {
        const session = JSON.parse(data) as SessionData;
        if (session.teacherId === teacherId) {
          activeSessions.push(session.sessionId);
        }
      }
    }
    
    return activeSessions;
  }

  async storeRefreshToken(tokenId: string, teacherId: string, expiresIn: number = 2592000): Promise<void> {
    const key = `refresh:${tokenId}`;
    const data = {
      teacherId,
      createdAt: new Date().toISOString()
    };
    
    await this.client.setex(key, expiresIn, JSON.stringify(data));
  }

  async getRefreshToken(tokenId: string): Promise<{ teacherId: string; createdAt: string } | null> {
    const key = `refresh:${tokenId}`;
    const data = await this.client.get(key);
    
    if (!data) {
      return null;
    }
    
    return JSON.parse(data);
  }

  async deleteRefreshToken(tokenId: string): Promise<void> {
    const key = `refresh:${tokenId}`;
    await this.client.del(key);
  }

  async invalidateAllTeacherSessions(teacherId: string): Promise<void> {
    const sessions = await this.getTeacherActiveSessions(teacherId);
    
    for (const sessionId of sessions) {
      await this.deleteSession(sessionId);
    }
  }

  async ping(): Promise<boolean> {
    try {
      // In tests, the mocked client may not have status 'ready'. Just call ping and infer from the result.
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      console.error('Redis ping failed:', error);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
    }
  }

  async waitForConnection(timeout: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      if (this.connected && this.client.status === 'ready') {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return false;
  }

  getClient(): Redis {
    return this.client;
  }
}

let redisServiceInstance: RedisService | null = null;

export const getRedisService = (): RedisService => {
  if (!redisServiceInstance) {
    redisServiceInstance = new RedisService();
  }
  return redisServiceInstance;
};

export const redisService = {
  isConnected: () => getRedisService().isConnected(),
  storeSession: (sessionId: string, data: SessionData, expiresIn?: number) => 
    getRedisService().storeSession(sessionId, data, expiresIn),
  getSession: (sessionId: string) => getRedisService().getSession(sessionId),
  deleteSession: (sessionId: string) => getRedisService().deleteSession(sessionId),
  extendSession: (sessionId: string, expiresIn?: number) => 
    getRedisService().extendSession(sessionId, expiresIn),
  getTeacherActiveSessions: (teacherId: string) => 
    getRedisService().getTeacherActiveSessions(teacherId),
  storeRefreshToken: (tokenId: string, teacherId: string, expiresIn?: number) => 
    getRedisService().storeRefreshToken(tokenId, teacherId, expiresIn),
  getRefreshToken: (tokenId: string) => getRedisService().getRefreshToken(tokenId),
  deleteRefreshToken: (tokenId: string) => getRedisService().deleteRefreshToken(tokenId),
  invalidateAllTeacherSessions: (teacherId: string) => 
    getRedisService().invalidateAllTeacherSessions(teacherId),
  ping: () => getRedisService().ping(),
  disconnect: () => getRedisService().disconnect(),
  waitForConnection: (timeout?: number) => getRedisService().waitForConnection(timeout),
  getClient: () => getRedisService().getClient(),
  // Thin helpers used by some unit tests
  async get(key: string): Promise<string | null> {
    return getRedisService().getClient().get(key);
  },
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const client = getRedisService().getClient();
    if (ttlSeconds && ttlSeconds > 0) {
      await client.setex(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
  }
};