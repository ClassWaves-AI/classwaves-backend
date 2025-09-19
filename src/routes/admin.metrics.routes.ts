import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireAnyAdmin } from '../middleware/admin-route-security.middleware';
import { createUserRateLimiter } from '../middleware/rate-limit.middleware';
import * as client from 'prom-client';
import { ok, fail, ErrorCodes } from '../utils/api-response';

const router = Router();

// Rate limit admin metrics summary to avoid spamming
const adminMetricsLimiter = createUserRateLimiter('admin-metrics', 30, 60); // 30 req/min per user

router.get('/metrics/summary', authenticate, requireAnyAdmin, adminMetricsLimiter, async (_req, res) => {
  try {
    const httpCtr = client.register.getSingleMetric('http_requests_total') as client.Counter<string> | undefined;
    const wsCtr = client.register.getSingleMetric('ws_messages_emitted_total') as client.Counter<string> | undefined
      || (client.register.getSingleMetric('cw_ws_messages_total') as client.Counter<string> | undefined);
    const cacheHitCtr = client.register.getSingleMetric('cache_hit_total') as client.Counter<string> | undefined;
    const cacheMissCtr = client.register.getSingleMetric('cache_miss_total') as client.Counter<string> | undefined;

    const summarizeCounter = (ctr?: client.Counter<string>, statusFilter?: (labels: Record<string, string>) => boolean) => {
      if (!ctr) return 0;
      try {
        // @ts-ignore prom-client types
        const vals = ctr.get().values as Array<{ value: number; labels: Record<string, string> }>;
        return vals
          .filter(v => statusFilter ? statusFilter(v.labels) : true)
          .reduce((sum, v) => sum + (v.value || 0), 0);
      } catch { return 0; }
    };

    const httpTotal = summarizeCounter(httpCtr);
    const http4xx = summarizeCounter(httpCtr, (l) => /^4/.test(l.status || ''));
    const http5xx = summarizeCounter(httpCtr, (l) => /^5/.test(l.status || ''));
    const wsEmits = summarizeCounter(wsCtr);
    const cacheHits = summarizeCounter(cacheHitCtr);
    const cacheMisses = summarizeCounter(cacheMissCtr);

    return ok(res, {
      http: { total: httpTotal, error4xx: http4xx, error5xx: http5xx },
      ws: { messagesEmitted: wsEmits },
      cache: { hits: cacheHits, misses: cacheMisses },
      timestamp: Date.now()
    });
  } catch (e) {
    return fail(res, ErrorCodes.INTERNAL_ERROR, 'Failed to summarize metrics', 500);
  }
});

export default router;

