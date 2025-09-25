import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { validate, validateQuery, validateParams } from '../../../middleware/validation.middleware';
import { createMockRequest, createMockResponse, createMockNext } from '../../utils/test-helpers';

describe('Validation Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockReq = createMockRequest();
    mockRes = createMockResponse();
    mockNext = createMockNext();
    jest.clearAllMocks();
  });

  describe('validate (body validation)', () => {
    const testSchema = z.object({
      name: z.string().min(1),
      age: z.number().min(0).max(120),
      email: z.string().email(),
    });

    it('should pass valid request body', async () => {
      mockReq.body = {
        name: 'John Doe',
        age: 30,
        email: 'john@example.com',
      };

      const middleware = validate(testSchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
      expect(mockReq.body).toEqual({
        name: 'John Doe',
        age: 30,
        email: 'john@example.com',
      });
    });

    it('should transform data according to schema', async () => {
      const transformSchema = z.object({
        name: z.string().trim().toLowerCase(),
        age: z.string().transform(val => parseInt(val)),
      });

      mockReq.body = {
        name: '  JOHN DOE  ',
        age: '30',
      };

      const middleware = validate(transformSchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toEqual({
        name: 'john doe',
        age: 30,
      });
    });

    it('should reject invalid request body', async () => {
      mockReq.body = {
        name: '',
        age: 150,
        email: 'not-an-email',
      };

      const middleware = validate(testSchema);
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    const payload = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(payload.success).toBe(false);
    expect(payload.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request data',
    });
    expect(payload.error.details.source).toBe('body');
    expect(payload.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name' }),
        expect.objectContaining({ path: 'age' }),
        expect.objectContaining({ path: 'email' }),
      ])
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

    it('should handle missing required fields', async () => {
      mockReq.body = {
        name: 'John Doe',
        // missing age and email
      };

      const middleware = validate(testSchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    const response = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(response.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'age' }),
        expect.objectContaining({ path: 'email' }),
      ])
    );
    });

    it('should handle nested validation errors', async () => {
      const nestedSchema = z.object({
        user: z.object({
          profile: z.object({
            name: z.string().min(1),
            age: z.number(),
          }),
        }),
      });

      mockReq.body = {
        user: {
          profile: {
            name: '',
            age: 'not-a-number',
          },
        },
      };

      const middleware = validate(nestedSchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    const response = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(response.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'user.profile.name' }),
        expect.objectContaining({ path: 'user.profile.age' }),
      ])
    );
    });

    it('should handle async validation', async () => {
      const asyncSchema = z.object({
        username: z.string().refine(
          async (val) => {
            // Simulate async check (e.g., database lookup)
            await new Promise(resolve => setTimeout(resolve, 10));
            return val !== 'taken';
          },
          { message: 'Username already taken' }
        ),
      });

      mockReq.body = { username: 'taken' };

      const middleware = validate(asyncSchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    const response = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(response.error.details.issues).toEqual([
      expect.objectContaining({
        path: 'username',
        message: 'Username already taken',
      }),
    ]);
    });

    it('should handle unexpected errors', async () => {
      const errorSchema = z.object({
        test: z.string(),
      }).refine(() => {
        throw new Error('Unexpected error');
      });

      mockReq.body = { test: 'value' };

      const middleware = validate(errorSchema);
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(500);
    const payload = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(payload.error).toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    });
  });

  describe('validateQuery', () => {
    const querySchema = z.object({
      page: z.string().default('1').transform(val => parseInt(val)),
      limit: z.string().default('10').transform(val => parseInt(val)),
      search: z.string().optional(),
    });

    it('should validate and transform query parameters', async () => {
      mockReq.query = {
        page: '2',
        limit: '20',
        search: 'test',
      };

      const middleware = validateQuery(querySchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.query).toEqual({
        page: 2,
        limit: 20,
        search: 'test',
      });
    });

    it('should apply defaults for missing query params', async () => {
      mockReq.query = {};

      const middleware = validateQuery(querySchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.query).toEqual({
        page: 1,
        limit: 10,
      });
    });

    it('should reject invalid query parameters', async () => {
      mockReq.query = {
        page: 'not-a-number',
        limit: '-10',
      };

      const strictSchema = z.object({
        page: z.string().regex(/^\d+$/).transform(val => parseInt(val)),
        limit: z.string().regex(/^\d+$/).transform(val => parseInt(val)).pipe(
          z.number().min(1).max(100)
        ),
      });

    const middleware = validateQuery(strictSchema);
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    const payload = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.details.source).toBe('query');
    expect(Array.isArray(payload.error.details.issues)).toBe(true);
    });
  });

  describe('validateParams', () => {
    const paramsSchema = z.object({
      id: z.string().uuid(),
      action: z.enum(['start', 'stop', 'pause']),
    });

    it('should validate URL parameters', async () => {
      mockReq.params = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        action: 'start',
      };

      const middleware = validateParams(paramsSchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.params).toEqual({
        id: '123e4567-e89b-12d3-a456-426614174000',
        action: 'start',
      });
    });

    it('should reject invalid UUID parameter', async () => {
      mockReq.params = {
        id: 'not-a-uuid',
        action: 'start',
      };

    const middleware = validateParams(paramsSchema);
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    const payload = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.details.source).toBe('params');
    expect(payload.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'id' }),
      ])
    );
    });

    it('should reject invalid enum value', async () => {
      mockReq.params = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        action: 'invalid-action',
      };

      const middleware = validateParams(paramsSchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(400);
    const response = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(response.error.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'action',
          message: expect.stringContaining('Invalid option'),
        }),
      ])
    );
    });
  });

  describe('edge cases', () => {
    it('should handle empty schemas', async () => {
      const emptySchema = z.object({});
      mockReq.body = { extra: 'field' };

      const middleware = validate(emptySchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body).toEqual({});
    });

    it('should handle union schemas', async () => {
      const unionSchema = z.union([
        z.object({ type: z.literal('email'), email: z.string().email() }),
        z.object({ type: z.literal('phone'), phone: z.string().regex(/^\d{10}$/) }),
      ]);

      mockReq.body = { type: 'email', email: 'test@example.com' };

      const middleware = validate(unionSchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });

    it('should handle array schemas', async () => {
      const arraySchema = z.object({
        items: z.array(z.string()).min(1).max(5),
      });

      mockReq.body = { items: ['a', 'b', 'c'] };

      const middleware = validate(arraySchema);
      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.body.items).toHaveLength(3);
    });

    it('should provide helpful error messages', async () => {
      const schema = z.object({
        email: z.string().email('Please provide a valid email address'),
        age: z.number().min(18, 'Must be at least 18 years old'),
      });

      mockReq.body = { email: 'invalid', age: 16 };

    const middleware = validate(schema);
    await middleware(mockReq as Request, mockRes as Response, mockNext);

    const response = (mockRes.json as jest.Mock).mock.calls[0][0];
    expect(response.error.details.issues).toEqual([
      expect.objectContaining({
        path: 'email',
        message: 'Please provide a valid email address',
      }),
      expect.objectContaining({
        path: 'age',
        message: 'Must be at least 18 years old',
      }),
    ]);
  });
});
});
