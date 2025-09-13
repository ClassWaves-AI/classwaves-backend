import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';
import { fail, failFromZod, ErrorCodes } from '../utils/api-response';

export function validate(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      console.log('🔧 DEBUG: Validation middleware started');
      console.log('🔧 DEBUG: Request body to validate:', req.body);
      console.log('🔧 DEBUG: Schema type:', schema.constructor.name);
      
      req.body = await schema.parseAsync(req.body);
      
      console.log('🔧 DEBUG: Validation successful, parsed body:', req.body);
      next();
    } catch (error) {
      console.error('🔧 DEBUG: Validation failed:', error);
      
      if (error instanceof ZodError) {
        console.error('🔧 DEBUG: Zod validation errors:', error.issues);
        return failFromZod(res, error, 'body');
      }

      console.error('🔧 DEBUG: Non-Zod validation error:', error);
      return fail(res, ErrorCodes.INTERNAL_ERROR, 'An unexpected error occurred', 500);
    }
  };
}

export function validateQuery(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req.query);
      req.query = validated as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return failFromZod(res, error, 'query');
      }

      return fail(res, ErrorCodes.INTERNAL_ERROR, 'An unexpected error occurred', 500);
    }
  };
}

export function validateParams(schema: ZodSchema) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = await schema.parseAsync(req.params);
      req.params = validated as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        return failFromZod(res, error, 'params');
      }

      return fail(res, ErrorCodes.INTERNAL_ERROR, 'An unexpected error occurred', 500);
    }
  };
}
