import { SessionsNamespaceService } from '../../../services/websocket/sessions-namespace.service';

jest.mock('prom-client', () => {
  const counters = new Map<string, any>();
  class Counter { name: string; inc = jest.fn(); constructor(cfg: any){ this.name = cfg?.name; counters.set(this.name, this);} }
  const register = { getSingleMetric: (name: string) => counters.get(name) || new Counter({ name }) };
  return { Counter, register, Histogram: class { constructor(_: any){} observe(){ } } };
});

jest.mock('../../../services/databricks.service');
jest.mock('../../../services/redis.service', () => ({
  redisService: {
    get: jest.fn(async (key: string) => (key.includes('ws:session:ending') ? '1' : null)),
    getClient: () => ({})
  }
}));
jest.mock('../../../services/audio/InMemoryAudioProcessor', () => ({
  inMemoryAudioProcessor: {
    getGroupWindowInfo: jest.fn().mockReturnValue({ bytes: 0, chunks: 0, windowSeconds: 10 }),
    ingestGroupAudioChunk: jest.fn(async () => ({ text: 'hello', confidence: 0.9, timestamp: new Date().toISOString() })),
  },
}));
jest.mock('../../../services/ai-analysis-buffer.service', () => ({
  aiAnalysisBufferService: { bufferTranscription: jest.fn() }
}));
jest.mock('../../../services/ai-analysis-trigger.service', () => ({
  aiAnalysisTriggerService: { checkAndTriggerAIAnalysis: jest.fn() }
}));

describe('SessionsNamespaceService — AI suppression while ending', () => {
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

  it('does not buffer/trigger AI when session is ending', async () => {
    const socket: any = { data: { userId: 'u1', sessionId: 'sess1', schoolId: 'school1' }, emit: jest.fn() };
    const { aiAnalysisBufferService } = require('../../../services/ai-analysis-buffer.service');
    const { aiAnalysisTriggerService } = require('../../../services/ai-analysis-trigger.service');

    await (service as any).handleAudioChunk(socket, {
      groupId: 'g1',
      audioData: Buffer.from([1, 2, 3]),
      mimeType: 'audio/webm',
    });

    expect(aiAnalysisBufferService.bufferTranscription).not.toHaveBeenCalled();
    expect(aiAnalysisTriggerService.checkAndTriggerAIAnalysis).not.toHaveBeenCalled();

    // Counter for suppression increments
    const client: any = require('prom-client');
    const suppressed = client.register.getSingleMetric('ai_triggers_suppressed_total');
    expect(suppressed.inc).toHaveBeenCalled();
  });
});
