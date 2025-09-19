import { inMemoryAudioProcessor } from '../../../services/audio/InMemoryAudioProcessor';

describe('InMemoryAudioProcessor — memory cleanup', () => {
  it('cleanupOldBuffers clears stale windows older than 60s', async () => {
    const anyProc: any = inMemoryAudioProcessor as any;
    const now = Date.now();
    anyProc.groupWindows.set('g1', { chunks: [Buffer.from('1'), Buffer.from('2')], bytes: 2, mimeType: 'audio/webm', windowStartedAt: now - 120000, windowSeconds: 15, consecutiveFailureCount: 0 });
    expect(anyProc.groupWindows.get('g1').bytes).toBe(2);
    await anyProc.cleanupOldBuffers();
    expect(anyProc.groupWindows.get('g1').bytes).toBe(0);
  });
});

