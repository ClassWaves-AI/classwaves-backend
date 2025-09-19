import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger';
import type { AuthRequest } from '../types/auth.types';

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  const traceId = (res.locals as any)?.traceId || (req as any)?.traceId;
  const authReq = req as AuthRequest;
  const userId = authReq.user?.id;
  const teacherId = authReq.user?.id; // alias for clarity in logs
  const sessionId = (req.params as any)?.sessionId || (authReq as any)?.sessionId;
  const groupId = (req.params as any)?.groupId || (req.body as any)?.groupId;

  logger.info('http:start', {
    requestId: traceId,
    method: req.method,
    route: req.path,
    userId,
    teacherId,
    sessionId,
    groupId,
  });

  res.on('finish', () => {
    try {
      const end = process.hrtime.bigint();
      const durationMs = Number(end - start) / 1_000_000;
      logger.info('http:finish', {
        requestId: (res.locals as any)?.traceId || traceId,
        method: req.method,
        route: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs),
        userId,
        teacherId,
        sessionId,
        groupId,
      });
    } catch { /* intentionally ignored: best effort cleanup */ }
  });

  next();
}

