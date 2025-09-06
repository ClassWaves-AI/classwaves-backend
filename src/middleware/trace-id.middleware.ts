import { NextFunction, Request, Response } from 'express';
import { randomUUID, randomBytes } from 'crypto';

const HEADER_NAME = 'X-Trace-Id';

function generateTraceId(): string {
  try {
    return randomUUID();
  } catch {
    return randomBytes(16).toString('hex');
  }
}

export function traceIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = (req.headers['x-trace-id'] || req.headers['x-traceid'] || req.headers['trace-id']) as string | undefined;
  const traceId = (incoming && String(incoming).trim()) || generateTraceId();

  // Expose on response locals and header
  (res.locals as any).traceId = traceId;
  res.setHeader(HEADER_NAME, traceId);

  // Attach to req for downstream logs if helpful
  (req as any).traceId = traceId;
  next();
}

export function getTraceId(res: Response): string | undefined {
  return (res.locals as any)?.traceId as string | undefined;
}

