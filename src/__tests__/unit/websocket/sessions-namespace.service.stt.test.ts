import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';
import { databricksService } from '../../../services/databricks.service';

jest.mock('../../../services/databricks.service');
jest.mock('../../../services/ai-analysis-buffer.service', () => {
  return {
    aiAnalysisBufferService: {
      bufferTranscription: jest.fn(),
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

describe('SessionsNamespaceService.handleAudioChunk (unified STT)', () => {
  const nsToEmit = jest.fn();
  const fakeNamespace: any = {
    use: jest.fn((fn) => {}),
    on: jest.fn(),
    to: jest.fn(() => ({ emit: nsToEmit })),
    adapter: { rooms: new Map() },
    sockets: new Map(),
  };

  const service = new SessionsNamespaceService(fakeNamespace as any);
  const mockInsert = databricksService.insert as jest.Mock;

  beforeEach(() => {
    process.env.WS_UNIFIED_STT = '1';
    jest.clearAllMocks();
  });

  it('ingests chunk and emits transcription + inserts DB on window boundary', async () => {
    // Authorize user as group member
    (databricksService.query as jest.Mock).mockResolvedValue([
      { leader_id: 'leader-1', student_id: 'u1' },
    ]);
    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');
    inMemoryAudioProcessor.ingestGroupAudioChunk.mockResolvedValue({
      groupId: 'g1',
      sessionId: 'sess1',
      text: 'hello',
      confidence: 0.9,
      timestamp: new Date().toISOString(),
      language: 'en',
      duration: 2.2,
    });

    const socket: any = {
      data: { userId: 'u1', sessionId: 'sess1', schoolId: 'school1' },
      emit: jest.fn(),
    };

    // Ensure session is active for gating
    (service as any).snapshotCache = {
      get: jest.fn().mockResolvedValue({ status: 'active' })
    };

    const payload = {
      groupId: 'g1',
      audioData: Buffer.from([1, 2, 3]),
      mimeType: 'audio/webm;codecs=opus',
    } as any;

    // call private via any
    await (service as any).handleAudioChunk(socket, payload);

    // Assert DB insert called once
    expect(mockInsert).toHaveBeenCalledTimes(1);
    // Assert emit to session room with transcription
    expect(nsToEmit).toHaveBeenCalledWith(
      'transcription:group:new',
      expect.objectContaining({ groupId: 'g1', text: 'hello' })
    );
  });

  it('rejects oversized chunk (>2MB) with audio:error emission', async () => {
    // Authorize user as group member
    (databricksService.query as jest.Mock).mockResolvedValue([
      { leader_id: 'leader-1', student_id: 'u1' },
    ]);
    const socket: any = {
      data: { userId: 'u1', sessionId: 'sess1', schoolId: 'school1' },
      emit: jest.fn(),
    };
    const huge = Buffer.alloc(2 * 1024 * 1024 + 1);

    await (service as any).handleAudioChunk(socket, {
      groupId: 'g-big',
      audioData: huge,
      mimeType: 'audio/webm;codecs=opus',
    });

    // Emitted to group room with audio:error
    expect(nsToEmit).toHaveBeenCalledWith(
      'audio:error',
      expect.objectContaining({ groupId: 'g-big' })
    );
  });

  it('suppresses emission/persistence/AI when transcript text is empty', async () => {
    // Authorize user as group member
    (databricksService.query as jest.Mock).mockResolvedValue([
      { leader_id: 'leader-1', student_id: 'u2' },
    ]);
    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');
    const { aiAnalysisBufferService } = require('../../../services/ai-analysis-buffer.service');

    inMemoryAudioProcessor.ingestGroupAudioChunk.mockResolvedValue({
      groupId: 'g2',
      sessionId: 'sess2',
      text: '   ', // empty after trim
      confidence: 0,
      timestamp: new Date().toISOString(),
      language: 'en',
      duration: 0,
    });

    const socket: any = {
      data: { userId: 'u2', sessionId: 'sess2', schoolId: 'school2' },
      emit: jest.fn(),
    };

    // Ensure session is active for gating
    ;(service as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };

    await (service as any).handleAudioChunk(socket, {
      groupId: 'g2',
      audioData: Buffer.from([1, 2, 3]),
      mimeType: 'audio/webm;codecs=opus',
    });

    // No DB insert, no transcription emit, no AI buffer
    expect(mockInsert).not.toHaveBeenCalled();
    const emits = (nsToEmit as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(emits.filter((e: string) => e === 'transcription:group:new').length).toBe(0);
    expect(aiAnalysisBufferService.bufferTranscription).not.toHaveBeenCalled();
  });

  it('no transcripts or insights when circuit breaker/STT off yields empty text', async () => {
    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');
    inMemoryAudioProcessor.ingestGroupAudioChunk.mockResolvedValue({
      groupId: 'g3',
      sessionId: 'sess3',
      text: '',
      confidence: 0,
      timestamp: new Date().toISOString(),
    });

    const socket: any = {
      data: { userId: 'u3', sessionId: 'sess3', schoolId: 'school3' },
      emit: jest.fn(),
    };

    (service as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };

    await (service as any).handleAudioChunk(socket, {
      groupId: 'g3',
      audioData: Buffer.from([1, 2, 3]),
      mimeType: 'audio/webm;codecs=opus',
    });

    // No transcript emits
    const nsToEmitCalls = (nsToEmit as jest.Mock).mock.calls.map((c: any[]) => c[0]);
    expect(nsToEmitCalls.filter((e: string) => e === 'transcription:group:new').length).toBe(0);
  });

  it('applies backpressure drop when window bytes/chunks exceeded', async () => {
    // Authorize user as group member
    (databricksService.query as jest.Mock).mockResolvedValue([
      { leader_id: 'leader-1', student_id: 'u1' },
    ]);
    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');
    // Force high window info
    inMemoryAudioProcessor.getGroupWindowInfo.mockReturnValue({ bytes: 6 * 1024 * 1024, chunks: 51, windowSeconds: 10 });

    const socket: any = { data: { userId: 'u1', sessionId: 'sess1', schoolId: 'school1' }, emit: jest.fn() };

    await (service as any).handleAudioChunk(socket, {
      groupId: 'g-press',
      audioData: Buffer.from([1]),
      mimeType: 'audio/webm',
    });

    expect(nsToEmit).toHaveBeenCalledWith(
      'audio:error',
      expect.objectContaining({ groupId: 'g-press' })
    );
  });

  it('rejects audio when session status is not active', async () => {
    const socket: any = { data: { userId: 'u1', sessionId: 'sess-paused', schoolId: 'school1' }, emit: jest.fn() };
    // Override snapshotCache to simulate paused session
    (service as any).snapshotCache = {
      get: jest.fn().mockResolvedValue({ status: 'paused' })
    };

    await (service as any).handleAudioChunk(socket, {
      groupId: 'g-paused',
      audioData: Buffer.from([1]),
      mimeType: 'audio/webm;codecs=opus',
    });

    // Should emit a standardized session gating error and not proceed
    expect(nsToEmit).toHaveBeenCalledWith(
      'audio:error',
      expect.objectContaining({ groupId: 'g-paused', error: 'SESSION_PAUSED' })
    );
  });
});
