import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as client from 'prom-client';

const originalEnv = { ...process.env };

describe('sttBudgetService', () => {
  beforeEach(() => {
    jest.resetModules();
    client.register.clear();
    process.env = { ...originalEnv, STT_BUDGET_MINUTES_PER_DAY: '2', STT_BUDGET_ALERT_PCTS: '50,75,100' };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('tracks usage minutes with in-memory fallback', async () => {
    const redisMock = {
      isConnected: jest.fn(() => false),
      getClient: jest.fn(),
    };
    jest.doMock('../../../services/redis.service', () => ({ redisService: redisMock }));
    const { sttBudgetService } = await import('../../../services/stt.budget.service');

    await sttBudgetService.recordUsage({ schoolId: 'school-1', durationSeconds: 30 });
    await sttBudgetService.recordUsage({ schoolId: 'school-1', durationSeconds: 30 });

    const usage = await sttBudgetService.getUsage('school-1', new Date().toISOString().split('T')[0]);
    expect(usage.minutes).toBeGreaterThan(0.9); // 1 minute
    expect(redisMock.isConnected).toHaveBeenCalled();
  });

  it('emits alerts when crossing thresholds and supports acknowledgement', async () => {
    const redisMock = {
      isConnected: jest.fn(() => false),
      getClient: jest.fn(),
    };
    jest.doMock('../../../services/redis.service', () => ({ redisService: redisMock }));
    const { sttBudgetService } = await import('../../../services/stt.budget.service');

    await sttBudgetService.recordUsage({ schoolId: 'school-2', durationSeconds: 60 }); // 1 minute -> 50%
    await sttBudgetService.recordUsage({ schoolId: 'school-2', durationSeconds: 70 }); // > 100%

    const alerts = await sttBudgetService.getAlerts('school-2');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const firstAlert = alerts[0];
    expect(firstAlert.percentage).toBeGreaterThanOrEqual(50);

    await sttBudgetService.acknowledgeAlert('school-2', firstAlert.id);
    const updated = await sttBudgetService.getAlerts('school-2');
    const acknowledged = updated.find((alert) => alert.id === firstAlert.id);
    expect(acknowledged?.acknowledged).toBe(true);
  });
});
