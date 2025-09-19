import * as client from 'prom-client';

// Histogram for lightweight profiling of selected routes/segments
const histogram = (() => {
  const existing = client.register.getSingleMetric('cw_profile_segment_ms') as client.Histogram<string> | undefined;
  if (existing) return existing;
  return new client.Histogram({
    name: 'cw_profile_segment_ms',
    help: 'Profiling segments (milliseconds) for selected backend routes',
    labelNames: ['route', 'segment'],
    // Buckets in milliseconds
    buckets: [5, 10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400],
  });
})();

export async function withTiming<T>(route: string, segment: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    try { (histogram as client.Histogram<string>).observe({ route, segment }, Date.now() - start); } catch { /* intentionally ignored: best effort cleanup */ }
  }
}

export function observe(route: string, segment: string, ms: number): void {
  try { (histogram as client.Histogram<string>).observe({ route, segment }, ms); } catch { /* intentionally ignored: best effort cleanup */ }
}

