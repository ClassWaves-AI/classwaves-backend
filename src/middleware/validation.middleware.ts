import { Request, Response, NextFunction } from 'express';
import { ZodError, ZodSchema } from 'zod';

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
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: error.issues.map((err: any) => ({
            field: err.path.join('.'),
            message: typeof err.message === 'string' && err.message.includes('Invalid option')
              ? err.message.replace('Invalid option', 'Invalid enum value')
              : err.message,
          })),
        });
      }
      
      console.error('🔧 DEBUG: Non-Zod validation error:', error);
      return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
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
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          details: error.issues.map((err: any) => ({
            field: err.path.join('.'),
            message: typeof err.message === 'string' && err.message.includes('Invalid option')
              ? err.message.replace('Invalid option', 'Invalid enum value')
              : err.message,
          })),
        });
      }
      
      return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
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
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Invalid path parameters',
          details: error.issues.map((err: any) => ({
            field: err.path.join('.'),
            message: typeof err.message === 'string' && err.message.includes('Invalid option')
              ? err.message.replace('Invalid option', 'Invalid enum value')
              : err.message,
          })),
        });
      }
      
      return res.status(500).json({
        error: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      });
    }
  };
}