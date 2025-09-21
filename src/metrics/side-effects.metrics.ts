import type { Counter } from 'prom-client';
import client from 'prom-client';

const sideEffectSuppressedCounter: Counter<'label' | 'environment'> = (() => {
  const name = 'classwaves_side_effect_suppressed_total';
  const existing = client.register.getSingleMetric(name) as Counter<'label' | 'environment'> | undefined;
  return (
    existing ||
    new client.Counter<'label' | 'environment'>({
      name,
      help: 'Counts non-critical side-effects suppressed to keep dev/test flows healthy',
      labelNames: ['label', 'environment'],
    })
  );
})();

export const recordSideEffectSuppressed = (label: string, environment: string): void => {
  sideEffectSuppressedCounter.inc({ label, environment }, 1);
};

export const sideEffectMetrics = {
  recordSideEffectSuppressed,
};

