/*
  OpenTelemetry minimal scaffolding (guarded by OTEL_ENABLED=1).
  - Uses dynamic requires to avoid hard dependency on OTEL packages.
  - Provides initOtel(), httpTraceMiddleware(), and createRouteSpanMiddleware(name).
  - If OTEL packages are unavailable, functions no-op safely.
*/

import type { Request, Response, NextFunction } from 'express';

let tracer: any = null;
let otelApi: any = null;
let provider: any = null;
let otelEnabled = false;

export function initOtel() {
  if (otelEnabled) return;
  if (process.env.OTEL_ENABLED !== '1') return;

  try {
    // Dynamic require avoids TypeScript compile-time resolution of optional deps
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { trace, context, propagation } = require('@opentelemetry/api');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resource } = require('@opentelemetry/resources');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

    const resource = new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'classwaves-backend',
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
    });

    provider = new NodeTracerProvider({ resource });

    // Optional OTLP/gRPC exporter via env var
    try {
      const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      if (endpoint) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
        const exporter = new OTLPTraceExporter({ url: endpoint });
        provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
      }
    } catch (e) {
      // Exporter optional; carry on without it
      // eslint-disable-next-line no-console
      console.warn('OTEL exporter not configured or not installed; continuing without exporter');
    }

    provider.register();
    tracer = provider.getTracer('classwaves-tracer');
    otelApi = { trace, context, propagation };
    otelEnabled = true;
    // eslint-disable-next-line no-console
    console.log('✅ OpenTelemetry initialized');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('OTEL init skipped (packages not installed or failed to load):', (e as Error).message);
    tracer = null;
    otelApi = null;
    provider = null;
    otelEnabled = false;
  }
}

export function httpTraceMiddleware() {
  return function otelHttpMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!otelEnabled || !tracer) return next();
    const name = `HTTP ${req.method} ${req.path}`;
    const span = tracer.startSpan(name, {
      attributes: {
        'http.method': req.method,
        'http.route': req.path,
        'http.target': req.originalUrl,
        'http.url': req.originalUrl,
        'http.user_agent': req.headers['user-agent'] || '',
        'x.trace_id': (res.locals as any)?.traceId || (req as any)?.traceId || '',
      },
    });

    // Close span on response finish
    res.on('finish', () => {
      try {
        span.setAttribute('http.status_code', res.statusCode);
        span.end();
      } catch {}
    });

    next();
  };
}

export function createRouteSpanMiddleware(component: string) {
  return function routeSpan(req: Request, res: Response, next: NextFunction) {
    if (!otelEnabled || !tracer) return next();
    const name = `controller:${component}`;
    const span = tracer.startSpan(name, {
      attributes: {
        'component': component,
        'http.method': req.method,
        'http.route': req.path,
        'x.trace_id': (res.locals as any)?.traceId || (req as any)?.traceId || '',
      },
    });
    res.on('finish', () => {
      try {
        span.setAttribute('http.status_code', res.statusCode);
        span.end();
      } catch {}
    });
    next();
  };
}

