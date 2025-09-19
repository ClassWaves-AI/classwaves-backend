import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';

jest.mock('../../../services/databricks.service');
jest.mock('../../../services/redis.service', () => ({
  redisService: {
    get: jest.fn(async (key: string) => null),
    getClient: () => ({})
  }
}));
jest.mock('../../../services/audio/InMemoryAudioProcessor', () => ({
  inMemoryAudioProcessor: {
    getGroupWindowInfo: jest.fn().mockReturnValue({ bytes: 6 * 1024 * 1024, chunks: 51, windowSeconds: 10 }),
    ingestGroupAudioChunk: jest.fn(),
  },
}));

describe('SessionsNamespaceService — soft backpressure hint', () => {
  const nsToEmit = jest.fn();
  const fakeNamespace: any = {
    use: jest.fn(),
    on: jest.fn(),
    to: jest.fn(() => ({ emit: nsToEmit })),
    adapter: { rooms: new Map() },
    sockets: new Map(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WS_BACKPRESSURE_HINT_THRESHOLD = '3';
    process.env.WS_BACKPRESSURE_HINT_COOLDOWN_MS = '1000';
  });

  it('emits BACKPRESSURE_HINT after threshold consecutive drops', async () => {
    const service = new SessionsNamespaceService(fakeNamespace as any);
    (service as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };
    const socket: any = { data: { userId: 'u1', sessionId: 'sess1', schoolId: 'school1' }, emit: jest.fn() };
    // Simulate consecutive drops directly against the hint logic
    (service as any).recordDropAndMaybeHint(socket, 'g1');
    (service as any).recordDropAndMaybeHint(socket, 'g1');
    (service as any).recordDropAndMaybeHint(socket, 'g1');
    const hint = (nsToEmit as jest.Mock).mock.calls.find((c) => c[0] === 'audio:error' && c[1]?.error === 'BACKPRESSURE_HINT');
    expect(hint).toBeTruthy();
  });
});
