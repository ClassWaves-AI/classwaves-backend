import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { getSttProvider, setSttProviderOverride, clearSttProviderOverride } from '../../services/stt.provider';
import type { SpeechToTextPort } from '../../services/stt.port';

describe('Speechmatics provider resolver integration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    clearSttProviderOverride();
  });

  it('returns Speechmatics adapter when STT_PROVIDER is speechmatics', () => {
    process.env.STT_PROVIDER = 'speechmatics';
    const provider = getSttProvider();
    expect(provider.constructor.name.toLowerCase()).toContain('speechmatics');
  });

  it('falls back to override when provided', () => {
    process.env.STT_PROVIDER = 'speechmatics';
    const fake: SpeechToTextPort = {
      transcribeBuffer: jest.fn(async () => ({ text: 'override', duration: 0 })) as SpeechToTextPort['transcribeBuffer'],
    };
    setSttProviderOverride(fake);
    expect(getSttProvider()).toBe(fake);
  });
});
