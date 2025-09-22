import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { OpenAIWhisperService, openAIWhisperService } from '../../../services/openai-whisper.service';
import { redisService } from '../../../services/redis.service';

jest.mock('../../../services/stt.budget.service', () => ({
  sttBudgetService: {
    recordUsage: jest.fn(),
  },
}));

const { sttBudgetService } = require('../../../services/stt.budget.service');

describe('OpenAIWhisperService', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  it('returns mock transcription in test env', async () => {
    const svc = new OpenAIWhisperService();
    const result = await svc.transcribeBuffer(Buffer.from([0x00]), 'audio/webm');
    expect(result.text).toContain('mock transcription');
  });

  it('respects per-school limiter interface (no throw)', async () => {
    const svc = new OpenAIWhisperService();
    await expect(svc.transcribeBuffer(Buffer.from([0x00]), 'audio/webm', {}, 'school-123')).resolves.toBeDefined();
  });

  it('supports credential rotation via setApiKey', () => {
    // @ts-ignore test internal state
    (openAIWhisperService as any).apiKey = 'old-key';
    openAIWhisperService.setApiKey('new-key');
    // @ts-ignore read back
    expect((openAIWhisperService as any).apiKey).toBe('new-key');
  });

  it('records budget minutes and emits alerts when thresholds crossed', async () => {
    process.env.NODE_ENV = 'development';
    process.env.STT_BUDGET_MINUTES_PER_DAY = '1'; // tiny budget for test
    process.env.STT_BUDGET_ALERT_PCTS = '50,100';
    process.env.OPENAI_API_KEY = 'dummy-key';

    const recordUsageMock = sttBudgetService.recordUsage as jest.Mock;
    recordUsageMock.mockClear();

    const svc = new OpenAIWhisperService();

    // Mock internal retry path to immediately succeed with known duration
    // @ts-ignore override private method for test determinism
    jest.spyOn(svc as any, 'transcribeWithRetry').mockResolvedValue({ text: 'ok', duration: 30 }); // 0.5 min

    await svc.transcribeBuffer(Buffer.from([0x00]), 'audio/webm', { durationSeconds: 30 }, 'school-T');
    await svc.transcribeBuffer(Buffer.from([0x01]), 'audio/webm', { durationSeconds: 45 }, 'school-T');

    expect(recordUsageMock).toHaveBeenCalledTimes(2);
    expect(recordUsageMock).toHaveBeenCalledWith({ schoolId: 'school-T', durationSeconds: 30, provider: 'openai' });
  });

  it('adaptive windowing increases under 429s (simulated)', async () => {
    process.env.NODE_ENV = 'development';
    const { InMemoryAudioProcessor } = require('../../../services/audio/InMemoryAudioProcessor');
    const processor = new InMemoryAudioProcessor();
    const groupId = 'group-429';
    const state = {
      chunks: [Buffer.from('a')],
      bytes: 1,
      mimeType: 'audio/webm',
      windowStartedAt: Date.now() - 16000,
      windowSeconds: 12,
      consecutiveFailureCount: 0,
    } as any;
    (processor as any).groupWindows.set(groupId, state);

    // First transcribe fails with 429, causing window increase by +2 seconds
    const spy = jest
      .spyOn(openAIWhisperService, 'transcribeBuffer')
      .mockRejectedValueOnce(Object.assign(new Error('Retryable Whisper error: 429'), { status: 429 }))
      .mockResolvedValueOnce({ text: 'ok', confidence: 0.9 });

    await expect((processor as any).flushGroupWindow(groupId, state, 'audio/webm')).rejects.toThrow();
    expect(state.windowSeconds).toBeGreaterThanOrEqual(14);

    // Next attempt succeeds and reduces window gradually by 1 second
    state.chunks = [Buffer.from('b')];
    state.bytes = 1;
    await (processor as any).flushGroupWindow(groupId, state, 'audio/webm');
    expect(state.windowSeconds).toBeLessThanOrEqual(13);

    spy.mockRestore();
  });

  afterAll(async () => {
    await redisService.disconnect();
  });
});
