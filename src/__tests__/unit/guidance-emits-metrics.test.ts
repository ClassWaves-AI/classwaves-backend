/**
 * Guidance emits metrics — verifies emitsFailed increments when no subscribers are present
 */

import { GuidanceNamespaceService } from '../../services/websocket/guidance-namespace.service';

// Mock prom-client locally for this test file
jest.mock('prom-client', () => {
  const counters = new Map<string, any>();
  class Counter {
    name: string;
    help?: string;
    labelNames?: string[];
    inc = jest.fn();
    constructor(cfg: any) {
      this.name = cfg?.name || 'counter';
      this.help = cfg?.help;
      this.labelNames = cfg?.labelNames;
      counters.set(this.name, this);
    }
  }
  const register = {
    getSingleMetric: (name: string) => {
      if (!counters.has(name)) counters.set(name, new Counter({ name }));
      return counters.get(name);
    }
  };
  return { Counter, register };
});

// Minimal mock namespace
const createMockNamespace = () => ({
  use: jest.fn(),
  on: jest.fn(),
  to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  emit: jest.fn(),
  adapter: { rooms: new Map<string, Set<string>>() },
  sockets: new Map<string, any>(),
});

describe('GuidanceNamespaceService emitsFailed metrics', () => {
  it('increments guidance_emits_failed_total when session room has no subscribers (tier1)', () => {
    const ns: any = createMockNamespace();
    const svc = new GuidanceNamespaceService(ns);

    // No rooms or subscribers configured
    const sessionId = 'sess-1';
    const payload = { sessionId, insights: { k: 'v' }, timestamp: new Date().toISOString() };

    // Act
    svc.emitTier1Insight(sessionId, payload);

    // Assert: fetch the mocked counter and ensure it was incremented
    const client: any = require('prom-client');
    const failedCounter = client.register.getSingleMetric('guidance_emits_failed_total');
    expect(failedCounter.inc).toHaveBeenCalled();
    // Optional: assert label type where available
    const call = (failedCounter.inc as jest.Mock).mock.calls[0]?.[0];
    expect(call).toMatchObject({ namespace: '/guidance', type: 'tier1' });
  });

  it('increments guidance_emits_failed_total when session room has no subscribers (tier2)', () => {
    const ns: any = createMockNamespace();
    const svc = new GuidanceNamespaceService(ns);

    const sessionId = 'sess-2';
    const payload = { sessionId, groupId: 'group-1', insights: { a: 1 }, timestamp: new Date().toISOString() };
    svc.emitTier2Insight(sessionId, payload);

    const client: any = require('prom-client');
    const failedCounter = client.register.getSingleMetric('guidance_emits_failed_total');
    const calls = (failedCounter.inc as jest.Mock).mock.calls;
    expect(calls.some(args => args[0]?.type === 'tier2')).toBe(true);
  });

  it('increments guidance_emits_failed_total when no subscribers for teacher:recommendations', () => {
    const ns: any = createMockNamespace();
    const svc = new GuidanceNamespaceService(ns);
    const sessionId = 'sess-3';
    svc.emitTeacherRecommendations(sessionId, []);

    const client: any = require('prom-client');
    const failedCounter = client.register.getSingleMetric('guidance_emits_failed_total');
    const calls = (failedCounter.inc as jest.Mock).mock.calls;
    expect(calls.some(args => args[0]?.type === 'recommendations')).toBe(true);
  });

  it('increments guidance_emits_failed_total when no subscribers for teacher:alert', () => {
    const ns: any = createMockNamespace();
    const svc = new GuidanceNamespaceService(ns);
    const sessionId = 'sess-4';
    svc.emitTeacherAlert(sessionId, { id: 'p1' });

    const client: any = require('prom-client');
    const failedCounter = client.register.getSingleMetric('guidance_emits_failed_total');
    const calls = (failedCounter.inc as jest.Mock).mock.calls;
    expect(calls.some(args => args[0]?.type === 'alert')).toBe(true);
  });
});
