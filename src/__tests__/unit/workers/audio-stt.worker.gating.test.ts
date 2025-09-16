// Note: require worker after mocks to ensure mocked modules are used

// Mock prom-client to avoid registry issues
jest.mock('prom-client', () => {
  const counters = new Map<string, any>();
  class Counter { name: string; help?: string; labelNames?: string[]; inc = jest.fn(); constructor(cfg: any){ this.name = cfg?.name; this.help = cfg?.help; counters.set(this.name, this);} }
  class Histogram { name: string; help?: string; labelNames?: string[]; observe = jest.fn(); constructor(cfg: any){ this.name = cfg?.name; this.help = cfg?.help; this.labelNames = cfg?.labelNames; } }
  const register = { getSingleMetric: (name: string) => counters.get(name) };
  return { Counter, Histogram, register };
});

// Stub whisper service to avoid real STT
jest.mock('../../../services/openai-whisper.service', () => ({
  openAIWhisperService: {
    transcribeBuffer: jest.fn(async () => ({ text: 'hello class waves' }))
  }
}));

// Mock Redis so ending/status flags can be controlled
const redisGet: any = jest.fn(async (_key: string) => null);
jest.mock('../../../services/redis.service', () => ({
  redisService: {
    getClient: () => ({ get: redisGet }),
  }
}));

// Spy on AI buffer + trigger services
const bufferTranscription = jest.fn();
const checkAndTriggerAIAnalysis = jest.fn();
jest.mock('../../../services/ai-analysis-buffer.service', () => ({
  aiAnalysisBufferService: { bufferTranscription }
}));
jest.mock('../../../services/ai-analysis-trigger.service', () => ({
  aiAnalysisTriggerService: { checkAndTriggerAIAnalysis }
}));
// Ensure teacher id is available so trigger path runs
jest.mock('../../../services/utils/teacher-id-cache.service', () => ({
  getTeacherIdForSessionCached: jest.fn(async () => 'teacher-abc')
}));

// Avoid actual WS emission in worker
jest.mock('../../../services/websocket/namespaced-websocket.service', () => ({
  getNamespacedWebSocketService: () => ({
    getSessionsService: () => ({ emitMergedGroupTranscript: jest.fn(), emitToGroup: jest.fn(), emitToSession: jest.fn() })
  })
}));

describe('Audio STT Worker — gating on session end flags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisGet.mockResolvedValue(null);
  });

  it('suppresses AI buffer/trigger when ws:session:ending is set', async () => {
    (redisGet as jest.Mock).mockImplementation(async (key: string) => (key.includes('ws:session:ending') ? '1' : null));
    let processAudioJob: any;
    jest.isolateModules(() => {
      processAudioJob = require('../../../workers/audio-stt.worker').processAudioJob;
    });
    await processAudioJob({
      chunkId: 'c1', sessionId: 's1', groupId: 'g1', startTs: Date.now()-1000, endTs: Date.now(),
      mime: 'audio/webm', bytes: 10, audioB64: Buffer.from([1,2,3]).toString('base64'), schoolId: 'school1'
    } as any);

    expect(bufferTranscription).not.toHaveBeenCalled();
    expect(checkAndTriggerAIAnalysis).not.toHaveBeenCalled();
  });

  it('processes AI normally when no end flags are set', async () => {
    (redisGet as jest.Mock).mockResolvedValue(null);
    let processAudioJob: any;
    jest.isolateModules(() => {
      processAudioJob = require('../../../workers/audio-stt.worker').processAudioJob;
    });
    await processAudioJob({
      chunkId: 'c2', sessionId: 's2', groupId: 'g2', startTs: Date.now()-1000, endTs: Date.now(),
      mime: 'audio/webm', bytes: 10, audioB64: Buffer.from([1,2,3]).toString('base64'), schoolId: 'school1'
    } as any);
    expect(bufferTranscription).toHaveBeenCalled();
    expect(checkAndTriggerAIAnalysis).toHaveBeenCalled();
  });
});
