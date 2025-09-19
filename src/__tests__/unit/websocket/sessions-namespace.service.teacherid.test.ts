import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';

jest.mock('../../../services/audio/InMemoryAudioProcessor', () => ({
  inMemoryAudioProcessor: {
    getGroupWindowInfo: jest.fn().mockReturnValue({ bytes: 0, chunks: 0, windowSeconds: 10 }),
    ingestGroupAudioChunk: jest.fn(),
  },
}));

jest.mock('../../../services/ai-analysis-buffer.service', () => ({
  aiAnalysisBufferService: { bufferTranscription: jest.fn() },
}));

jest.mock('../../../services/ai-analysis-trigger.service', () => ({
  aiAnalysisTriggerService: { checkAndTriggerAIAnalysis: jest.fn() },
}));

jest.mock('../../../services/databricks.service', () => ({
  databricksService: {
    query: jest.fn(),
    queryOne: jest.fn(),
    insert: jest.fn(),
  },
}));

describe('WS AI trigger uses teacherId for session', () => {
  const nsEmit = jest.fn();
  const fakeNs: any = {
    use: jest.fn(), on: jest.fn(),
    to: jest.fn(() => ({ emit: nsEmit })),
    adapter: { rooms: new Map() }, sockets: new Map(),
  };
  const service = new SessionsNamespaceService(fakeNs as any);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WS_UNIFIED_STT = '1';
  });

  it('resolves teacherId via DB and passes to checkAndTriggerAIAnalysis', async () => {
    const { inMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');
    const { databricksService } = require('../../../services/databricks.service');
    const { aiAnalysisTriggerService } = require('../../../services/ai-analysis-trigger.service');

    // Authorize membership
    databricksService.query.mockResolvedValue([{ leader_id: 'leader-x', student_id: 'student-1' }]);
    // Active session
    (service as any).snapshotCache = { get: jest.fn().mockResolvedValue({ status: 'active' }) };
    // Ingest result with text
    inMemoryAudioProcessor.ingestGroupAudioChunk.mockResolvedValue({
      groupId: 'g1', sessionId: 'sess1', text: 'hello world', confidence: 0.9,
      timestamp: new Date().toISOString(), language: 'en', duration: 1.2,
    });
    // Teacher id lookup for session
    databricksService.queryOne.mockResolvedValue({ teacher_id: 'teacher-123' });

    const socket: any = { data: { userId: 'student-1', sessionId: 'sess1', schoolId: 'school-a' }, emit: jest.fn() };
    const payload: any = { groupId: 'g1', audioData: Buffer.from([1,2,3]), mimeType: 'audio/webm;codecs=opus' };

    await (service as any).handleAudioChunk(socket, payload);

    expect(aiAnalysisTriggerService.checkAndTriggerAIAnalysis).toHaveBeenCalledWith('g1', 'sess1', 'teacher-123');
  });
});

