/**
 * Unit Tests for TeacherPromptService.getActivePrompts()
 * 
 * Tests the newly implemented getActivePrompts method with real data patterns
 * - Cache and database integration
 * - Filtering and prioritization logic
 * - Error handling and graceful degradation
 * - FERPA/COPPA compliance audit logging
 */

import { TeacherPromptService } from '../../../services/teacher-prompt.service';
import { databricksService } from '../../../services/databricks.service';
import type { TeacherPrompt } from '../../../types/teacher-guidance.types';

// Mock databricks service
jest.mock('../../../services/databricks.service');
jest.mock('../../../utils/audit.port.instance', () => ({
  auditLogPort: { enqueue: jest.fn().mockResolvedValue(undefined) }
}));
import { auditLogPort } from '../../../utils/audit.port.instance';
const mockDatabricksService = databricksService as jest.Mocked<typeof databricksService>;

describe('TeacherPromptService.getActivePrompts()', () => {
  let service: TeacherPromptService;
  const mockSessionId = '550e8400-e29b-41d4-a716-446655440001';
  const mockTeacherId = '550e8400-e29b-41d4-a716-446655440002';

  beforeEach(() => {
    service = new TeacherPromptService();
    jest.clearAllMocks();
    
    // Mock audit logging
    (auditLogPort.enqueue as jest.Mock).mockResolvedValue(undefined);

    mockDatabricksService.tableHasColumns.mockResolvedValue(false);
  });

  describe('Real Data Integration', () => {
    it('should retrieve active prompts from cache and database with deduplication', async () => {
      // Real data pattern: Recently generated prompts in cache
      const cachedPrompts: TeacherPrompt[] = [
        {
          id: 'prompt-cache-1',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          groupId: 'group-1',
          category: 'redirection',
          priority: 'high',
          message: 'Group discussion has drifted off-topic. Try asking: "How does this relate to our learning goal?"',
          context: 'Group showing topic drift (score: 35%)',
          suggestedTiming: 'immediate',
          generatedAt: new Date(Date.now() - 5 * 60000), // 5 minutes ago
          expiresAt: new Date(Date.now() + 25 * 60000), // 25 minutes from now
          sessionPhase: 'development',
          subject: 'science',
          targetMetric: 'topicalCohesion',
          effectivenessScore: 0.85,
          createdAt: new Date(Date.now() - 5 * 60000),
          updatedAt: new Date(Date.now() - 5 * 60000)
        },
        {
          id: 'prompt-cache-2',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          groupId: 'group-2',
          category: 'deepening',
          priority: 'medium',
          message: 'Encourage deeper mathematical thinking. Try asking: "Can you explain your reasoning?"',
          context: 'Discussion needs more depth (score: 45%)',
          suggestedTiming: 'next_break',
          generatedAt: new Date(Date.now() - 3 * 60000), // 3 minutes ago
          expiresAt: new Date(Date.now() + 27 * 60000), // 27 minutes from now
          sessionPhase: 'development',
          subject: 'math',
          targetMetric: 'conceptualDensity',
          effectivenessScore: 0.72,
          createdAt: new Date(Date.now() - 3 * 60000),
          updatedAt: new Date(Date.now() - 3 * 60000)
        }
      ];

      // Mock cached prompts
      service['promptCache'].set(mockSessionId, cachedPrompts);

      // Real data pattern: Database persisted prompts (some overlap with cache)
      const dbResults = [
        {
          id: 'prompt-cache-1', // Duplicate with cache
          prompt_id: 'prompt-cache-1',
          session_id: mockSessionId,
          teacher_id: mockTeacherId,
          group_id: 'group-1',
          prompt_category: 'redirection',
          priority_level: 'high',
          prompt_message: 'Group discussion has drifted off-topic. Try asking: "How does this relate to our learning goal?"',
          prompt_context: 'Group showing topic drift (score: 35%)',
          suggested_timing: 'immediate',
          session_phase: 'development',
          subject_area: 'science',
          target_metric: 'topicalCohesion',
          learning_objectives: '["Understanding photosynthesis", "Collaborative discussion"]',
          generated_at: new Date(Date.now() - 5 * 60000).toISOString(),
          expires_at: new Date(Date.now() + 25 * 60000).toISOString(),
          acknowledged_at: null,
          used_at: null,
          dismissed_at: null,
          effectiveness_score: 0.85,
          feedback_rating: null,
          feedback_text: null,
          created_at: new Date(Date.now() - 5 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 5 * 60000).toISOString()
        },
        {
          id: 'prompt-db-only',
          prompt_id: 'prompt-db-only',
          session_id: mockSessionId,
          teacher_id: mockTeacherId,
          group_id: 'group-3',
          prompt_category: 'collaboration',
          priority_level: 'medium',
          prompt_message: 'Some group members may not be participating fully. Try: "Let\'s hear from everyone on this"',
          prompt_context: 'Some voices may not be heard (inclusivity: 40%)',
          suggested_timing: 'next_break',
          session_phase: 'development',
          subject_area: 'literature',
          target_metric: 'collaborationPatterns.inclusivity',
          learning_objectives: '["Literary analysis", "Discussion skills"]',
          generated_at: new Date(Date.now() - 8 * 60000).toISOString(),
          expires_at: new Date(Date.now() + 22 * 60000).toISOString(),
          acknowledged_at: null,
          used_at: null,
          dismissed_at: null,
          effectiveness_score: 0.78,
          feedback_rating: null,
          feedback_text: null,
          created_at: new Date(Date.now() - 8 * 60000).toISOString(),
          updated_at: new Date(Date.now() - 8 * 60000).toISOString()
        }
      ];

      mockDatabricksService.query.mockResolvedValue(dbResults);

      // Execute method
      const result = await service.getActivePrompts(mockSessionId);

      // Verify results
      expect(result).toHaveLength(3); // 2 from cache + 1 unique from DB
      
      // Verify deduplication (cache takes precedence)
      const promptIds = result.map(p => p.id);
      expect(promptIds).toContain('prompt-cache-1');
      expect(promptIds).toContain('prompt-cache-2');
      expect(promptIds).toContain('prompt-db-only');
      expect(new Set(promptIds).size).toBe(3); // No duplicates

      // Verify sorting (high priority first, then newest)
      expect(result[0].priority).toBe('high');
      expect(result[0].id).toBe('prompt-cache-1');

      // Verify compliance audit logging (enqueued)
      expect(auditLogPort.enqueue).toHaveBeenCalledWith(expect.objectContaining({
        actorId: 'system',
        actorType: 'system',
        eventType: 'teacher_prompt_access',
        eventCategory: 'data_access',
        resourceType: 'teacher_guidance',
        resourceId: mockSessionId,
        schoolId: 'system',
        description: expect.stringContaining('Retrieve active teacher prompts'),
        complianceBasis: 'legitimate_interest',
        dataAccessed: 'ai_insights'
      }));
    });

    it('should handle database failures gracefully and return cache-only results', async () => {
      // Setup cache with real data
      const cachedPrompts: TeacherPrompt[] = [
        {
          id: 'prompt-cache-only',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          category: 'energy',
          priority: 'medium',
          message: 'The group\'s energy seems to be declining. Consider a brief energizer.',
          context: 'Group energy is declining',
          suggestedTiming: 'immediate',
          generatedAt: new Date(Date.now() - 2 * 60000),
          expiresAt: new Date(Date.now() + 28 * 60000),
          sessionPhase: 'development',
          subject: 'general',
          targetMetric: 'collectiveEmotionalArc.trajectory',
          effectivenessScore: 0.65,
          createdAt: new Date(Date.now() - 2 * 60000),
          updatedAt: new Date(Date.now() - 2 * 60000)
        }
      ];

      service['promptCache'].set(mockSessionId, cachedPrompts);

      // Simulate database failure
      mockDatabricksService.query.mockRejectedValue(new Error('Database connection failed'));

      // Execute method
      const result = await service.getActivePrompts(mockSessionId);

      // Verify graceful degradation
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('prompt-cache-only');

      // Should still complete successfully despite DB error; audit enqueued
      expect(auditLogPort.enqueue).toHaveBeenCalled();
    });

    it('should apply priority and age filters correctly with real data patterns', async () => {
      const now = new Date();
      const prompts: TeacherPrompt[] = [
        {
          id: 'high-priority-recent',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          category: 'redirection',
          priority: 'high',
          message: 'Urgent: Group needs immediate redirection',
          context: 'Critical topic drift detected',
          suggestedTiming: 'immediate',
          generatedAt: new Date(now.getTime() - 2 * 60000), // 2 min ago
          expiresAt: new Date(now.getTime() + 28 * 60000),
          sessionPhase: 'development',
          subject: 'science',
          effectivenessScore: 0.9,
          createdAt: new Date(now.getTime() - 2 * 60000),
          updatedAt: new Date(now.getTime() - 2 * 60000)
        },
        {
          id: 'low-priority-recent',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          category: 'facilitation',
          priority: 'low',
          message: 'Consider gentle facilitation technique',
          context: 'Minor discussion enhancement opportunity',
          suggestedTiming: 'session_end',
          generatedAt: new Date(now.getTime() - 3 * 60000), // 3 min ago
          expiresAt: new Date(now.getTime() + 27 * 60000),
          sessionPhase: 'development',
          subject: 'math',
          effectivenessScore: 0.5,
          createdAt: new Date(now.getTime() - 3 * 60000),
          updatedAt: new Date(now.getTime() - 3 * 60000)
        },
        {
          id: 'medium-priority-old',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          category: 'deepening',
          priority: 'medium',
          message: 'Encourage deeper analysis',
          context: 'Surface-level discussion detected',
          suggestedTiming: 'next_break',
          generatedAt: new Date(now.getTime() - 35 * 60000), // 35 min ago (too old)
          expiresAt: new Date(now.getTime() + 5 * 60000),
          sessionPhase: 'development',
          subject: 'literature',
          effectivenessScore: 0.7,
          createdAt: new Date(now.getTime() - 35 * 60000),
          updatedAt: new Date(now.getTime() - 35 * 60000)
        }
      ];

      service['promptCache'].set(mockSessionId, prompts);
      mockDatabricksService.query.mockResolvedValue([]);

      // Test priority filter
      const highPriorityResult = await service.getActivePrompts(mockSessionId, {
        priorityFilter: ['high'],
        maxAge: 60 // 1 hour
      });

      expect(highPriorityResult).toHaveLength(1);
      expect(highPriorityResult[0].id).toBe('high-priority-recent');
      expect(highPriorityResult[0].priority).toBe('high');

      // Test age filter
      const recentResult = await service.getActivePrompts(mockSessionId, {
        maxAge: 10 // 10 minutes
      });

      expect(recentResult).toHaveLength(2); // Only recent prompts
      expect(recentResult.map(p => p.id)).toEqual(['high-priority-recent', 'low-priority-recent']);

      // Test combined filters
      const filteredResult = await service.getActivePrompts(mockSessionId, {
        priorityFilter: ['high', 'medium'],
        maxAge: 60
      });

      expect(filteredResult).toHaveLength(2); // high + medium priority
      expect(filteredResult[0].priority).toBe('high'); // Sorted by priority
    });

    it('should handle expired prompts correctly', async () => {
      const now = new Date();
      const prompts: TeacherPrompt[] = [
        {
          id: 'active-prompt',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          category: 'collaboration',
          priority: 'medium',
          message: 'Active prompt for current session',
          context: 'Real-time guidance needed',
          suggestedTiming: 'immediate',
          generatedAt: new Date(now.getTime() - 5 * 60000),
          expiresAt: new Date(now.getTime() + 10 * 60000), // Active
          sessionPhase: 'development',
          subject: 'science',
          effectivenessScore: 0.8,
          createdAt: new Date(now.getTime() - 5 * 60000),
          updatedAt: new Date(now.getTime() - 5 * 60000)
        },
        {
          id: 'expired-prompt',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          category: 'redirection',
          priority: 'high',
          message: 'Expired prompt from earlier',
          context: 'Historical guidance no longer relevant',
          suggestedTiming: 'immediate',
          generatedAt: new Date(now.getTime() - 45 * 60000),
          expiresAt: new Date(now.getTime() - 10 * 60000), // Expired
          sessionPhase: 'development',
          subject: 'math',
          effectivenessScore: 0.75,
          createdAt: new Date(now.getTime() - 45 * 60000),
          updatedAt: new Date(now.getTime() - 45 * 60000)
        }
      ];

      service['promptCache'].set(mockSessionId, prompts);
      mockDatabricksService.query.mockResolvedValue([]);

      // Test default behavior (exclude expired)
      const activeResult = await service.getActivePrompts(mockSessionId);
      expect(activeResult).toHaveLength(1);
      expect(activeResult[0].id).toBe('active-prompt');

      // Test include expired option
      const allResult = await service.getActivePrompts(mockSessionId, {
        includeExpired: true,
        maxAge: 60 // Include old prompts with longer max age
      });
      expect(allResult).toHaveLength(2);
      expect(allResult.map(p => p.id)).toContain('expired-prompt');
    });
  });

  describe('Error Handling and Compliance', () => {
    it('should validate input parameters', async () => {
      await expect(service.getActivePrompts('')).rejects.toThrow('Invalid sessionId provided');
      await expect(service.getActivePrompts(null as any)).rejects.toThrow('Invalid sessionId provided');
    });

    it('should log audit errors without failing the operation', async () => {
      // Setup test data
      service['promptCache'].set(mockSessionId, []);
      mockDatabricksService.query.mockResolvedValue([]);
      
      // Mock audit logging failure
      (auditLogPort.enqueue as jest.Mock).mockRejectedValue(new Error('Audit system down'));

      // Should still complete successfully
      const result = await service.getActivePrompts(mockSessionId);
      expect(result).toEqual([]);
    });

    it('should handle complete database failure gracefully with audit logging', async () => {
      // Mock complete database failure but audit logging should still work initially
      mockDatabricksService.query.mockRejectedValue(new Error('Complete database failure'));
      
      // Should not throw, but return empty results gracefully
      const result = await service.getActivePrompts(mockSessionId);
      expect(result).toEqual([]);

      // Should have attempted initial audit logging
      expect(auditLogPort.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'teacher_prompt_access'
        })
      );
    });
  });

  describe('Performance and Caching', () => {
    it('should demonstrate optimal performance with large dataset', async () => {
      // Generate realistic large dataset
      const largePromptSet: TeacherPrompt[] = [];
      for (let i = 0; i < 50; i++) {
        largePromptSet.push({
          id: `prompt-${i}`,
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          groupId: `group-${i % 5}`,
          category: ['redirection', 'deepening', 'collaboration', 'energy'][i % 4] as any,
          priority: ['high', 'medium', 'low'][i % 3] as any,
          message: `Test prompt ${i} for performance testing`,
          context: `Context for prompt ${i}`,
          suggestedTiming: 'immediate',
          generatedAt: new Date(Date.now() - (i * 60000)), // Staggered times
          expiresAt: new Date(Date.now() + (30 * 60000)),
          sessionPhase: 'development',
          subject: 'science',
          effectivenessScore: 0.5 + (i % 50) / 100,
          createdAt: new Date(Date.now() - (i * 60000)),
          updatedAt: new Date(Date.now() - (i * 60000))
        });
      }

      service['promptCache'].set(mockSessionId, largePromptSet);
      mockDatabricksService.query.mockResolvedValue([]);

      const startTime = Date.now();
      const result = await service.getActivePrompts(mockSessionId);
      const duration = Date.now() - startTime;

      // Performance assertion
      expect(duration).toBeLessThan(100); // Should complete in <100ms
      expect(result.length).toBeGreaterThan(0);
      
      // Verify sorting is maintained even with large dataset
      for (let i = 0; i < result.length - 1; i++) {
        const current = result[i];
        const next = result[i + 1];
        
        const priorityOrder = { 'high': 3, 'medium': 2, 'low': 1 };
        expect(priorityOrder[current.priority]).toBeGreaterThanOrEqual(priorityOrder[next.priority]);
      }
    });
  });

  describe('Structured Context Columns', () => {
    it('hydrates prompts with structured context and summaries when available', async () => {
      const generatedAt = new Date(Date.now() - 4 * 60000).toISOString();
      const expiresAt = new Date(Date.now() + 26 * 60000).toISOString();

      mockDatabricksService.tableHasColumns.mockResolvedValueOnce(true);
      mockDatabricksService.query.mockResolvedValueOnce([
        {
          id: 'prompt-db-context',
          prompt_id: 'prompt-db-context',
          session_id: mockSessionId,
          teacher_id: mockTeacherId,
          group_id: 'group-ctx',
          prompt_category: 'redirection',
          priority_level: 'medium',
          prompt_message: 'Guide students back to the essential question.',
          prompt_context: 'Recent talk has drifted.',
          suggested_timing: 'immediate',
          session_phase: 'development',
          subject_area: 'science',
          target_metric: 'topicalCohesion',
          learning_objectives: '["Explain photosynthesis"]',
          generated_at: generatedAt,
          expires_at: expiresAt,
          acknowledged_at: null,
          used_at: null,
          dismissed_at: null,
          effectiveness_score: 0.7,
          feedback_rating: null,
          feedback_text: null,
          created_at: generatedAt,
          updated_at: generatedAt,
          context_reason: 'Recent discussion has drifted to unrelated stories.',
          context_prior_topic: 'Explaining the steps of photosynthesis',
          context_current_topic: 'Weekend sports highlights',
          context_transition_idea: 'Bridge by asking how the sports strategy compares to plant energy transfer.',
          context_supporting_lines: JSON.stringify([
            { speaker: 'Participant 3', quote: 'Remember when we described chlorophyll yesterday?', timestamp: new Date().toISOString() },
            { speaker: 'Participant 4', quote: 'This reminds me of the soccer match last night.', timestamp: new Date().toISOString() },
          ]),
          context_confidence: 0.84,
          bridging_prompt: 'Invite the group to connect back to photosynthesis.',
          on_track_summary: 'Group is on track — cohesion 82%, depth 80%. Celebrate their focus.',
        },
      ]);

      const results = await service.getActivePrompts(mockSessionId);
      expect(results).toHaveLength(1);
      const prompt = results[0];

      expect(prompt.contextEvidence).toMatchObject({
        reason: expect.stringContaining('drifted'),
        priorTopic: expect.stringContaining('photosynthesis'),
        currentTopic: expect.stringContaining('sports'),
        transitionIdea: expect.stringContaining('Bridge'),
        confidence: 0.84,
      });
      expect(prompt.contextEvidence?.quotes).toHaveLength(2);
      expect(prompt.contextEvidence?.quotes?.[0]).toEqual(
        expect.objectContaining({ speakerLabel: 'Participant 3' })
      );
      expect(prompt.contextEvidence?.supportingLines).toHaveLength(2);
      expect(prompt.contextEvidence?.supportingLines?.[0]).toEqual(
        expect.objectContaining({ speaker: 'Participant 3' })
      );
      expect(prompt.contextEvidence?.quotes?.[0]?.text).not.toMatch(/["'“”‘’]/);
      expect(prompt.bridgingPrompt).toContain('photosynthesis');
      expect(prompt.onTrackSummary).toContain('on track');
    });
  });
});
