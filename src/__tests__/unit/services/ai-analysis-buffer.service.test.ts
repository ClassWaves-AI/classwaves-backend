import { AIAnalysisBufferService } from '../../../services/ai-analysis-buffer.service';

describe('AIAnalysisBufferService', () => {
  let service: AIAnalysisBufferService;

  beforeEach(() => {
    service = new AIAnalysisBufferService();
  });

  afterEach(async () => {
    await service.shutdown();
  });

  describe('bufferTranscription', () => {
    it('should buffer a transcription successfully', async () => {
      const groupId = '550e8400-e29b-41d4-a716-446655440010';
      const sessionId = '550e8400-e29b-41d4-a716-446655440011';
      const transcription = 'This is a test transcription';

      await service.bufferTranscription(groupId, sessionId, transcription);

      const transcripts = await service.getBufferedTranscripts('tier1', groupId, sessionId);
      expect(transcripts).toHaveLength(1);
      expect(transcripts[0]).toBe(transcription);
    });

    it('should accumulate multiple transcriptions', async () => {
      const groupId = '550e8400-e29b-41d4-a716-446655440010';
      const sessionId = '550e8400-e29b-41d4-a716-446655440011';

      await service.bufferTranscription(groupId, sessionId, 'First message');
      await service.bufferTranscription(groupId, sessionId, 'Second message');

      const transcripts = await service.getBufferedTranscripts('tier1', groupId, sessionId);
      expect(transcripts).toHaveLength(2);
      expect(transcripts[0]).toBe('First message');
      expect(transcripts[1]).toBe('Second message');
    });
  });

  describe('getBufferedTranscripts', () => {
    it('should return buffered transcripts for tier1', async () => {
      const groupId = '550e8400-e29b-41d4-a716-446655440010';
      const sessionId = '550e8400-e29b-41d4-a716-446655440011';

      await service.bufferTranscription(groupId, sessionId, 'Message 1');
      await service.bufferTranscription(groupId, sessionId, 'Message 2');

      const transcripts = await service.getBufferedTranscripts('tier1', groupId, sessionId);
      expect(transcripts).toHaveLength(2);
      expect(transcripts[0]).toBe('Message 1');
      expect(transcripts[1]).toBe('Message 2');
    });

    it('should return empty array for non-existent buffer', async () => {
      const transcripts = await service.getBufferedTranscripts('tier1', '550e8400-e29b-41d4-a716-446655440012', '550e8400-e29b-41d4-a716-446655440013');
      expect(transcripts).toEqual([]);
    });

    it('should handle both tier1 and tier2 buffers', async () => {
      const groupId = '550e8400-e29b-41d4-a716-446655440010';
      const sessionId = '550e8400-e29b-41d4-a716-446655440011';

      await service.bufferTranscription(groupId, sessionId, 'Test message');

      const tier1Transcripts = await service.getBufferedTranscripts('tier1', groupId, sessionId);
      const tier2Transcripts = await service.getBufferedTranscripts('tier2', groupId, sessionId);

      expect(tier1Transcripts).toHaveLength(1);
      expect(tier2Transcripts).toHaveLength(1);
      expect(tier1Transcripts[0]).toBe('Test message');
      expect(tier2Transcripts[0]).toBe('Test message');
    });
  });

  describe('markBufferAnalyzed', () => {
    it('should mark tier1 buffer as analyzed', async () => {
      const groupId = '550e8400-e29b-41d4-a716-446655440010';
      const sessionId = '550e8400-e29b-41d4-a716-446655440011';

      await service.bufferTranscription(groupId, sessionId, 'Test message');
      await service.markBufferAnalyzed('tier1', groupId, sessionId);

      // Buffer should still contain transcripts after being marked as analyzed
      const transcripts = await service.getBufferedTranscripts('tier1', groupId, sessionId);
      expect(transcripts).toHaveLength(1);
    });

    it('should mark tier2 buffer as analyzed', async () => {
      const groupId = '550e8400-e29b-41d4-a716-446655440010';
      const sessionId = '550e8400-e29b-41d4-a716-446655440011';

      await service.bufferTranscription(groupId, sessionId, 'Test message');
      await service.markBufferAnalyzed('tier2', groupId, sessionId);

      // Buffer should still contain transcripts after being marked as analyzed  
      const transcripts = await service.getBufferedTranscripts('tier2', groupId, sessionId);
      expect(transcripts).toHaveLength(1);
    });
  });

  describe('getBufferStats', () => {
    it('should return buffer statistics', () => {
      const stats = service.getBufferStats();

      expect(stats).toHaveProperty('tier1');
      expect(stats).toHaveProperty('tier2');
      expect(stats.tier1).toHaveProperty('totalTranscripts');
      expect(stats.tier1).toHaveProperty('totalBuffers');
      expect(stats.tier1).toHaveProperty('memoryUsageBytes');
      expect(stats.tier2).toHaveProperty('totalTranscripts');
      expect(stats.tier2).toHaveProperty('totalBuffers'); 
      expect(stats.tier2).toHaveProperty('memoryUsageBytes');
    });

    it('should reflect buffer usage in stats', async () => {
      const groupId = '550e8400-e29b-41d4-a716-446655440010';
      const sessionId = '550e8400-e29b-41d4-a716-446655440011';

      await service.bufferTranscription(groupId, sessionId, 'Test message');

      const stats = service.getBufferStats();
      expect(stats.tier1.totalTranscripts).toBeGreaterThan(0);
      expect(stats.tier2.totalTranscripts).toBeGreaterThan(0);
      expect(stats.tier1.totalBuffers).toBeGreaterThan(0);
      expect(stats.tier2.totalBuffers).toBeGreaterThan(0);
    });
  });

  describe('cleanup', () => {
    it('should run cleanup without errors', async () => {
      const groupId = '550e8400-e29b-41d4-a716-446655440010';
      const sessionId = '550e8400-e29b-41d4-a716-446655440011';

      await service.bufferTranscription(groupId, sessionId, 'Test message');
      
      // Should not throw
      await expect(service.cleanup()).resolves.not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should handle empty transcriptions gracefully', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';

      await service.bufferTranscription(groupId, sessionId, '');

      const transcripts = await service.getBufferedTranscripts('tier1', groupId, sessionId);
      expect(transcripts).toHaveLength(1);
      expect(transcripts[0]).toBe('');
    });

    it('should handle special characters in transcriptions', async () => {
      const groupId = 'group1';
      const sessionId = 'session1';
      const specialText = 'Test with émojis 😊 and special chars: @#$%^&*()';

      await service.bufferTranscription(groupId, sessionId, specialText);

      const transcripts = await service.getBufferedTranscripts('tier1', groupId, sessionId);
      expect(transcripts[0]).toBe(specialText);
    });

    it('should handle missing parameters gracefully', async () => {
      expect(() => service.getBufferStats()).not.toThrow();
    });
  });
});
