import * as client from 'prom-client';

// Lazily create or retrieve the counter to avoid duplicate registration
export function getSessionStartGatedCounter() {
  const existing = client.register.getSingleMetric('session_start_gated_total') as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({
    name: 'session_start_gated_total',
    help: 'Total number of session start attempts gated due to not-ready groups',
    labelNames: ['session_id'] as const,
  });
}

