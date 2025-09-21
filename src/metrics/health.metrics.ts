import client from 'prom-client';

const healthComponentStatusGauge = (() => {
  const name = 'classwaves_health_component_status';
  const existing = client.register.getSingleMetric(name) as client.Gauge<'provider' | 'component' | 'status'> | undefined;
  return (
    existing ||
    new client.Gauge<'provider' | 'component' | 'status'>({
      name,
      help: 'Component health status (labels: provider, component, status)',
      labelNames: ['provider', 'component', 'status'],
    })
  );
})();

export type HealthComponentStatusMap = Record<string, { status: string; detail?: string }>;

export function recordComponentStatuses(provider: string, components: HealthComponentStatusMap): void {
  healthComponentStatusGauge.reset();
  Object.entries(components).forEach(([component, info]) => {
    const status = info?.status ?? 'unknown';
    healthComponentStatusGauge.set({ provider, component, status }, 1);
  });
}
