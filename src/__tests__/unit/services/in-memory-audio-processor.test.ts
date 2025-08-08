import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { InMemoryAudioProcessor } from '../../../services/audio/InMemoryAudioProcessor';

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
});


