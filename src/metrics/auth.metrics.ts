import type { Counter } from 'prom-client';
import client from 'prom-client';

export type AuthDevFallbackReason = 'missing_config' | 'flag_enabled' | 'forced_env';

const authDevFallbackCounter: Counter<'reason'> = (() => {
  const name = 'classwaves_auth_dev_fallback_total';
  const existing = client.register.getSingleMetric(name) as Counter<'reason'> | undefined;
  return (
    existing ||
    new client.Counter<'reason'>({
      name,
      help: 'Total number of times the dev auth fallback was executed',
      labelNames: ['reason'],
    })
  );
})();

export const recordAuthDevFallback = (reason: AuthDevFallbackReason): void => {
  authDevFallbackCounter.inc({ reason }, 1);
};

export const authMetrics = {
  recordAuthDevFallback,
};
