import { NextFunction, Request, Response } from 'express';
import * as client from 'prom-client';

// Lazily register metrics once per process
const httpRequestCounter = (() => {
  const existing = client.register.getSingleMetric('http_requests_total') as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status']
  });
})();

const httpRequestDuration = (() => {
  const existing = client.register.getSingleMetric('http_request_duration_seconds') as client.Histogram<string> | undefined;
  if (existing) return existing;
  return new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.05, 0.1, 0.2, 0.4, 0.8, 1.6, 3.2, 6.4]
  });
})();

function routeLabel(req: Request): string {
  // Prefer matched route path if available; fallback to originalUrl without querystring
  const matched = (req as any).route?.path || (req as any).route?.stack?.[0]?.route?.path;
  if (matched) return String(matched);
  const url = req.originalUrl || req.url || '';
  return String(url.split('?')[0] || '/unknown');
}

export function httpMetricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const method = req.method;
  const endTimer = httpRequestDuration.startTimer();

  res.on('finish', () => {
    try {
      const status = String(res.statusCode);
      const route = routeLabel(req);
      httpRequestCounter.inc({ method, route, status });
      endTimer({ method, route, status });
    } catch {}
  });

  next();
}

