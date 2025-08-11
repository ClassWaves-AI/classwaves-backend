import { TeacherPromptService } from '../../../services/teacher-prompt.service';
import { Tier1Insights, Tier2Insights } from '../../../types/ai-analysis.types';
import { PromptGenerationContext } from '../../../types/teacher-guidance.types';

describe('TeacherPromptService', () => {
  let service: TeacherPromptService;

  beforeEach(() => {
    service = new TeacherPromptService();
  });

  describe('generatePrompts', () => {
    const mockContext: PromptGenerationContext = {
      sessionId: 'session1',
      teacherId: 'teacher1',
      groupId: 'group1',
      sessionPhase: 'development',
      subject: 'science',
      learningObjectives: ['Understanding photosynthesis', 'Collaborative discussion'],
      currentTime: new Date(),
      groupSize: 4,
      sessionDuration: 25
    };

    it('should generate prompts from Tier 1 insights', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 65, // Low cohesion should trigger redirection prompt
        conceptualDensity: 85,
        engagementLevel: 'high',
        collaborationQuality: 'good',
        participationBalance: 0.7,
        offTopicIndicators: ['tangent discussion'],
        keyTermsUsed: ['photosynthesis', 'chloroplast'],
        groupDynamics: {
          leadershipPattern: 'rotating',
          conflictLevel: 'low'
        }
      };

      const prompts = await service.generatePrompts(tier1Insights, null, mockContext);

      expect(prompts).toHaveLength(1);
      expect(prompts[0].category).toBe('redirection');
      expect(prompts[0].priority).toBe('medium');
      expect(prompts[0].message).toContain('focus');
      expect(prompts[0].sessionId).toBe('session1');
      expect(prompts[0].teacherId).toBe('teacher1');
    });

    it('should generate prompts from Tier 2 insights', async () => {
      const tier2Insights: Tier2Insights = {
        argumentationQuality: 45, // Low quality should trigger deepening prompt
        emotionalArc: {
          phases: ['engagement', 'confusion'],
          overallSentiment: 'frustrated',
          emotionalPeaks: [],
          engagementTrend: 'declining'
        },
        collaborationPatterns: {
          leadershipDistribution: 'dominated',
          participationEquity: 0.3,
          supportiveInteractions: 2,
          buildingOnIdeas: 1
        },
        learningSignals: {
          conceptualBreakthroughs: 0,
          misconceptionsCorrected: 0,
          deepQuestioningOccurred: false,
          evidenceOfUnderstanding: ['basic_recall']
        }
      };

      const prompts = await service.generatePrompts(null, tier2Insights, mockContext);

      expect(prompts.length).toBeGreaterThan(0);
      
      // Should have deepening prompt for low argumentation quality
      const deepeningPrompt = prompts.find(p => p.category === 'deepening');
      expect(deepeningPrompt).toBeDefined();
      expect(deepeningPrompt!.priority).toBe('high');

      // Should have collaboration prompt for poor participation equity
      const collaborationPrompt = prompts.find(p => p.category === 'collaboration');
      expect(collaborationPrompt).toBeDefined();
    });

    it('should combine Tier 1 and Tier 2 insights', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 90,
        conceptualDensity: 80,
        engagementLevel: 'high',
        collaborationQuality: 'excellent',
        participationBalance: 0.9,
        offTopicIndicators: [],
        keyTermsUsed: ['photosynthesis', 'chloroplast', 'ATP'],
        groupDynamics: {
          leadershipPattern: 'shared',
          conflictLevel: 'none'
        }
      };

      const tier2Insights: Tier2Insights = {
        argumentationQuality: 85,
        emotionalArc: {
          phases: ['engagement', 'discovery', 'synthesis'],
          overallSentiment: 'positive',
          emotionalPeaks: [],
          engagementTrend: 'improving'
        },
        collaborationPatterns: {
          leadershipDistribution: 'balanced',
          participationEquity: 0.85,
          supportiveInteractions: 8,
          buildingOnIdeas: 6
        },
        learningSignals: {
          conceptualBreakthroughs: 2,
          misconceptionsCorrected: 1,
          deepQuestioningOccurred: true,
          evidenceOfUnderstanding: ['synthesis', 'application']
        }
      };

      const prompts = await service.generatePrompts(tier1Insights, tier2Insights, mockContext);

      // High-performing group should get assessment or synthesis prompts
      expect(prompts.length).toBeGreaterThan(0);
      const assessmentPrompt = prompts.find(p => p.category === 'assessment');
      expect(assessmentPrompt).toBeDefined();
    });

    it('should respect subject-specific prompt generation', async () => {
      const mathContext: PromptGenerationContext = {
        ...mockContext,
        subject: 'mathematics',
        learningObjectives: ['Problem solving', 'Mathematical reasoning']
      };

      const tier1Insights: Tier1Insights = {
        topicalCohesion: 70,
        conceptualDensity: 60,
        engagementLevel: 'medium',
        collaborationQuality: 'fair',
        participationBalance: 0.6,
        offTopicIndicators: [],
        keyTermsUsed: ['equation', 'variable'],
        groupDynamics: {
          leadershipPattern: 'single',
          conflictLevel: 'low'
        }
      };

      const prompts = await service.generatePrompts(tier1Insights, null, mathContext);

      // Should generate math-specific prompts
      expect(prompts.length).toBeGreaterThan(0);
      const mathPrompt = prompts.find(p => 
        p.message.includes('solve') || 
        p.message.includes('strategy') || 
        p.message.includes('reasoning')
      );
      expect(mathPrompt).toBeDefined();
    });

    it('should adjust prompts based on session phase', async () => {
      const openingContext: PromptGenerationContext = {
        ...mockContext,
        sessionPhase: 'opening'
      };

      const tier1Insights: Tier1Insights = {
        topicalCohesion: 50,
        conceptualDensity: 30,
        engagementLevel: 'low',
        collaborationQuality: 'poor',
        participationBalance: 0.4,
        offTopicIndicators: [],
        keyTermsUsed: [],
        groupDynamics: {
          leadershipPattern: 'unclear',
          conflictLevel: 'none'
        }
      };

      const prompts = await service.generatePrompts(tier1Insights, null, openingContext);

      // Opening phase should focus on facilitation and energy
      const facilitationPrompt = prompts.find(p => p.category === 'facilitation');
      expect(facilitationPrompt).toBeDefined();
    });
  });

  describe('prioritizePrompts', () => {
    it('should prioritize prompts correctly', () => {
      const prompts = [
        service['createPrompt']({
          category: 'facilitation',
          priority: 'low',
          message: 'Low priority prompt',
          context: 'Context',
          suggestedTiming: 'immediate',
          sessionPhase: 'development',
          subject: 'science',
          sessionId: 'session1',
          teacherId: 'teacher1'
        }),
        service['createPrompt']({
          category: 'collaboration',
          priority: 'high',
          message: 'High priority prompt',
          context: 'Context',
          suggestedTiming: 'immediate',
          sessionPhase: 'development',
          subject: 'science',
          sessionId: 'session1',
          teacherId: 'teacher1'
        }),
        service['createPrompt']({
          category: 'deepening',
          priority: 'medium',
          message: 'Medium priority prompt',
          context: 'Context',
          suggestedTiming: 'immediate',
          sessionPhase: 'development',
          subject: 'science',
          sessionId: 'session1',
          teacherId: 'teacher1'
        })
      ];

      const sessionState = {
        recentPrompts: [],
        teacherResponseHistory: [],
        currentEngagementLevel: 'medium'
      };

      const prioritized = service.prioritizePrompts(prompts, sessionState);

      expect(prioritized[0].priority).toBe('high');
      expect(prioritized[1].priority).toBe('medium');
      expect(prioritized[2].priority).toBe('low');
    });

    it('should filter duplicate prompt categories', () => {
      const prompts = [
        service['createPrompt']({
          category: 'facilitation',
          priority: 'medium',
          message: 'First facilitation prompt',
          context: 'Context',
          suggestedTiming: 'immediate',
          sessionPhase: 'development',
          subject: 'science',
          sessionId: 'session1',
          teacherId: 'teacher1'
        }),
        service['createPrompt']({
          category: 'facilitation',
          priority: 'high',
          message: 'Second facilitation prompt',
          context: 'Context',
          suggestedTiming: 'immediate',
          sessionPhase: 'development',
          subject: 'science',
          sessionId: 'session1',
          teacherId: 'teacher1'
        })
      ];

      const sessionState = {
        recentPrompts: [],
        teacherResponseHistory: [],
        currentEngagementLevel: 'medium'
      };

      const prioritized = service.prioritizePrompts(prompts, sessionState);

      // Should only keep the higher priority prompt
      expect(prioritized).toHaveLength(1);
      expect(prioritized[0].priority).toBe('high');
    });
  });

  describe('filterPrompts', () => {
    it('should filter prompts based on teacher settings', () => {
      const prompts = [
        service['createPrompt']({
          category: 'facilitation',
          priority: 'medium',
          message: 'Facilitation prompt',
          context: 'Context',
          suggestedTiming: 'immediate',
          sessionPhase: 'development',
          subject: 'science',
          sessionId: 'session1',
          teacherId: 'teacher1'
        }),
        service['createPrompt']({
          category: 'assessment',
          priority: 'low',
          message: 'Assessment prompt',
          context: 'Context',
          suggestedTiming: 'immediate',
          sessionPhase: 'development',
          subject: 'science',
          sessionId: 'session1',
          teacherId: 'teacher1'
        })
      ];

      const teacherSettings = {
        maxPromptsPerSession: 10,
        enabledCategories: ['facilitation', 'deepening'],
        minimumPriority: 'medium',
        preferredTiming: ['immediate', 'natural_break'],
        disabledCategories: ['assessment']
      };

      const filtered = service.filterPrompts(prompts, teacherSettings);

      // Should only include facilitation prompt (assessment is disabled, low priority filtered out)
      expect(filtered).toHaveLength(1);
      expect(filtered[0].category).toBe('facilitation');
    });

    it('should respect maximum prompts limit', () => {
      const prompts = Array.from({ length: 5 }, (_, i) => 
        service['createPrompt']({
          category: 'facilitation',
          priority: 'medium',
          message: `Prompt ${i + 1}`,
          context: 'Context',
          suggestedTiming: 'immediate',
          sessionPhase: 'development',
          subject: 'science',
          sessionId: 'session1',
          teacherId: 'teacher1'
        })
      );

      const teacherSettings = {
        maxPromptsPerSession: 3,
        enabledCategories: ['facilitation'],
        minimumPriority: 'low',
        preferredTiming: ['immediate'],
        disabledCategories: []
      };

      const filtered = service.filterPrompts(prompts, teacherSettings);

      expect(filtered).toHaveLength(3);
    });
  });

  describe('effectiveness scoring', () => {
    it('should calculate effectiveness score based on category and priority', () => {
      const facilitation = service['calculateEffectivenessScore']('facilitation', 'high');
      const assessment = service['calculateEffectivenessScore']('assessment', 'low');

      expect(facilitation).toBeGreaterThan(assessment);
      expect(facilitation).toBeGreaterThanOrEqual(70);
      expect(facilitation).toBeLessThanOrEqual(100);
    });

    it('should prioritize certain categories higher', () => {
      const collaboration = service['calculateEffectivenessScore']('collaboration', 'medium');
      const clarity = service['calculateEffectivenessScore']('clarity', 'medium');

      // Collaboration should generally score higher than clarity
      expect(collaboration).toBeGreaterThanOrEqual(clarity);
    });
  });

  describe('error handling', () => {
    it('should handle null insights gracefully', async () => {
      const prompts = await service.generatePrompts(null, null, {
        sessionId: 'session1',
        teacherId: 'teacher1',
        sessionPhase: 'development',
        subject: 'science',
        learningObjectives: [],
        currentTime: new Date(),
        groupSize: 4,
        sessionDuration: 20
      });

      expect(prompts).toEqual([]);
    });

    it('should handle invalid context gracefully', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 80,
        conceptualDensity: 75,
        engagementLevel: 'high',
        collaborationQuality: 'good',
        participationBalance: 0.8,
        offTopicIndicators: [],
        keyTermsUsed: ['test'],
        groupDynamics: {
          leadershipPattern: 'shared',
          conflictLevel: 'none'
        }
      };

      await expect(service.generatePrompts(tier1Insights, null, null as any))
        .rejects.toThrow();
    });

    it('should handle missing required context fields', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 80,
        conceptualDensity: 75,
        engagementLevel: 'high',
        collaborationQuality: 'good',
        participationBalance: 0.8,
        offTopicIndicators: [],
        keyTermsUsed: ['test'],
        groupDynamics: {
          leadershipPattern: 'shared',
          conflictLevel: 'none'
        }
      };

      const incompleteContext = {
        sessionPhase: 'development',
        subject: 'science',
        // Missing required fields
      } as any;

      await expect(service.generatePrompts(tier1Insights, null, incompleteContext))
        .rejects.toThrow();
    });
  });

  describe('rate limiting', () => {
    it('should respect rate limiting for prompt generation', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 50, // Should trigger multiple prompts
        conceptualDensity: 50,
        engagementLevel: 'low',
        collaborationQuality: 'poor',
        participationBalance: 0.3,
        offTopicIndicators: ['distraction'],
        keyTermsUsed: [],
        groupDynamics: {
          leadershipPattern: 'dominated',
          conflictLevel: 'high'
        }
      };

      const context: PromptGenerationContext = {
        sessionId: 'session1',
        teacherId: 'teacher1',
        groupId: 'group1',
        sessionPhase: 'development',
        subject: 'science',
        learningObjectives: ['Test'],
        currentTime: new Date(),
        groupSize: 4,
        sessionDuration: 25
      };

      // Generate prompts multiple times quickly
      const prompts1 = await service.generatePrompts(tier1Insights, null, context);
      const prompts2 = await service.generatePrompts(tier1Insights, null, context);
      const prompts3 = await service.generatePrompts(tier1Insights, null, context);

      // Later calls should have fewer prompts due to rate limiting
      expect(prompts2.length).toBeLessThanOrEqual(prompts1.length);
      expect(prompts3.length).toBeLessThanOrEqual(prompts2.length);
    });
  });
});
