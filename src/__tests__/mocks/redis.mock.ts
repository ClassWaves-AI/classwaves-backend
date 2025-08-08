// Mock Redis client with proper typing
export const mockRedisClient = {
  get: jest.fn(),
  set: jest.fn(),
  setex: jest.fn(),
  del: jest.fn(),
  exists: jest.fn(),
  expire: jest.fn(),
  ttl: jest.fn(),
  hget: jest.fn(),
  hset: jest.fn(),
  hdel: jest.fn(),
  hgetall: jest.fn(),
  incr: jest.fn(),
  decr: jest.fn(),
  sadd: jest.fn(),
  srem: jest.fn(),
  smembers: jest.fn(),
  sismember: jest.fn(),
  zadd: jest.fn(),
  zrem: jest.fn(),
  zrange: jest.fn(),
  zrevrange: jest.fn(),
  zscore: jest.fn(),
  keys: jest.fn(),
  ping: jest.fn(),
  pipeline: jest.fn(() => ({
    exec: jest.fn().mockResolvedValue([]),
  })),
  multi: jest.fn(() => ({
    exec: jest.fn().mockResolvedValue([]),
  })),
  scan: jest.fn().mockResolvedValue(['0', []]),
  quit: jest.fn().mockResolvedValue('OK'),
  on: jest.fn(),
};

// Mock Redis service with methods that match the actual redis service
export const mockRedisService = {
  isConnected: jest.fn().mockReturnValue(true),
  storeSession: jest.fn().mockResolvedValue(undefined),
  getSession: jest.fn().mockResolvedValue(null),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  extendSession: jest.fn().mockResolvedValue(true),
  getTeacherActiveSessions: jest.fn().mockResolvedValue([]),
  storeRefreshToken: jest.fn().mockResolvedValue(undefined),
  getRefreshToken: jest.fn().mockResolvedValue(null),
  deleteRefreshToken: jest.fn().mockResolvedValue(undefined),
  invalidateAllTeacherSessions: jest.fn().mockResolvedValue(undefined),
  ping: jest.fn().mockResolvedValue(true),
  disconnect: jest.fn().mockResolvedValue(undefined),
};

// Helper to reset all mocks
export const resetRedisMocks = () => {
  Object.values(mockRedisClient).forEach(mock => {
    if (typeof mock === 'function' && 'mockReset' in mock) {
      (mock as any).mockReset();
    }
  });
  Object.values(mockRedisService).forEach(mock => {
    if (typeof mock === 'function' && 'mockReset' in mock) {
      (mock as any).mockReset();
    }
  });
};

// Helper to setup common mock responses
export const setupRedisMocks = (overrides: Partial<typeof mockRedisService> = {}) => {
  Object.assign(mockRedisService, overrides);
  return mockRedisService;
};