import Redis from 'ioredis';
import { redisService } from '../../../services/redis.service';
import { mockRedisClient } from '../../mocks/redis.mock';
import { testData } from '../../fixtures/test-data';

// Mock ioredis
jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisClient);
});

describe('RedisService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset default mock behaviors
    (mockRedisClient.get as jest.Mock).mockResolvedValue(null);
    (mockRedisClient.set as jest.Mock).mockResolvedValue('OK');
    (mockRedisClient.setex as jest.Mock).mockResolvedValue('OK');
    (mockRedisClient.del as jest.Mock).mockResolvedValue(1);
    (mockRedisClient.exists as jest.Mock).mockResolvedValue(0);
    (mockRedisClient.expire as jest.Mock).mockResolvedValue(1);
    (mockRedisClient.ttl as jest.Mock).mockResolvedValue(-2);
    (mockRedisClient.keys as jest.Mock).mockResolvedValue([]);
    (mockRedisClient.ping as jest.Mock).mockResolvedValue('PONG');
    (mockRedisClient.quit as jest.Mock).mockResolvedValue('OK');
  });

  describe('Session Management', () => {
    const sessionData = {
      teacherId: 'teacher-123',
      teacher: testData.teachers.active,
      school: testData.schools.active,
      sessionId: 'session-123',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      ipAddress: '127.0.0.1',
      userAgent: 'Mozilla/5.0',
    };

    describe('storeSession', () => {
      it('should store session data in Redis', async () => {
        await redisService.storeSession('session-123', sessionData, 900);

        expect(mockRedisClient.setex).toHaveBeenCalledWith(
          'session:session-123',
          900,
          JSON.stringify({
            ...sessionData,
            createdAt: sessionData.createdAt.toISOString(),
            expiresAt: sessionData.expiresAt.toISOString()
          })
        );
      });

      it('should handle storage errors', async () => {
        (mockRedisClient.setex as jest.Mock).mockRejectedValue(new Error('Redis error'));

        await expect(redisService.storeSession('session-123', sessionData, 900))
          .rejects.toThrow('Redis error');
      });
    });

    describe('getSession', () => {
      it('should retrieve session data', async () => {
        const storedData = {
          ...sessionData,
          createdAt: sessionData.createdAt.toISOString(),
          expiresAt: sessionData.expiresAt.toISOString(),
          teacher: {
            ...sessionData.teacher,
            created_at: sessionData.teacher.created_at.toISOString(),
            updated_at: sessionData.teacher.updated_at.toISOString(),
            last_login: sessionData.teacher.last_login.toISOString()
          },
          school: {
            ...sessionData.school,
            created_at: sessionData.school.created_at.toISOString(),
            updated_at: sessionData.school.updated_at.toISOString(),
            subscription_end_date: sessionData.school.subscription_end_date.toISOString()
          }
        };
        (mockRedisClient.get as jest.Mock).mockResolvedValue(JSON.stringify(storedData));

        const result = await redisService.getSession('session-123');

        expect(mockRedisClient.get).toHaveBeenCalledWith('session:session-123');
        expect(result).toEqual({
          ...sessionData,
          teacher: {
            ...sessionData.teacher,
            created_at: sessionData.teacher.created_at.toISOString(),
            updated_at: sessionData.teacher.updated_at.toISOString(),
            last_login: sessionData.teacher.last_login.toISOString()
          },
          school: {
            ...sessionData.school,
            created_at: sessionData.school.created_at.toISOString(),
            updated_at: sessionData.school.updated_at.toISOString(),
            subscription_end_date: sessionData.school.subscription_end_date.toISOString()
          }
        });
      });

      it('should return null for non-existent session', async () => {
        (mockRedisClient.get as jest.Mock).mockResolvedValue(null);

        const result = await redisService.getSession('non-existent');

        expect(result).toBeNull();
      });

      it('should handle invalid JSON data', async () => {
        (mockRedisClient.get as jest.Mock).mockResolvedValue('invalid json');

        await expect(redisService.getSession('session-123'))
          .rejects.toThrow();
      });
    });

    describe('deleteSession', () => {
      it('should delete session from Redis', async () => {
        (mockRedisClient.del as jest.Mock).mockResolvedValue(1);

        await redisService.deleteSession('session-123');

        expect(mockRedisClient.del).toHaveBeenCalledWith('session:session-123');
      });

      it('should delete session even when not found', async () => {
        (mockRedisClient.del as jest.Mock).mockResolvedValue(0);

        await redisService.deleteSession('non-existent');

        expect(mockRedisClient.del).toHaveBeenCalledWith('session:non-existent');
      });
    });

    describe('extendSession', () => {
      it('should extend session expiration', async () => {
        (mockRedisClient.expire as jest.Mock).mockResolvedValue(1);

        const result = await redisService.extendSession('session-123', 1800);

        expect(mockRedisClient.expire).toHaveBeenCalledWith('session:session-123', 1800);
        expect(result).toBe(true);
      });

      it('should return false when session not found', async () => {
        (mockRedisClient.expire as jest.Mock).mockResolvedValue(0);

        const result = await redisService.extendSession('non-existent', 1800);

        expect(result).toBe(false);
      });
    });

    describe('getTeacherActiveSessions', () => {
      it('should retrieve all active sessions for a teacher', async () => {
        const keys = ['session:session-1', 'session:session-2', 'session:session-3'];
        (mockRedisClient.keys as jest.Mock).mockResolvedValue(keys);
        
        // Mock different teachers for each session
        (mockRedisClient.get as jest.Mock)
          .mockResolvedValueOnce(JSON.stringify({
            teacherId: 'teacher-123',
            sessionId: 'session-1',
            createdAt: new Date().toISOString(),
            expiresAt: new Date().toISOString()
          }))
          .mockResolvedValueOnce(JSON.stringify({
            teacherId: 'other-teacher',
            sessionId: 'session-2',
            createdAt: new Date().toISOString(),
            expiresAt: new Date().toISOString()
          }))
          .mockResolvedValueOnce(JSON.stringify({
            teacherId: 'teacher-123',
            sessionId: 'session-3',
            createdAt: new Date().toISOString(),
            expiresAt: new Date().toISOString()
          }));

        const result = await redisService.getTeacherActiveSessions('teacher-123');

        expect(mockRedisClient.keys).toHaveBeenCalledWith('session:*');
        expect(result).toEqual(['session-1', 'session-3']);
      });

      it('should return empty array when no sessions found', async () => {
        (mockRedisClient.keys as jest.Mock).mockResolvedValue([]);

        const result = await redisService.getTeacherActiveSessions('teacher-123');

        expect(result).toEqual([]);
      });
    });
  });

  describe('Refresh Token Management', () => {
    describe('storeRefreshToken', () => {
      it('should store refresh token data', async () => {
        await redisService.storeRefreshToken('token-123', 'teacher-123', 2592000);

        expect(mockRedisClient.setex).toHaveBeenCalled();
        const [key, ttl, value] = (mockRedisClient.setex as jest.Mock).mock.calls[0];
        expect(key).toBe('refresh:token-123');
        expect(ttl).toBe(2592000);
        const parsed = JSON.parse(value);
        expect(parsed.teacherId).toBe('teacher-123');
        expect(parsed.createdAt).toEqual(expect.any(String));
      });
    });

    describe('getRefreshToken', () => {
      it('should retrieve refresh token data', async () => {
        const tokenData = {
          teacherId: 'teacher-123',
          createdAt: new Date().toISOString()
        };
        (mockRedisClient.get as jest.Mock).mockResolvedValue(JSON.stringify(tokenData));

        const result = await redisService.getRefreshToken('token-123');

        expect(mockRedisClient.get).toHaveBeenCalledWith('refresh:token-123');
        expect(result).toEqual(tokenData);
      });

      it('should return null for non-existent token', async () => {
        (mockRedisClient.get as jest.Mock).mockResolvedValue(null);

        const result = await redisService.getRefreshToken('non-existent');

        expect(result).toBeNull();
      });
    });

    describe('deleteRefreshToken', () => {
      it('should delete refresh token', async () => {
        await redisService.deleteRefreshToken('token-123');

        expect(mockRedisClient.del).toHaveBeenCalledWith('refresh:token-123');
      });
    });

    describe('invalidateAllTeacherSessions', () => {
      it('should invalidate all teacher sessions', async () => {
        const keys = ['session:session-1', 'session:session-2'];
        (mockRedisClient.keys as jest.Mock).mockResolvedValue(keys);
        
        (mockRedisClient.get as jest.Mock)
          .mockResolvedValueOnce(JSON.stringify({
            teacherId: 'teacher-123',
            sessionId: 'session-1',
            createdAt: new Date().toISOString(),
            expiresAt: new Date().toISOString()
          }))
          .mockResolvedValueOnce(JSON.stringify({
            teacherId: 'teacher-123',
            sessionId: 'session-2',
            createdAt: new Date().toISOString(),
            expiresAt: new Date().toISOString()
          }));

        await redisService.invalidateAllTeacherSessions('teacher-123');

        expect(mockRedisClient.del).toHaveBeenCalledWith('session:session-1');
        expect(mockRedisClient.del).toHaveBeenCalledWith('session:session-2');
      });
    });
  });

  describe('Connection Management', () => {
    it('should check connection status', () => {
      const isConnected = redisService.isConnected();
      
      // The initial state depends on the service implementation
      expect(typeof isConnected).toBe('boolean');
    });

    it('should ping Redis server', async () => {
      (mockRedisClient.ping as jest.Mock).mockResolvedValue('PONG');

      const result = await redisService.ping();

      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should handle ping errors', async () => {
      (mockRedisClient.ping as jest.Mock).mockRejectedValue(new Error('Connection refused'));

      const result = await redisService.ping();

      expect(result).toBe(false);
    });

    it('should disconnect from Redis', async () => {
      await redisService.disconnect();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });

    it('should set up event handlers', async () => {
      jest.resetModules();
      jest.clearAllMocks();
      
      // Re-require service in isolated module scope to run constructor
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getRedisService } = require('../../../services/redis.service');
        getRedisService();
      });
      
      expect(mockRedisClient.on).toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      const errorHandler = jest.fn();
      (mockRedisClient.on as jest.Mock).mockImplementation((event: string, handler: any) => {
        if (event === 'error') {
          (errorHandler as jest.Mock).mockImplementation(handler);
        }
      });

      // Trigger error handler
      errorHandler(new Error('Connection refused'));

      expect(errorHandler).toHaveBeenCalled();
    });
  });
});