import * as client from 'prom-client';

export function getSummaryGeneratedCounter() {
  const existing = client.register.getSingleMetric('summary_generated_total') as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({
    name: 'summary_generated_total',
    help: 'Total number of summaries generated',
    labelNames: ['type'] as const, // type = group | session
  });
}

export function getSummaryFailedCounter() {
  const existing = client.register.getSingleMetric('summary_failed_total') as client.Counter<string> | undefined;
  if (existing) return existing;
  return new client.Counter({
    name: 'summary_failed_total',
    help: 'Total number of summary generation failures',
    labelNames: ['type', 'reason'] as const,
  });
}

export function getSummaryLatencyHistogram() {
  const existing = client.register.getSingleMetric('summary_latency_ms') as client.Histogram<string> | undefined;
  if (existing) return existing;
  return new client.Histogram({
    name: 'summary_latency_ms',
    help: 'Latency of summary generation in milliseconds',
    labelNames: ['type'] as const,
    buckets: [100, 300, 1000, 3000, 10000, 30000, 60000]
  });
}

