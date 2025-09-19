/*
  OpenTelemetry minimal scaffolding (guarded by OTEL_ENABLED=1).
  - Uses dynamic requires to avoid hard dependency on OTEL packages.
  - Provides initOtel(), httpTraceMiddleware(), and createRouteSpanMiddleware(name).
  - If OTEL packages are unavailable, functions no-op safely.
*/

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

let tracer: any = null;
let provider: any = null;
let otelEnabled = false;

export async function initOtel(): Promise<void> {
  if (otelEnabled) return;
  if (process.env.OTEL_ENABLED !== '1') return;

  try {
    const apiModule = await import('@opentelemetry/api');
    const trace = apiModule.trace;
    const { NodeTracerProvider } = await import('@opentelemetry/sdk-trace-node');
    const { SimpleSpanProcessor } = await import('@opentelemetry/sdk-trace-base');
    const resourcesModule = await import('@opentelemetry/resources');
    const semanticModule = await import('@opentelemetry/semantic-conventions');

    const semanticAttrs = (semanticModule as any).SemanticResourceAttributes ?? (semanticModule as any).default?.SemanticResourceAttributes;
    const resourceFactory = (resourcesModule as any).resourceFromAttributes ?? (resourcesModule as any).default?.resourceFromAttributes;

    const attributes = {
      [semanticAttrs?.SERVICE_NAME ?? 'service.name']:
        process.env.OTEL_SERVICE_NAME || 'classwaves-backend',
      [semanticAttrs?.DEPLOYMENT_ENVIRONMENT ?? 'deployment.environment']:
        process.env.NODE_ENV || 'development',
    };

    const resource = resourceFactory ? resourceFactory(attributes) : undefined;

    provider = resource
      ? new NodeTracerProvider({ resource })
      : new NodeTracerProvider();

    try {
      const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
      if (endpoint) {
        const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
        const exporter = new OTLPTraceExporter({ url: endpoint });
        provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
      }
    } catch (exporterError) {
      logger.debug('OTEL exporter not configured or not installed; continuing without exporter', {
        error: exporterError instanceof Error ? exporterError.message : String(exporterError),
      });
    }

    provider.register();
    tracer = trace.getTracer('classwaves-tracer');
    otelEnabled = true;
    logger.debug('✅ OpenTelemetry initialized');
  } catch (error) {
    logger.warn('OTEL init skipped (packages not installed or failed to load)', {
      error: error instanceof Error ? error.message : String(error),
    });
    tracer = null;
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
      } catch (error) {
        logger.debug('OTEL span finish failed', {
          name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
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
      } catch (error) {
        logger.debug('OTEL route span finish failed', {
          component,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    next();
  };
}
