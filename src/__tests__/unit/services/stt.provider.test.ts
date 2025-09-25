import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { getSttProvider, setSttProviderOverride, clearSttProviderOverride } from '../../../services/stt.provider';
import { openAIWhisperService } from '../../../services/openai-whisper.service';
import { speechmaticsSttAdapter } from '../../../adapters/stt.speechmatics';

describe('stt.provider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    clearSttProviderOverride();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    clearSttProviderOverride();
  });

  it('returns OpenAI provider by default', () => {
    delete process.env.STT_PROVIDER;
    const provider = getSttProvider();
    expect(provider).toBe(openAIWhisperService);
  });

  it('returns Speechmatics adapter when STT_PROVIDER=speechmatics', () => {
    process.env.STT_PROVIDER = 'speechmatics';
    const provider = getSttProvider();
    expect(provider).toBe(speechmaticsSttAdapter);
  });

  it('returns disabled provider when STT_PROVIDER=off', async () => {
    process.env.STT_PROVIDER = 'off';
    const provider = getSttProvider();
    const result = await provider.transcribeBuffer(Buffer.alloc(0), 'audio/webm', { durationSeconds: 5 });
    expect(result.text).toBe('');
    expect(result.duration).toBe(5);
  });

  it('honors override when set', () => {
    const customProvider = { transcribeBuffer: jest.fn() } as any;
    setSttProviderOverride(customProvider);
    const provider = getSttProvider();
    expect(provider).toBe(customProvider);
    clearSttProviderOverride();
    delete process.env.STT_PROVIDER;
    expect(getSttProvider()).toBe(openAIWhisperService);
  });
});
