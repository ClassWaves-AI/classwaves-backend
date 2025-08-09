import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { InMemoryAudioProcessor } from '../../../services/audio/InMemoryAudioProcessor';
import { openAIWhisperService } from '../../../services/openai-whisper.service';

describe('InMemoryAudioProcessor (Body 1 scope)', () => {
  beforeAll(() => {
    // Ensure we use mock transcription path
    process.env.DATABRICKS_TOKEN = '';
    // Use fake timers so constructor's setInterval does not keep process open
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  it('processes audio in-memory and returns mock transcription without disk writes', async () => {
    const processor = new InMemoryAudioProcessor();

    const groupId = 'group-test-1';
    const sessionId = 'session-test-1';
    const audioChunk = Buffer.from('dummy-audio');
    const mimeType = 'audio/webm';

    const result = await processor.processGroupAudio(groupId, audioChunk, mimeType, sessionId);

    expect(result.groupId).toBe(groupId);
    expect(result.sessionId).toBe(sessionId);
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);

    const stats = processor.getProcessingStats();
    const groupStats = stats.get(groupId);
    expect(groupStats).toBeDefined();
    expect(groupStats?.count).toBeGreaterThanOrEqual(1);
    expect(groupStats?.avgLatency).toBeGreaterThanOrEqual(0);

    const health = await processor.healthCheck();
    expect(['healthy', 'degraded']).toContain(health.status);
    expect(health.details).toHaveProperty('activeBuffers');
    expect(health.details.activeBuffers).toBe(0);
    expect(['mock', 'connected']).toContain(health.details.databricksConnectivity);
  });

  it('rejects unsupported audio formats', async () => {
    const processor = new InMemoryAudioProcessor();
    const groupId = 'group-test-2';
    const sessionId = 'session-test-2';
    const audioChunk = Buffer.from('dummy-audio');
    const badMimeType = 'text/plain';

    await expect(
      processor.processGroupAudio(groupId, audioChunk, badMimeType, sessionId)
    ).rejects.toThrow(/Unsupported audio format/i);
  });

  it('enforces back-pressure limits (per-group buffer > 10MB)', async () => {
    const processor = new InMemoryAudioProcessor();
    const groupId = 'group-test-3';
    const sessionId = 'session-test-3';

    // Prime internal buffer map with a large buffer for this group
    const largeSize = 10 * 1024 * 1024 + 1024; // > 10MB
    (processor as any).activeBuffers.set(`${groupId}-existing`, {
      data: Buffer.alloc(largeSize, 1),
      mimeType: 'audio/webm',
      timestamp: new Date(),
      size: largeSize,
    });

    await expect(
      processor.processGroupAudio(groupId, Buffer.from('x'), 'audio/webm', sessionId)
    ).rejects.toThrow(/Audio processing too slow/);
  });

  it('trips circuit breaker after consecutive failures and then skips submits while open', async () => {
    const processor = new InMemoryAudioProcessor();
    // Make breaker trip quickly for test
    (processor as any).breakerFailuresToTrip = 2;
    (processor as any).breakerCooldownMs = 50;

    const groupId = 'group-breaker-1';
    const state = {
      chunks: [Buffer.from('aa')],
      bytes: 2,
      mimeType: 'audio/webm',
      windowStartedAt: Date.now() - 16000,
      windowSeconds: 15,
      consecutiveFailureCount: 0,
    } as any;
    (processor as any).groupWindows.set(groupId, state);

    const spy = jest.spyOn(openAIWhisperService, 'transcribeBuffer').mockRejectedValue(new Error('fail'));

    await expect((processor as any).flushGroupWindow(groupId, state, 'audio/webm')).rejects.toThrow();
    state.chunks = [Buffer.from('bb')];
    state.bytes = 2;
    await expect((processor as any).flushGroupWindow(groupId, state, 'audio/webm')).rejects.toThrow();

    spy.mockClear();
    state.chunks = [Buffer.from('cc')];
    state.bytes = 2;
    const resp = await (processor as any).flushGroupWindow(groupId, state, 'audio/webm');
    expect(typeof resp.text).toBe('string');
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });

  it('zeros buffers and skips STT when STT_PROVIDER=off', async () => {
    const prev = process.env.STT_PROVIDER;
    process.env.STT_PROVIDER = 'off';
    const processor = new InMemoryAudioProcessor();
    const groupId = 'group-zero-1';
    const sessionId = 'session-zero-1';
    const buf = Buffer.from([1, 2, 3, 4, 5]);
    const res = await processor.processGroupAudio(groupId, buf, 'audio/webm', sessionId);
    expect(res.text).toBe('');
    expect(buf.equals(Buffer.alloc(buf.length, 0))).toBe(true);
    process.env.STT_PROVIDER = prev;
  });

  it('zero-disk: stubs fs writes and verifies buffer zeroing after processing', async () => {
    const processor = new InMemoryAudioProcessor();
    const fs = require('fs');
    const writeFileSpy = jest.spyOn(fs, 'writeFile').mockImplementation((...args: any[]) => {
      throw new Error('Should not write to disk');
    });
    const createWriteStreamSpy = jest.spyOn(fs, 'createWriteStream').mockImplementation((): any => {
      throw new Error('Should not create write stream');
    });

    const buf = Buffer.from([9, 9, 9, 9]);
    const groupId = 'group-zero-disk-1';
    const sessionId = 'session-zero-disk-1';
    const res = await processor.processGroupAudio(groupId, buf, 'audio/webm', sessionId);
    expect(typeof res.text).toBe('string');
    // Verify buffer is zeroed
    expect(buf.equals(Buffer.alloc(buf.length, 0))).toBe(true);

    writeFileSpy.mockRestore();
    createWriteStreamSpy.mockRestore();
  });
});


