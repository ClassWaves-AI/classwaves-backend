import { AIAnalysisBufferService } from '../../../services/ai-analysis-buffer.service';

describe('AIAnalysisBufferService', () => {
  let service: AIAnalysisBufferService;

  beforeEach(() => {
    process.env.AI_GUIDANCE_CONTEXT_MAX_LINES = '2';
    service = new AIAnalysisBufferService();
  });

  afterEach(async () => {
    await service.shutdown();
    delete process.env.AI_GUIDANCE_CONTEXT_MAX_LINES;
    delete process.env.AI_GUIDANCE_CONTEXT_MAX_CHARS;
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

  describe('getContextWindows', () => {
    const sessionId = '9ce297d3-8deb-4010-b208-3f7fe02b7ffb';
    const groupId = 'ae735bb6-e927-4f6f-83f0-2b439a8166f9';

    it('returns sanitized aligned/tangent windows with masked PII and profanity', async () => {
      await service.bufferTranscription(groupId, sessionId, 'Speaker A: We reviewed photosynthesis at https://example.com yesterday.');
      await service.bufferTranscription(groupId, sessionId, 'Speaker B: Email me at student@example.com if you have questions.');
      await service.bufferTranscription(groupId, sessionId, 'Speaker C: The answer is 555-123-4567, damn that was tricky.');
      await service.bufferTranscription(groupId, sessionId, 'Speaker D: Now we keep talking about weekend soccer practice.');
      await service.bufferTranscription(groupId, sessionId, 'Speaker E: Alex thinks we should switch topics.');

      const windows = service.getContextWindows(sessionId, groupId);

      expect(windows.feature).toBe('legacy');
      expect(windows.tangent.length).toBeGreaterThan(0);
      expect(windows.current).toEqual(windows.tangent);
      expect(windows.aligned.length).toBeGreaterThan(0);

      const allQuotes = [...windows.tangent, ...windows.aligned].map((line) => line.text);
      expect(allQuotes.join(' ')).not.toMatch(/example.com/);
      expect(allQuotes.join(' ')).not.toMatch(/student@example.com/);
      expect(allQuotes.join(' ')).not.toMatch(/555-123-4567/);
      expect(allQuotes.join(' ')).not.toMatch(/damn/);
      expect(allQuotes.join(' ')).not.toMatch(/Alex/);
      expect(allQuotes.join(' ')).toMatch(/Student/);
      expect(allQuotes.join(' ')).not.toMatch(/Speaker\s+A/i);

      const speakerLabels = [...windows.tangent, ...windows.aligned].map((line) => line.speakerLabel);
      expect(speakerLabels.every((label) => /^Participant\s+\d+$/.test(label))).toBe(true);
    });

    it('returns empty windows when no transcripts buffered', () => {
      const empty = service.getContextWindows(sessionId, groupId);
      expect(empty.aligned).toEqual([]);
      expect(empty.tangent).toEqual([]);
      expect(empty.current).toEqual([]);
      expect(empty.feature).toBe('legacy');
      expect(empty.drift.alignmentDelta).toBe(0);
      expect(empty.inputQuality.episodeCount).toBe(0);
    });

    it('respects line and character limits when building windows', async () => {
      await service.shutdown();
      process.env.AI_GUIDANCE_CONTEXT_MAX_LINES = '2';
      process.env.AI_GUIDANCE_CONTEXT_MAX_CHARS = '60';
      service = new AIAnalysisBufferService();

      await service.bufferTranscription(groupId, sessionId, 'Student A: First aligned idea about energy transfer.');
      await service.bufferTranscription(groupId, sessionId, 'Student B: Adding more aligned evidence to the discussion.');
      await service.bufferTranscription(groupId, sessionId, 'Student C: Tangent about weekend sports that should truncate.');
      await service.bufferTranscription(groupId, sessionId, 'Student D: Another tangent sentence continuing well beyond the limit.');

      const windows = service.getContextWindows(sessionId, groupId);

      expect(windows.tangent).toHaveLength(2);
      expect(windows.feature).toBe('legacy');
      expect(windows.aligned).toHaveLength(2);

      expect(windows.aligned[0].text).toContain('energy transfer');
      expect(windows.aligned[1].text).toContain('aligned evidence');

      const combined = [...windows.aligned, ...windows.tangent];
      combined.forEach((line) => {
        expect(line.text.length).toBeLessThanOrEqual(60);
      });
    });

    it('falls back to aligned window when tangent lines exceed caps', async () => {
      await service.shutdown();
      process.env.AI_GUIDANCE_CONTEXT_MAX_LINES = '1';
      process.env.AI_GUIDANCE_CONTEXT_MAX_CHARS = '80';
      service = new AIAnalysisBufferService();

      await service.bufferTranscription(groupId, sessionId, 'Student A: Reviewing yesterday\'s rubric criteria.');
      await service.bufferTranscription(groupId, sessionId, 'Student B: Diving into related examples to stay aligned.');
      await service.bufferTranscription(groupId, sessionId, 'Student C: Quick tangent about weekend plans.');

      const windows = service.getContextWindows(sessionId, groupId);

      expect(windows.feature).toBe('legacy');
      expect(windows.tangent).toHaveLength(1);
      expect(windows.tangent[0].text).toContain('weekend plans');
      expect(windows.aligned).toHaveLength(1);
      expect(windows.aligned[0].text).toContain('stay aligned');
    });

    it('returns episode-aware windows with drift metrics when flag enabled', async () => {
      await service.shutdown();
      process.env.CW_GUIDANCE_EPISODES_ENABLED = '1';
      service = new AIAnalysisBufferService();

      await service.bufferTranscription(groupId, sessionId, 'Participant A: We are outlining chloroplast structure and energy transfer.');
      await service.bufferTranscription(groupId, sessionId, 'Participant B: This supports the photosynthesis goal around light reactions.');
      await service.bufferTranscription(groupId, sessionId, 'Participant C: Switching gears to lunch plans and weekend events.');
      await service.bufferTranscription(groupId, sessionId, 'Participant D: Still on the game strategy instead of chloroplast roles.');

      const windows = service.getContextWindows(sessionId, groupId, {
        goal: 'chloroplast energy transfer light reactions',
        domainTerms: ['chloroplast', 'photosynthesis'],
      });

      expect(windows.feature).toBe('episodes');
      expect(windows.current.length).toBeGreaterThan(0);
      expect(windows.aligned.length).toBeGreaterThan(0);
      expect(windows.drift.alignmentDelta).toBeGreaterThan(0);
      expect(windows.drift.persistentMs).toBeGreaterThanOrEqual(0);
      expect(windows.inputQuality.episodeCount).toBeGreaterThanOrEqual(1);

      await service.shutdown();
      delete process.env.CW_GUIDANCE_EPISODES_ENABLED;
      service = new AIAnalysisBufferService();
    });
  });
});
