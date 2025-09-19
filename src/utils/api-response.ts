import type { Response } from 'express';
import type { ApiResponse, ApiError, ErrorCode } from '@classwaves/shared';
import { ErrorCodes } from '@classwaves/shared';
import { ZodError } from 'zod';

// Build a standard ApiResponse without sending
export function buildOk<T>(data: T, requestId?: string): ApiResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    ...(requestId ? { requestId } : {}),
  };
}

export function buildError(
  code: ErrorCode,
  message: string,
  details?: Record<string, any>,
  requestId?: string
): ApiResponse<null> {
  const err: ApiError = { code, message, ...(details ? { details } : {}) };
  return {
    success: false,
    error: err,
    timestamp: new Date().toISOString(),
    ...(requestId ? { requestId } : {}),
  };
}

// Express helpers
export function ok<T>(res: Response, data: T, status = 200): Response<ApiResponse<T>> {
  const reqId = (res.locals as any)?.traceId;
  return res.status(status).json(buildOk(data, reqId));
}

export function fail(
  res: Response,
  code: ErrorCode,
  message: string,
  status = 400,
  details?: Record<string, any>
): Response<ApiResponse<null>> {
  const reqId = (res.locals as any)?.traceId;
  return res.status(status).json(buildError(code, message, details, reqId));
}

export function mapZodIssues(error: ZodError): Record<string, any> {
  return {
    issues: error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    })),
  };
}

export function failFromZod(
  res: Response,
  error: ZodError,
  source: 'body' | 'params' | 'query' = 'body'
) {
  const details = { source, ...mapZodIssues(error) };
  return fail(res, ErrorCodes.VALIDATION_ERROR, 'Invalid request data', 400, details);
}

export { ErrorCodes };

