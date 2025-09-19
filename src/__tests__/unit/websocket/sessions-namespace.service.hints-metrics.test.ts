import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';

jest.mock('../../../services/databricks.service');
jest.mock('prom-client', () => {
  const counters = new Map<string, any>();
  class Counter { name: string; inc = jest.fn(); constructor(cfg: any){ this.name = cfg?.name; counters.set(this.name, this);} }
  const register = { getSingleMetric: (name: string) => counters.get(name) || new Counter({ name }) };
  return { Counter, register, Histogram: class { constructor(_: any){} startTimer(){ return () => {}; } observe(){ } } };
});
jest.mock('../../../services/redis.service', () => ({
  redisService: {
    get: jest.fn(async () => null),
    getClient: () => ({})
  }
}));
jest.mock('../../../services/audio/InMemoryAudioProcessor', () => ({
  inMemoryAudioProcessor: {
    // Force window overflow so chunks are dropped
    getGroupWindowInfo: jest.fn().mockReturnValue({ bytes: 6 * 1024 * 1024, chunks: 51, windowSeconds: 10 }),
    ingestGroupAudioChunk: jest.fn(),
  },
}));

describe('SessionsNamespaceService — backpressure hint metrics', () => {
  const nsToEmit = jest.fn();
  const fakeNamespace: any = {
    use: jest.fn(), on: jest.fn(), to: jest.fn(() => ({ emit: nsToEmit })), adapter: { rooms: new Map() }, sockets: new Map(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WS_BACKPRESSURE_HINT_THRESHOLD = '2';
    process.env.WS_BACKPRESSURE_HINT_COOLDOWN_MS = '60000'; // long cooldown
  });

  it('increments ws_backpressure_hints_total once per cooldown window', async () => {
    const service = new SessionsNamespaceService(fakeNamespace as any);
    (service as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };

    const socket: any = { data: { userId: 'u1', sessionId: 'sess1', schoolId: 'school1' }, emit: jest.fn() };
    // Two drops to hit threshold (threshold=2 via env)
    (service as any).recordDropAndMaybeHint(socket, 'g1');
    (service as any).recordDropAndMaybeHint(socket, 'g1');

    const client: any = require('prom-client');
    const hints = client.register.getSingleMetric('ws_backpressure_hints_total');
    expect(hints.inc).toHaveBeenCalledTimes(1);

    // Additional drops within cooldown should not increment again
    (service as any).recordDropAndMaybeHint(socket, 'g1');
    (service as any).recordDropAndMaybeHint(socket, 'g1');
    expect(hints.inc).toHaveBeenCalledTimes(1);
  });
});
