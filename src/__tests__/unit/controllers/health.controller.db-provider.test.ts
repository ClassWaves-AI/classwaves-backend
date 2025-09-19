jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: () => ({
    getDbProvider: () => 'postgres',
    getHealthRepository: () => ({
      countFromTable: jest.fn().mockResolvedValue(1),
      getServerTime: jest.fn().mockResolvedValue({ health_check: 1, server_time: new Date().toISOString() }),
    }),
  }),
}));

jest.mock('../../../services/cache-health-monitor.service', () => ({
  cacheHealthMonitor: {
    checkHealth: jest.fn().mockResolvedValue({
      overall: 'healthy',
      redis: { latency: 1 },
    }),
  },
}));

describe('HealthController provider metadata', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('skips Databricks checks when Postgres provider is active', async () => {
    jest.resetModules();
    const { healthController } = require('../../../controllers/health.controller');

    const redisSpy = jest
      .spyOn(healthController as any, 'checkRedisHealth')
      .mockResolvedValue({ status: 'healthy', responseTime: 1, lastCheck: new Date().toISOString() });
    const dbSpy = jest
      .spyOn(healthController as any, 'checkDatabaseHealth')
      .mockResolvedValue({ status: 'healthy', responseTime: 1, lastCheck: new Date().toISOString(), details: {} });
    const databricksSpy = jest.spyOn(healthController as any, 'checkDatabricksHealth');

    const health = await healthController.getSystemHealth();

    expect(redisSpy).toHaveBeenCalled();
    expect(dbSpy).toHaveBeenCalled();
    expect(databricksSpy).not.toHaveBeenCalled();
    expect(health.dbProvider).toBe('postgres');
    expect(health.services.databricks.status).toBe('skipped');
  });
});
