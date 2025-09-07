import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';

jest.mock('../../../services/databricks.service', () => ({
  databricksService: {
    query: jest.fn(),
    insert: jest.fn(),
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

describe('SessionsNamespaceService.handleAudioChunk — group audio authorization', () => {
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
  });

  it('emits audio:error NOT_AUTHORIZED for non-members', async () => {
    const { databricksService } = require('../../../services/databricks.service');
    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');

    // DB returns group rows without the userId in members
    (databricksService.query as jest.Mock).mockResolvedValue([
      { leader_id: 'leader-1', student_id: 'stu-2' },
      { leader_id: 'leader-1', student_id: 'stu-3' },
    ]);

    // Ensure session is active for gating
    ;(service as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };

    const socket: any = { data: { userId: 'stu-1', role: 'student', sessionId: 'sess-A', schoolId: 'school1' }, emit: jest.fn(), id: 'sock1' };
    await (service as any).handleAudioChunk(socket, {
      groupId: 'g-1',
      audioData: Buffer.from([1, 2, 3]),
      mimeType: 'audio/webm;codecs=opus',
    });

    // Should emit NOT_AUTHORIZED error and not call ingest
    expect(nsToEmit).toHaveBeenCalledWith('audio:error', expect.objectContaining({ groupId: 'g-1', error: 'NOT_AUTHORIZED' }));
    expect(inMemoryAudioProcessor.ingestGroupAudioChunk).not.toHaveBeenCalled();
  });

  it('allows group members to stream (ingest called)', async () => {
    const { databricksService } = require('../../../services/databricks.service');
    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');

    // DB returns a row containing the userId as a member
    (databricksService.query as jest.Mock).mockResolvedValue([
      { leader_id: 'leader-1', student_id: 'stu-1' },
    ]);

    ;(service as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };

    const socket: any = { data: { userId: 'stu-1', role: 'student', sessionId: 'sess-B', schoolId: 'school1' }, emit: jest.fn(), id: 'sock2' };
    await (service as any).handleAudioChunk(socket, {
      groupId: 'g-2',
      audioData: Buffer.from([1, 2, 3]),
      mimeType: 'audio/webm;codecs=opus',
    });

    expect(inMemoryAudioProcessor.ingestGroupAudioChunk).toHaveBeenCalled();
  });
});

