import { GuidanceNamespaceService } from '../../services/websocket/guidance-namespace.service';

// Mock prom-client locally for this test file
jest.mock('prom-client', () => {
  const counters = new Map<string, any>();
  const histos = new Map<string, any>();
  class Counter {
    name: string; help?: string; labelNames?: string[]; inc = jest.fn();
    constructor(cfg: any) { this.name = cfg?.name || 'counter'; this.help = cfg?.help; this.labelNames = cfg?.labelNames; counters.set(this.name, this); }
  }
  class Histogram {
    name: string; help?: string; labelNames?: string[]; observe = jest.fn();
    constructor(cfg: any) { this.name = cfg?.name || 'hist'; this.help = cfg?.help; this.labelNames = cfg?.labelNames; histos.set(this.name, this); }
  }
  const register = {
    getSingleMetric: (name: string) => {
      if (counters.has(name)) return counters.get(name);
      if (histos.has(name)) return histos.get(name);
      // Default to counter creation for unknown
      const c = new Counter({ name });
      counters.set(name, c);
      return c;
    }
  };
  return { Counter, Histogram, register };
});

const createMockNamespace = () => ({
  use: jest.fn(),
  on: jest.fn(),
  to: jest.fn().mockReturnValue({ emit: jest.fn() }),
  emit: jest.fn(),
  adapter: { rooms: new Map<string, Set<string>>() },
  sockets: new Map<string, any>(),
});

jest.mock('../../services/databricks.service', () => ({
  databricksService: { queryOne: jest.fn(async () => ({ school_id: 'schoolX' })) }
}));

describe('GuidanceNamespaceService — prompt delivery SLIs', () => {
  it('records delivery total and latency when generatedAt provided', async () => {
    const ns: any = createMockNamespace();
    const svc = new GuidanceNamespaceService(ns);
    const sessionId = 'sess-1';

    const start = Date.now() - 123;
    svc.emitTeacherRecommendations(sessionId, [{ id: 'p1' }], { generatedAt: start, tier: 'tier1' });
    await new Promise(res => setImmediate(res));

    const client: any = require('prom-client');
    const total = client.register.getSingleMetric('guidance_prompt_delivery_total');
    expect(total.inc).toHaveBeenCalled();
    const latency = client.register.getSingleMetric('guidance_prompt_delivery_latency_ms');
    expect(latency.observe).toHaveBeenCalled();
  });

  it('marks no_subscriber when no rooms have subscribers', async () => {
    const ns: any = createMockNamespace();
    const svc = new GuidanceNamespaceService(ns);
    const sessionId = 'sess-2';
    svc.emitTeacherRecommendations(sessionId, [{ id: 'p2' }], { generatedAt: Date.now() - 10, tier: 'tier2' });
    await new Promise(res => setImmediate(res));

    const client: any = require('prom-client');
    const calls = (client.register.getSingleMetric('guidance_prompt_delivery_total').inc as jest.Mock).mock.calls;
    const labels = calls[calls.length - 1]?.[0];
    expect(labels).toMatchObject({ tier: 'tier2', status: 'no_subscriber', school: 'schoolX' });
  });

  it('marks delivered when any guidance room has subscribers', async () => {
    const ns: any = createMockNamespace();
    // Add a subscriber in the session-specific room
    ns.adapter.rooms.set('guidance:session:sess-3', new Set(['sock1']));
    const svc = new GuidanceNamespaceService(ns);
    svc.emitTeacherRecommendations('sess-3', [{ id: 'p3' }], { generatedAt: Date.now() - 10, tier: 'tier1' });
    await new Promise(res => setImmediate(res));

    const client: any = require('prom-client');
    const calls = (client.register.getSingleMetric('guidance_prompt_delivery_total').inc as jest.Mock).mock.calls;
    const labels = calls[calls.length - 1]?.[0];
    expect(labels).toMatchObject({ tier: 'tier1', status: 'delivered' });
  });
});
