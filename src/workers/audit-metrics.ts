type Counters = {
  dropped: number;
  rollupFlushed: number;
  dbFailures: number;
  processed: number;
};

const counters: Counters = {
  dropped: 0,
  rollupFlushed: 0,
  dbFailures: 0,
  processed: 0,
};

let loggerTimer: NodeJS.Timeout | null = null;

export function incProcessed(by = 1) {
  counters.processed += by;
}
export function incDropped(by = 1) {
  counters.dropped += by;
}
export function incRollupFlushed(by = 1) {
  counters.rollupFlushed += by;
}
export function incDbFailures(by = 1) {
  counters.dbFailures += by;
}

export function startMetricsLogger(getQueueDepth: () => Promise<number>): void {
  if (loggerTimer) return;
  loggerTimer = setInterval(async () => {
    try {
      const depth = await getQueueDepth();
      console.log(
        JSON.stringify({
          component: 'audit_worker_metrics',
          queueDepth: depth,
          processed: counters.processed,
          dropped: counters.dropped,
          rollupFlushed: counters.rollupFlushed,
          dbFailures: counters.dbFailures,
          ts: new Date().toISOString(),
        })
      );
    } catch (e) {
      console.warn('audit metrics logger failed', e);
    }
  }, parseInt(process.env.AUDIT_METRICS_INTERVAL_MS || '30000', 10));
  (loggerTimer as any).unref?.();
}

export function stopMetricsLogger(): void {
  if (loggerTimer) {
    clearInterval(loggerTimer);
    loggerTimer = null;
  }
}

