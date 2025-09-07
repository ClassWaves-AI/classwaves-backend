jest.mock('../../../services/databricks.service');
jest.mock('../../../services/redis.service', () => ({
  redisService: {
    get: jest.fn(async () => null),
    getClient: () => ({})
  }
}));
jest.mock('../../../services/websocket/websocket-security-validator.service', () => ({
  webSocketSecurityValidator: {
    validateNamespaceAccess: jest.fn(async () => ({ allowed: true })),
    handleDisconnection: jest.fn(async () => undefined)
  }
}));
jest.mock('../../../utils/jwt.utils', () => ({
  verifyToken: jest.fn(() => ({ userId: 'u1', role: 'teacher', schoolId: 'school1' }))
}));
jest.mock('prom-client', () => {
  const counters = new Map<string, any>();
  class Counter { name: string; inc = jest.fn(); constructor(cfg: any){ this.name = cfg?.name; counters.set(this.name, this);} }
  const register = { getSingleMetric: (name: string) => counters.get(name) || new Counter({ name }) };
  return { Counter, register, Histogram: class { constructor(_: any){} startTimer(){ return () => {}; } } };
});

import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';

describe('WebSocket trace id propagation and connection ack', () => {
  it('stores traceId on socket.data and emits ws:connected with traceId', async () => {
    const nsHandlers: Record<string, Function[]> = { connection: [] };
    const fakeNamespace: any = {
      use: jest.fn(),
      on: jest.fn((evt: string, cb: any) => { (nsHandlers[evt] ||= []).push(cb); }),
      to: jest.fn(() => ({ emit: jest.fn() })),
      adapter: { rooms: new Map() },
      sockets: new Map(),
    };

    // Instantiate service (registers middleware and handlers)
    // eslint-disable-next-line no-new
    new SessionsNamespaceService(fakeNamespace as any);

    // Extract middleware added via namespace.use
    const wsMiddleware = (fakeNamespace.use as jest.Mock).mock.calls[0][0];

    const socket: any = {
      handshake: {
        auth: { token: 't', traceId: 'trace-abc' },
        headers: { }
      },
      data: {},
      id: 'sock1',
      emit: jest.fn(),
      on: jest.fn(),
    };

    // Run auth middleware then trigger connection
    await new Promise<void>((resolve) => wsMiddleware(socket, () => resolve()));
    expect(socket.data.traceId).toBe('trace-abc');

    // Trigger connection handler
    const onConn = nsHandlers['connection'][0];
    onConn(socket);

    // Expect an ack event with traceId
    expect(socket.emit).toHaveBeenCalledWith('ws:connected', expect.objectContaining({ traceId: 'trace-abc' }));
  });
});
