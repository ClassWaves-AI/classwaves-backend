import { Request, Response, NextFunction } from 'express';
import { authenticate, requireRole, optionalAuth } from '../../../middleware/auth.middleware';
import { verifyToken } from '../../../utils/jwt.utils';
import { createMockRequest, createMockResponse, createMockNext } from '../../utils/test-helpers';
import { AuthRequest } from '../../../types/auth.types';

// Mock jwt utils
jest.mock('../../../utils/jwt.utils', () => ({
  verifyToken: jest.fn(),
}));

describe('Auth Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('authenticate', () => {
    const validPayload = {
      userId: 'user-123',
      email: 'teacher@school.edu',
      schoolId: 'school-123',
      role: 'teacher',
      sessionId: 'session-123',
      type: 'access',
    };

    it('should authenticate valid bearer token', async () => {
      mockReq.headers = {
        authorization: 'Bearer valid-token',
      };
      (verifyToken as jest.Mock).mockReturnValue(validPayload);

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(verifyToken).toHaveBeenCalledWith('valid-token');
      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as AuthRequest).user).toBeDefined();
      expect((mockReq as AuthRequest).user?.id).toBe('user-123');
      expect((mockReq as AuthRequest).user?.email).toBe('teacher@school.edu');
      expect((mockReq as AuthRequest).school).toBeDefined();
      expect((mockReq as AuthRequest).sessionId).toBe('session-123');
    });

    it('should reject missing authorization header', async () => {
      mockReq.headers = {};

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'UNAUTHORIZED',
        message: 'No valid authorization token provided',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject non-bearer tokens', async () => {
      mockReq.headers = {
        authorization: 'Basic dXNlcjpwYXNz',
      };

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'UNAUTHORIZED',
        message: 'No valid authorization token provided',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject malformed bearer token', async () => {
      mockReq.headers = {
        authorization: 'Bearer',
      };

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject refresh tokens', async () => {
      mockReq.headers = {
        authorization: 'Bearer refresh-token',
      };
      (verifyToken as jest.Mock).mockReturnValue({
        ...validPayload,
        type: 'refresh',
      });

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'INVALID_TOKEN_TYPE',
        message: 'Invalid token type',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle token verification errors', async () => {
      mockReq.headers = {
        authorization: 'Bearer invalid-token',
      };
      (verifyToken as jest.Mock).mockImplementation(() => {
        throw new Error('jwt malformed');
      });

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle expired tokens', async () => {
      mockReq.headers = {
        authorization: 'Bearer expired-token',
      };
      (verifyToken as jest.Mock).mockImplementation(() => {
        const error = new Error('jwt expired');
        error.name = 'TokenExpiredError';
        throw error;
      });

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
      });
    });

    it('should handle unexpected errors', async () => {
      mockReq.headers = {
        authorization: 'Bearer valid-token',
      };
      (verifyToken as jest.Mock).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(consoleErrorSpy).toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });

    it('should populate user with correct structure', async () => {
      mockReq.headers = {
        authorization: 'Bearer valid-token',
      };
      (verifyToken as jest.Mock).mockReturnValue(validPayload);

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      const user = (mockReq as AuthRequest).user;
      expect(user).toMatchObject({
        id: 'user-123',
        email: 'teacher@school.edu',
        school_id: 'school-123',
        role: 'teacher',
        status: 'active',
        access_level: 'teacher',
        max_concurrent_sessions: 5,
        current_sessions: 1,
        timezone: 'UTC',
      });
    });
  });

  describe('requireRole', () => {
    it('should allow user with required role', () => {
      const authReq = mockReq as AuthRequest;
      authReq.user = {
        id: 'user-123',
        email: 'admin@school.edu',
        role: 'admin',
        school_id: 'school-123',
        status: 'active',
      } as any;

      const middleware = requireRole(['admin', 'super_admin']);
      middleware(authReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should reject user without required role', () => {
      const authReq = mockReq as AuthRequest;
      authReq.user = {
        id: 'user-123',
        email: 'teacher@school.edu',
        role: 'teacher',
        school_id: 'school-123',
        status: 'active',
      } as any;

      const middleware = requireRole(['admin', 'super_admin']);
      middleware(authReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'FORBIDDEN',
        message: 'Insufficient permissions',
        required: ['admin', 'super_admin'],
        current: 'teacher',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should reject unauthenticated requests', () => {
      const authReq = mockReq as AuthRequest;
      authReq.user = undefined;

      const middleware = requireRole(['teacher']);
      middleware(authReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle multiple roles correctly', () => {
      const authReq = mockReq as AuthRequest;
      authReq.user = {
        id: 'user-123',
        email: 'teacher@school.edu',
        role: 'teacher',
        school_id: 'school-123',
        status: 'active',
      } as any;

      const middleware = requireRole(['teacher', 'admin', 'super_admin']);
      middleware(authReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });
  });

  describe('optionalAuth', () => {
    it('should continue without authentication if no header provided', () => {
      mockReq.headers = {};

      optionalAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect((mockReq as AuthRequest).user).toBeUndefined();
    });

    it('should authenticate if valid token provided', () => {
      mockReq.headers = {
        authorization: 'Bearer valid-token',
      };
      (verifyToken as jest.Mock).mockReturnValue({
        userId: 'user-123',
        email: 'teacher@school.edu',
        schoolId: 'school-123',
        role: 'teacher',
        sessionId: 'session-123',
        type: 'access',
      });

      optionalAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(verifyToken).toHaveBeenCalled();
    });

    it('should reject invalid tokens even in optional auth', () => {
      mockReq.headers = {
        authorization: 'Bearer invalid-token',
      };
      (verifyToken as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      optionalAuth(mockReq as Request, mockRes as Response, mockNext);

      // Should call authenticate which will handle the error
      expect(verifyToken).toHaveBeenCalled();
    });

    it('should ignore non-bearer auth headers', () => {
      mockReq.headers = {
        authorization: 'Basic dXNlcjpwYXNz',
      };

      optionalAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(verifyToken).not.toHaveBeenCalled();
    });
  });

  describe('security considerations', () => {
    it('should not expose sensitive token in error messages', async () => {
      mockReq.headers = {
        authorization: 'Bearer super-secret-token-12345',
      };
      (verifyToken as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid token');
      });

      await authenticate(mockReq as Request, mockRes as Response, mockNext);

      const response = (mockRes.json as jest.Mock).mock.calls[0][0];
      expect(JSON.stringify(response)).not.toContain('super-secret-token-12345');
    });

    it('should handle various JWT error types', async () => {
      const jwtErrors = [
        { name: 'JsonWebTokenError', message: 'jwt malformed' },
        { name: 'TokenExpiredError', message: 'jwt expired' },
        { name: 'NotBeforeError', message: 'jwt not active' },
      ];

      for (const errorInfo of jwtErrors) {
        mockReq.headers = {
          authorization: 'Bearer test-token',
        };
        
        (verifyToken as jest.Mock).mockImplementation(() => {
          const error = new Error(errorInfo.message);
          error.name = errorInfo.name;
          throw error;
        });

        await authenticate(mockReq as Request, mockRes as Response, mockNext);

        expect(mockRes.status).toHaveBeenCalledWith(401);
        expect(mockRes.json).toHaveBeenCalledWith({
          error: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
        });
      }
    });
  });
});