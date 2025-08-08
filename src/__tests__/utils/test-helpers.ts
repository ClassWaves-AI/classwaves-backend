import { Request, Response } from 'express';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

// Extend Request interface to include user property
declare module 'express' {
  interface Request {
    user?: any;
  }
}

// Mock Express request
export const createMockRequest = (overrides: Partial<Request> = {}): Partial<Request> => ({
  body: {},
  query: {},
  params: {},
  headers: {},
  cookies: {},
  ip: '127.0.0.1',
  method: 'GET',
  url: '/',
  baseUrl: '',
  originalUrl: '/',
  path: '/',
  ...overrides,
});

// Mock Express response
export const createMockResponse = (): Partial<Response> => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis() as any,
    json: jest.fn().mockReturnThis() as any,
    send: jest.fn().mockReturnThis() as any,
    cookie: jest.fn().mockReturnThis() as any,
    clearCookie: jest.fn().mockReturnThis() as any,
    setHeader: jest.fn().mockReturnThis() as any,
    end: jest.fn().mockReturnThis() as any,
  };
  return res;
};

// Mock next function
export const createMockNext = () => jest.fn();

// Create authenticated request
export const createAuthenticatedRequest = (user: any, overrides: Partial<Request> = {}) => {
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      schoolId: user.school_id,
      role: user.role,
      type: 'access',
      sessionId: 'test-session-123',
    },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '15m' }
  );

  return createMockRequest({
    headers: {
      authorization: `Bearer ${token}`,
    },
    user,
    ...overrides,
  });
};

// Wait for async operations
export const waitFor = (condition: () => boolean, timeout = 5000): Promise<void> => {
  return new Promise((resolve, reject) => {
    const interval = 100;
    let elapsed = 0;

    const check = () => {
      if (condition()) {
        resolve();
      } else if (elapsed >= timeout) {
        reject(new Error('Timeout waiting for condition'));
      } else {
        elapsed += interval;
        setTimeout(check, interval);
      }
    };

    check();
  });
};

// Assert response structure
export const assertErrorResponse = (res: Partial<Response>, expectedError: string, expectedStatus = 400) => {
  expect(res.status).toHaveBeenCalledWith(expectedStatus);
  expect(res.json).toHaveBeenCalledWith(
    expect.objectContaining({
      error: expectedError,
      message: expect.any(String),
    })
  );
};

export const assertSuccessResponse = (res: Partial<Response>, expectedData?: any) => {
  expect(res.status).not.toHaveBeenCalled();
  if (expectedData) {
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining(expectedData)
    );
  } else {
    expect(res.json).toHaveBeenCalled();
  }
};

// Mock environment variables
export const setupTestEnv = (overrides: Record<string, string> = {}) => {
  const originalEnv = process.env;
  
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      JWT_SECRET: 'test-jwt-secret',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
      GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:3001/auth/google/callback',
      ...overrides,
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });
};

// Database transaction mock helpers  
export const createMockTransaction = () => ({
  begin: jest.fn() as jest.MockedFunction<() => Promise<void>>,
  commit: jest.fn() as jest.MockedFunction<() => Promise<void>>,
  rollback: jest.fn() as jest.MockedFunction<() => Promise<void>>,
});

// Rate limiting test helper
export const testRateLimit = async (
  makeRequest: () => Promise<any>,
  limit: number,
  windowMs: number
) => {
  const results: any[] = [];
  
  // Make requests up to the limit
  for (let i = 0; i < limit; i++) {
    results.push(await makeRequest());
  }
  
  // All should succeed
  results.forEach(result => {
    expect(result.status).not.toBe(429);
  });
  
  // Next request should be rate limited
  const limitedResult = await makeRequest();
  expect(limitedResult.status).toBe(429);
  
  // Wait for window to reset
  await new Promise(resolve => setTimeout(resolve, windowMs));
  
  // Should be able to make request again
  const resetResult = await makeRequest();
  expect(resetResult.status).not.toBe(429);
};

// Compliance test helpers
export const assertCOPPACompliant = (responseData: any) => {
  // Ensure no PII is exposed for students
  if (responseData.students) {
    responseData.students.forEach((student: any) => {
      expect(student).not.toHaveProperty('email');
      expect(student).not.toHaveProperty('realName');
      expect(student).not.toHaveProperty('ipAddress');
      expect(student).not.toHaveProperty('location');
    });
  }
};

export const assertFERPACompliant = (responseData: any) => {
  // Ensure educational records are properly protected
  if (responseData.sessions || responseData.analytics) {
    expect(responseData).toHaveProperty('schoolId');
    expect(responseData).toHaveProperty('teacherId');
  }
};

// Mock WebSocket for real-time tests
export const createMockWebSocket = () => ({
  send: jest.fn(),
  close: jest.fn(),
  on: jest.fn(),
  emit: jest.fn(),
  disconnect: jest.fn(),
});

// Performance test helper
export const measureExecutionTime = async (fn: () => Promise<any>) => {
  const start = process.hrtime.bigint();
  const result = await fn();
  const end = process.hrtime.bigint();
  const duration = Number(end - start) / 1_000_000; // Convert to milliseconds
  return { result, duration };
};

// Batch operation test helper
export const testBatchOperation = async (
  operation: (items: any[]) => Promise<any>,
  items: any[],
  expectedBatchSize: number
) => {
  const batches: any[][] = [];
  for (let i = 0; i < items.length; i += expectedBatchSize) {
    batches.push(items.slice(i, i + expectedBatchSize));
  }
  
  const results = await Promise.all(
    batches.map(batch => operation(batch))
  );
  
  return results.flat();
};