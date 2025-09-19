import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';

jest.mock('../../../services/databricks.service', () => ({
  databricksService: {
    insert: jest.fn(),
    queryOne: jest.fn(),
  },
}));

jest.mock('../../../services/audio/InMemoryAudioProcessor', () => {
  return {
    inMemoryAudioProcessor: {
      getGroupWindowInfo: jest.fn().mockReturnValue({ bytes: 0, chunks: 0, windowSeconds: 10 }),
      ingestGroupAudioChunk: jest.fn(),
    },
  };
});

describe('SessionsNamespaceService — idempotent transcript persistence', () => {
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
    ;(service as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };
  });

  it('inserts transcript only once for duplicate payloads', async () => {
    const { databricksService } = require('../../../services/databricks.service');
    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');

    // Same transcript both times (same timestamp and text)
    const ts = new Date().toISOString();
    inMemoryAudioProcessor.ingestGroupAudioChunk.mockResolvedValue({
      groupId: 'g-idem',
      sessionId: 's-idem',
      text: 'Hello world',
      confidence: 0.9,
      timestamp: ts,
      language: 'en',
      duration: 1.0,
    });

    // First call: no existing id; Second call: id exists
    (databricksService.queryOne as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'exists' });

    // Role teacher bypasses group membership DB check
    const socket: any = { data: { userId: 'teacher-1', role: 'teacher', sessionId: 's-idem', schoolId: 'school-i' }, emit: jest.fn(), id: 'sockX' };
    const payload = { groupId: 'g-idem', audioData: Buffer.from([1,2,3]), mimeType: 'audio/webm' } as any;

    await (service as any).handleAudioChunk(socket, payload);
    await (service as any).handleAudioChunk(socket, payload);

    // Insert called only once
    expect(databricksService.insert).toHaveBeenCalledTimes(1);
  });
});

