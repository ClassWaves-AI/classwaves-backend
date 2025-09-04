import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';

jest.mock('../../../services/redis.service', () => {
  const counters = new Map<string, number>();
  const client = {
    incrby: jest.fn(async (key: string, by: number) => {
      const next = (counters.get(key) || 0) + by;
      counters.set(key, next);
      return next;
    }),
    expire: jest.fn(async (_key: string, _sec: number) => {}),
  };
  return {
    redisService: {
      getClient: () => client,
    },
  };
});

jest.mock('../../../services/audio/InMemoryAudioProcessor', () => {
  return {
    inMemoryAudioProcessor: {
      getGroupWindowInfo: jest.fn().mockReturnValue({ bytes: 0, chunks: 0, windowSeconds: 10 }),
      ingestGroupAudioChunk: jest.fn(),
    },
  };
});

describe('SessionsNamespaceService — multi-level quotas', () => {
  const nsToEmit = jest.fn();
  const fakeNamespace: any = {
    use: jest.fn((fn) => {}),
    on: jest.fn(),
    to: jest.fn(() => ({ emit: nsToEmit })),
    adapter: { rooms: new Map() },
    sockets: new Map(),
  };

  const service = new SessionsNamespaceService(fakeNamespace as any);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WS_UNIFIED_STT = '1';
    // Active session
    ;(service as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };
  });

  it('blocks when session quota exceeded', async () => {
    process.env.WS_SESSION_AUDIO_LIMIT = '10'; // 10 bytes/sec
    process.env.WS_SCHOOL_AUDIO_LIMIT = '1000';

    const socket: any = { data: { userId: 't1', role: 'teacher', sessionId: 's1', schoolId: 'school1' }, emit: jest.fn(), id: 'sock1' };

    await (service as any).handleAudioChunk(socket, {
      groupId: 'g1',
      audioData: Buffer.alloc(20, 1), // 20 bytes
      mimeType: 'audio/webm',
    });

    const events = (nsToEmit as jest.Mock).mock.calls.map((c) => c[0]);
    expect(events).toContain('audio:error');
    const errorPayloads = (nsToEmit as jest.Mock).mock.calls.filter((c) => c[0] === 'audio:error').map((c) => c[1]);
    expect(errorPayloads.some((p: any) => p.error === 'SESSION_QUOTA_EXCEEDED')).toBe(true);

    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');
    expect(inMemoryAudioProcessor.ingestGroupAudioChunk).not.toHaveBeenCalled();
  });

  it('blocks when school quota exceeded', async () => {
    process.env.WS_SESSION_AUDIO_LIMIT = '1000';
    process.env.WS_SCHOOL_AUDIO_LIMIT = '10'; // 10 bytes/sec

    const socket: any = { data: { userId: 't2', role: 'teacher', sessionId: 's2', schoolId: 'schoolX' }, emit: jest.fn(), id: 'sock2' };

    await (service as any).handleAudioChunk(socket, {
      groupId: 'g2',
      audioData: Buffer.alloc(20, 2),
      mimeType: 'audio/webm',
    });

    const events = (nsToEmit as jest.Mock).mock.calls.map((c) => c[0]);
    expect(events).toContain('audio:error');
    const errorPayloads = (nsToEmit as jest.Mock).mock.calls.filter((c) => c[0] === 'audio:error').map((c) => c[1]);
    expect(errorPayloads.some((p: any) => p.error === 'SCHOOL_QUOTA_EXCEEDED')).toBe(true);

    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');
    expect(inMemoryAudioProcessor.ingestGroupAudioChunk).not.toHaveBeenCalled();
  });

  it('allows when under quotas', async () => {
    process.env.WS_SESSION_AUDIO_LIMIT = '1000';
    process.env.WS_SCHOOL_AUDIO_LIMIT = '1000';

    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');
    inMemoryAudioProcessor.ingestGroupAudioChunk.mockResolvedValueOnce(null); // no window boundary yet

    const socket: any = { data: { userId: 't3', role: 'teacher', sessionId: 's3', schoolId: 'school3' }, emit: jest.fn(), id: 'sock3' };

    await (service as any).handleAudioChunk(socket, {
      groupId: 'g3',
      audioData: Buffer.alloc(5, 3),
      mimeType: 'audio/webm',
    });

    expect(inMemoryAudioProcessor.ingestGroupAudioChunk).toHaveBeenCalled();
  });
});

