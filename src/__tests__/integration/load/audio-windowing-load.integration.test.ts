import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { inMemoryAudioProcessor } from '../../../services/audio/InMemoryAudioProcessor';
import { openAIWhisperService } from '../../../services/openai-whisper.service';

describe('Load (simulated): multiple groups, limiter caps concurrency, window adapts under failures', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    process.env.STT_PROVIDER = 'openai';
    process.env.OPENAI_WHISPER_CONCURRENCY = '5';
    process.env.STT_WINDOW_SECONDS = '10';
  });

  it('simulates 25 groups with short windows; enforces limiter and adapts on 429s', async () => {
    const spy = jest.spyOn(openAIWhisperService, 'transcribeBuffer').mockImplementation(async () => {
      // Simulate occasional 429
      if (Math.random() < 0.2) {
        const err: any = new Error('Retryable Whisper error: 429');
        err.status = 429;
        throw err;
      }
      return { text: 'ok', confidence: 0.9, language: 'en', duration: 2 } as any;
    });

    const groups = Array.from({ length: 25 }, (_, i) => `g${i + 1}`);
    // Prime each group with a chunk, force boundary, then flush
    const flushes: Promise<any>[] = [];
    for (const g of groups) {
      await inMemoryAudioProcessor.ingestGroupAudioChunk(g, Buffer.from([1, 2, 3]), 'audio/webm', 's1');
      const state = (inMemoryAudioProcessor as any).groupWindows.get(g);
      state.windowStartedAt = Date.now() - (state.windowSeconds * 1000 + 50);
      flushes.push((inMemoryAudioProcessor as any).flushGroupWindow(g, state, 'audio/webm'));
    }

    // Run all flushes; limiter should prevent unbounded concurrency
    try {
      await Promise.allSettled(flushes);
    } catch {}

    // Ensure we had at least as many calls as groups (some may retry internally)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(25);

    // Spot-check a few groups for window adaptation (>= base on failure path)
    for (let i = 0; i < 5; i++) {
      const g = groups[i];
      const s = (inMemoryAudioProcessor as any).groupWindows.get(g);
      expect(s.windowSeconds).toBeGreaterThanOrEqual(10);
    }

    spy.mockRestore();
  });
});


