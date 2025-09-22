import * as client from 'prom-client';

type AuthFallbackLabel = 'environment' | 'trigger';

const COUNTER_NAME = 'classwaves_auth_dev_fallback_total';
const COUNTER_HELP = 'Total number of times the auth dev fallback issued tokens';

function getCounter(): client.Counter<AuthFallbackLabel> {
  const existing = client.register.getSingleMetric(COUNTER_NAME) as client.Counter<AuthFallbackLabel> | undefined;
  if (existing) {
    return existing;
  }

  return new client.Counter<AuthFallbackLabel>({
    name: COUNTER_NAME,
    help: COUNTER_HELP,
    labelNames: ['environment', 'trigger'],
  });
}

export function recordAuthDevFallback(trigger: string): void {
  const counter = getCounter();
  const environment = process.env.NODE_ENV ?? 'development';
  counter.inc({ environment, trigger });
}
