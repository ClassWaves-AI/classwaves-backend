import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';

jest.mock('../../../services/databricks.service');
jest.mock('../../../services/redis.service', () => {
  return {
    redisService: {
      get: jest.fn(async (key: string) => (key.includes('ws:session:ending') ? '1' : null)),
      getClient: () => ({})
    }
  };
});
jest.mock('../../../services/audio/InMemoryAudioProcessor', () => ({
  inMemoryAudioProcessor: {
    getGroupWindowInfo: jest.fn().mockReturnValue({ bytes: 0, chunks: 0, windowSeconds: 10 }),
    ingestGroupAudioChunk: jest.fn(),
  },
}));

describe('SessionsNamespaceService.handleAudioChunk — session ending gate', () => {
  const nsToEmit = jest.fn();
  const fakeNamespace: any = {
    use: jest.fn(),
    on: jest.fn(),
    to: jest.fn(() => ({ emit: nsToEmit })),
    adapter: { rooms: new Map() },
    sockets: new Map(),
  };
  const service = new SessionsNamespaceService(fakeNamespace as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (service as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };
  });

  it('emits audio:error SESSION_ENDING when session is marked ending', async () => {
    const socket: any = { data: { userId: 'u1', sessionId: 'sess-end', schoolId: 'school1' }, emit: jest.fn() };

    await (service as any).handleAudioChunk(socket, {
      groupId: 'g-end',
      audioData: Buffer.from([1, 2, 3]),
      mimeType: 'audio/webm',
    });

    const errorEmits = (nsToEmit as jest.Mock).mock.calls.filter((c) => c[0] === 'audio:error');
    expect(errorEmits.length).toBeGreaterThan(0);
    expect(errorEmits[0][1]).toEqual(expect.objectContaining({ error: 'SESSION_ENDING' }));
  });
});
