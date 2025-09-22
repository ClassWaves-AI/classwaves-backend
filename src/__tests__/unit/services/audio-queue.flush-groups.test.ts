import { inMemoryAudioProcessor } from '../../../services/audio/InMemoryAudioProcessor';

// Mock the audio task queue to capture enqueue calls
jest.mock('../../../services/queue/audio-task-queue.port', () => {
  const enqueue = jest.fn().mockResolvedValue(undefined);
  return {
    getAudioTaskQueue: async () => ({ enqueue, size: () => 0, shutdown: async () => {} }),
    __mocks: { enqueue },
  };
});

// Mock STT transcribe to avoid real work
const mockProvider = {
  transcribeBuffer: jest.fn().mockResolvedValue({ text: 'ok', confidence: 0.99, language: 'en', duration: 1 })
};

jest.mock('../../../services/stt.provider', () => ({
  getSttProvider: jest.fn(() => mockProvider),
}));

describe('InMemoryAudioProcessor — flushGroups uses worker queue when enabled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AUDIO_QUEUE_ENABLED = '1';
  });

  afterEach(() => {
    delete process.env.AUDIO_QUEUE_ENABLED;
  });

  it('enqueues flush tasks when AUDIO_QUEUE_ENABLED=1', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const mod = await import('../../../services/queue/audio-task-queue.port');
    const enqueue = (mod as any).__mocks.enqueue as jest.Mock;

    // Seed a group window with data
    const anyProc: any = inMemoryAudioProcessor as any;
    anyProc.groupWindows.set('g1', {
      chunks: [Buffer.from('1')],
      bytes: 1,
      mimeType: 'audio/webm',
      windowStartedAt: Date.now() - 20000,
      windowSeconds: 1,
      consecutiveFailureCount: 0,
    });

    await inMemoryAudioProcessor.flushGroups(['g1']);

    expect(enqueue).toHaveBeenCalled();
    process.env.NODE_ENV = prevEnv;
  });
});
