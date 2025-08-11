import { AIAnalysisBufferService } from '../../../services/ai-analysis-buffer.service';

describe('AIAnalysisBufferService', () => {
  let service: AIAnalysisBufferService;

  beforeEach(() => {
    service = new AIAnalysisBufferService();
    jest.clearAllTimers();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('bufferTranscription', () => {
    it('should add transcription to Tier 1 buffer', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';
      const transcription = 'This is a test transcription';

      await service.bufferTranscription(groupId, sessionId, transcription);

      const buffer = service.getTier1Buffer(groupId);
      expect(buffer).toBeDefined();
      expect(buffer!.transcripts).toHaveLength(1);
      expect(buffer!.transcripts[0].text).toBe(transcription);
      expect(buffer!.sessionId).toBe(sessionId);
    });

    it('should add transcription to Tier 2 buffer', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';
      const transcription = 'This is a test transcription';

      await service.bufferTranscription(groupId, sessionId, transcription);

      const buffer = service.getTier2Buffer(sessionId);
      expect(buffer).toBeDefined();
      expect(buffer!.transcripts).toHaveLength(1);
      expect(buffer!.transcripts[0].text).toBe(transcription);
      expect(buffer!.transcripts[0].groupId).toBe(groupId);
    });

    it('should accumulate multiple transcriptions', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId, sessionId, 'First message');
      await service.bufferTranscription(groupId, sessionId, 'Second message');
      await service.bufferTranscription(groupId, sessionId, 'Third message');

      const tier1Buffer = service.getTier1Buffer(groupId);
      const tier2Buffer = service.getTier2Buffer(sessionId);

      expect(tier1Buffer!.transcripts).toHaveLength(3);
      expect(tier2Buffer!.transcripts).toHaveLength(3);
    });

    it('should update buffer timing information', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';
      const startTime = Date.now();

      await service.bufferTranscription(groupId, sessionId, 'Test message');

      const buffer = service.getTier1Buffer(groupId);
      expect(buffer!.lastUpdated.getTime()).toBeGreaterThanOrEqual(startTime);
      expect(buffer!.firstTranscriptAt.getTime()).toBeGreaterThanOrEqual(startTime);
    });

    it('should maintain correct combined text length', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';
      const message1 = 'Short message';
      const message2 = 'This is a longer message with more content';

      await service.bufferTranscription(groupId, sessionId, message1);
      await service.bufferTranscription(groupId, sessionId, message2);

      const buffer = service.getTier1Buffer(groupId);
      const expectedLength = message1.length + message2.length;
      expect(buffer!.combinedLength).toBe(expectedLength);
    });
  });

  describe('shouldTriggerTier1Analysis', () => {
    it('should return false for new buffer', () => {
      const groupId = 'group1';
      expect(service.shouldTriggerTier1Analysis(groupId)).toBe(false);
    });

    it('should trigger after 30 seconds', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId, sessionId, 'Test message');
      
      // Not enough time passed
      expect(service.shouldTriggerTier1Analysis(groupId)).toBe(false);

      // Advance time by 30 seconds
      jest.advanceTimersByTime(30000);
      expect(service.shouldTriggerTier1Analysis(groupId)).toBe(true);
    });

    it('should trigger when buffer exceeds length threshold', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';
      
      // Create a long message that exceeds the threshold
      const longMessage = 'A'.repeat(1000);
      await service.bufferTranscription(groupId, sessionId, longMessage);

      expect(service.shouldTriggerTier1Analysis(groupId)).toBe(true);
    });

    it('should not trigger for already analyzed buffer', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId, sessionId, 'Test message');
      jest.advanceTimersByTime(30000);

      // First check should trigger
      expect(service.shouldTriggerTier1Analysis(groupId)).toBe(true);

      // Mark as analyzed
      service.markTier1Analyzed(groupId);

      // Should not trigger again immediately
      expect(service.shouldTriggerTier1Analysis(groupId)).toBe(false);
    });
  });

  describe('shouldTriggerTier2Analysis', () => {
    it('should return false for new buffer', () => {
      const sessionId = 'session1';
      expect(service.shouldTriggerTier2Analysis(sessionId)).toBe(false);
    });

    it('should trigger after 2 minutes with sufficient content', async () => {
      const sessionId = 'session1';
      const groupId = 'group1';

      // Add sufficient content
      for (let i = 0; i < 10; i++) {
        await service.bufferTranscription(groupId, sessionId, 'This is a substantial discussion message');
      }

      // Not enough time passed
      expect(service.shouldTriggerTier2Analysis(sessionId)).toBe(false);

      // Advance time by 2 minutes
      jest.advanceTimersByTime(120000);
      expect(service.shouldTriggerTier2Analysis(sessionId)).toBe(true);
    });

    it('should trigger when buffer exceeds length threshold', async () => {
      const sessionId = 'session1';
      const groupId = 'group1';
      
      // Create content that exceeds the threshold
      const longMessage = 'A'.repeat(2000);
      await service.bufferTranscription(groupId, sessionId, longMessage);

      expect(service.shouldTriggerTier2Analysis(sessionId)).toBe(true);
    });

    it('should require minimum content length', async () => {
      const sessionId = 'session1';
      const groupId = 'group1';

      // Add minimal content
      await service.bufferTranscription(groupId, sessionId, 'Short');

      // Even after time threshold, should not trigger due to insufficient content
      jest.advanceTimersByTime(300000); // 5 minutes
      expect(service.shouldTriggerTier2Analysis(sessionId)).toBe(false);
    });
  });

  describe('buffer retrieval and management', () => {
    it('should retrieve buffer transcripts for analysis', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId, sessionId, 'Message 1');
      await service.bufferTranscription(groupId, sessionId, 'Message 2');

      const transcripts = service.getBufferedTranscripts(groupId);
      expect(transcripts).toHaveLength(2);
      expect(transcripts[0].text).toBe('Message 1');
      expect(transcripts[1].text).toBe('Message 2');
    });

    it('should return empty array for non-existent buffer', () => {
      const transcripts = service.getBufferedTranscripts('nonexistent');
      expect(transcripts).toEqual([]);
    });

    it('should mark Tier 1 buffer as analyzed', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId, sessionId, 'Test message');
      service.markTier1Analyzed(groupId);

      const buffer = service.getTier1Buffer(groupId);
      expect(buffer!.lastAnalyzedAt).toBeDefined();
      expect(buffer!.lastAnalyzedAt!.getTime()).toBeGreaterThan(0);
    });

    it('should mark Tier 2 buffer as analyzed', async () => {
      const sessionId = 'session1';
      const groupId = 'group1';

      await service.bufferTranscription(groupId, sessionId, 'Test message');
      service.markTier2Analyzed(sessionId);

      const buffer = service.getTier2Buffer(sessionId);
      expect(buffer!.lastAnalyzedAt).toBeDefined();
      expect(buffer!.lastAnalyzedAt!.getTime()).toBeGreaterThan(0);
    });
  });

  describe('buffer cleanup', () => {
    it('should clean up old buffers', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId, sessionId, 'Test message');

      // Advance time to make buffer old
      jest.advanceTimersByTime(3600000); // 1 hour

      service.cleanupOldBuffers();

      expect(service.getTier1Buffer(groupId)).toBeUndefined();
      expect(service.getTier2Buffer(sessionId)).toBeUndefined();
    });

    it('should not clean up recent buffers', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId, sessionId, 'Test message');

      // Only advance time by 10 minutes
      jest.advanceTimersByTime(600000);

      service.cleanupOldBuffers();

      expect(service.getTier1Buffer(groupId)).toBeDefined();
      expect(service.getTier2Buffer(sessionId)).toBeDefined();
    });

    it('should clean up analyzed buffers after extended time', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId, sessionId, 'Test message');
      service.markTier1Analyzed(groupId);
      service.markTier2Analyzed(sessionId);

      // Advance time significantly
      jest.advanceTimersByTime(7200000); // 2 hours

      service.cleanupOldBuffers();

      expect(service.getTier1Buffer(groupId)).toBeUndefined();
      expect(service.getTier2Buffer(sessionId)).toBeUndefined();
    });
  });

  describe('buffer status monitoring', () => {
    it('should provide buffer status for monitoring', async () => {
      const groupId1 = 'group1';
      const groupId2 = 'group2';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId1, sessionId, 'Message 1');
      await service.bufferTranscription(groupId2, sessionId, 'Message 2');

      const status = service.getBufferStatus();

      expect(status.tier1BufferCount).toBe(2);
      expect(status.tier2BufferCount).toBe(1); // Same session
      expect(status.totalTranscripts).toBe(2);
      expect(status.totalMemoryUsage).toBeGreaterThan(0);
    });

    it('should calculate memory usage correctly', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';
      const message = 'Test message for memory calculation';

      await service.bufferTranscription(groupId, sessionId, message);

      const status = service.getBufferStatus();
      const expectedSize = message.length * 2; // Rough estimate (2 bytes per char)

      expect(status.totalMemoryUsage).toBeGreaterThanOrEqual(expectedSize);
    });
  });

  describe('error handling', () => {
    it('should handle invalid group IDs gracefully', async () => {
      expect(() => service.shouldTriggerTier1Analysis('')).not.toThrow();
      expect(service.shouldTriggerTier1Analysis('')).toBe(false);
    });

    it('should handle invalid session IDs gracefully', async () => {
      expect(() => service.shouldTriggerTier2Analysis('')).not.toThrow();
      expect(service.shouldTriggerTier2Analysis('')).toBe(false);
    });

    it('should handle null/undefined transcriptions', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await expect(service.bufferTranscription(groupId, sessionId, null as any))
        .rejects.toThrow();
      await expect(service.bufferTranscription(groupId, sessionId, undefined as any))
        .rejects.toThrow();
    });

    it('should handle empty transcriptions', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId, sessionId, '');

      const buffer = service.getTier1Buffer(groupId);
      expect(buffer!.transcripts).toHaveLength(1);
      expect(buffer!.combinedLength).toBe(0);
    });
  });
});
