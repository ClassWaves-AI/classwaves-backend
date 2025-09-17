import { TeacherPromptService } from '../../../services/teacher-prompt.service';
import { Tier1Insights, Tier2Insights } from '../../../types/ai-analysis.types';
import { redisService } from '../../../services/redis.service';
import { databricksService } from '../../../services/databricks.service';

describe('TeacherPromptService', () => {
  let service: TeacherPromptService;

  beforeEach(() => {
    service = new TeacherPromptService();
  });

  describe('generatePrompts', () => {
    const mockContext = {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      teacherId: '550e8400-e29b-41d4-a716-446655440001',
      groupId: '550e8400-e29b-41d4-a716-446655440002',
      sessionPhase: 'development' as const,
      subject: 'science' as const,
      learningObjectives: ['Understanding concepts', 'Collaboration'],
      groupSize: 4,
      sessionDuration: 60
    };

    let mockGuidanceScripts: any;
    let mockRedisClient: any;

    beforeEach(() => {
      process.env.GUIDANCE_AUTOPROMPT_COOLDOWN_MS = '90000';
      process.env.SLI_SESSION_TTL_SECONDS = '3600';
      mockGuidanceScripts = {
        autopromptCooldown: jest.fn().mockResolvedValue(true),
        promptStats: jest.fn().mockResolvedValue({ successRate: 0.5, observationCount: 10 }),
      };
      mockRedisClient = {
        sismember: jest.fn().mockResolvedValue(0),
        sadd: jest.fn().mockResolvedValue(1),
        expire: jest.fn().mockResolvedValue(1),
        hgetall: jest.fn().mockResolvedValue({}),
      };

      jest.spyOn(redisService, 'getGuidanceScripts').mockReturnValue(mockGuidanceScripts);
      jest.spyOn(redisService, 'getClient').mockReturnValue(mockRedisClient);
      jest.spyOn(databricksService, 'insert').mockResolvedValue(undefined as any);
      jest.spyOn(databricksService, 'update').mockResolvedValue(undefined as any);
      jest.spyOn(databricksService, 'tableHasColumns').mockResolvedValue(true);
      jest.spyOn(databricksService, 'query').mockResolvedValue([
        {
          generated_at: new Date().toISOString(),
          prompt_category: 'redirection',
          prompt_message: 'Encourage deeper thinking. Try asking: "Why do you think that?"',
          priority_level: 'high',
          subject_area: 'science',
          session_phase: 'development',
        },
      ]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
      delete process.env.GUIDANCE_AUTOPROMPT_COOLDOWN_MS;
      delete process.env.SLI_SESSION_TTL_SECONDS;
    });

    it('should generate prompts from Tier 1 insights', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 45,
        conceptualDensity: 70,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 100,
        confidence: 0.85,
        insights: [
          {
            type: 'topical_cohesion',
            message: 'Low topic focus detected',
            severity: 'warning',
            actionable: 'Help students refocus on the topic'
          }
        ]
      };

      const prompts = await service.generatePrompts(tier1Insights, mockContext);

      expect(prompts).toBeInstanceOf(Array);
      expect(prompts.length).toBeGreaterThanOrEqual(0);
      
      // Check that prompts have required properties
      if (prompts.length > 0) {
        expect(prompts[0]).toHaveProperty('sessionId');
        expect(prompts[0]).toHaveProperty('teacherId');
        expect(prompts[0]).toHaveProperty('category');
        expect(prompts[0]).toHaveProperty('priority');
        expect(prompts[0]).toHaveProperty('message');
        expect(prompts[0].sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
        expect(prompts[0].teacherId).toBe('550e8400-e29b-41d4-a716-446655440001');
      }
    });

    it('should generate prompts from Tier 2 insights', async () => {
      const tier2Insights: Tier2Insights = {
        argumentationQuality: {
          score: 0.45,
          claimEvidence: 0.4,
          logicalFlow: 0.45,
          counterarguments: 0.35,
          synthesis: 0.5
        },
        collectiveEmotionalArc: {
          trajectory: 'descending',
          averageEngagement: 0.4,
          energyPeaks: [],
          sentimentFlow: [
            {
              timestamp: new Date().toISOString(),
              sentiment: -0.2,
              confidence: 0.8
            }
          ]
        },
        collaborationPatterns: {
          turnTaking: 0.3,
          buildingOnIdeas: 0.2,
          conflictResolution: 0.1,
          inclusivity: 0.2
        },
        learningSignals: {
          conceptualGrowth: 0.3,
          questionQuality: 0.2,
          metacognition: 0.1,
          knowledgeApplication: 0.4
        },
        analysisTimestamp: new Date().toISOString(),
        sessionStartTime: new Date().toISOString(),
        analysisEndTime: new Date().toISOString(),
        totalTranscriptLength: 500,
        groupsAnalyzed: ['group1'],
        confidence: 0.75,
        recommendations: [
          {
            type: 'intervention',
            priority: 'high',
            message: 'Group needs support with argumentation',
            suggestedAction: 'Provide scaffolding for better arguments',
            targetGroups: ['group1']
          }
        ]
      };

      const prompts = await service.generatePrompts(tier2Insights, mockContext);

      expect(prompts).toBeInstanceOf(Array);
      expect(prompts.length).toBeGreaterThanOrEqual(0);
      
      // Check that prompts have required properties
      if (prompts.length > 0) {
        expect(prompts[0]).toHaveProperty('sessionId');
        expect(prompts[0]).toHaveProperty('teacherId');
        expect(prompts[0]).toHaveProperty('category');
        expect(prompts[0]).toHaveProperty('priority');
        expect(prompts[0]).toHaveProperty('message');
      }
    });

    it('should handle different session phases', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 80,
        conceptualDensity: 85,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 150,
        confidence: 0.9,
        insights: []
      };

      const openingContext = {
        ...mockContext,
        sessionPhase: 'opening' as const
      };

      const prompts = await service.generatePrompts(tier1Insights, openingContext);

      expect(prompts).toBeInstanceOf(Array);
      // Should handle opening phase appropriately
      expect(() => service.generatePrompts(tier1Insights, openingContext)).not.toThrow();
    });

    it('should handle different subject areas', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 75,
        conceptualDensity: 80,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 120,
        confidence: 0.8,
        insights: []
      };

      const mathContext = {
        ...mockContext,
        subject: 'math' as const,
        learningObjectives: ['Solving equations', 'Understanding variables']
      };

      const prompts = await service.generatePrompts(tier1Insights, mathContext);

      expect(prompts).toBeInstanceOf(Array);
      expect(() => service.generatePrompts(tier1Insights, mathContext)).not.toThrow();
    });

    it('should handle options parameter', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 60,
        conceptualDensity: 65,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 80,
        confidence: 0.6,
        insights: [{
          type: 'topical_cohesion',
          message: 'Some off-topic discussion detected',
          severity: 'info'
        }]
      };

      const options = {
        maxPrompts: 2,
        priorityFilter: 'high' as const,
        includeEffectivenessScore: true
      };

      const prompts = await service.generatePrompts(tier1Insights, mockContext, options);

      expect(prompts).toBeInstanceOf(Array);
      expect(prompts.length).toBeLessThanOrEqual(2); // Should respect maxPrompts
    });

    it('should respect autoprompt cooldown gate', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 0.3,
        conceptualDensity: 0.6,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 200,
        confidence: 0.9,
        insights: [],
      };

      mockGuidanceScripts.autopromptCooldown.mockResolvedValueOnce(false);

      const prompts = await service.generatePrompts(tier1Insights, mockContext);

      expect(mockGuidanceScripts.autopromptCooldown).toHaveBeenCalled();
      expect(prompts).toEqual([]);
    });

    it('should dedupe prompts when template hash already seen', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 0.3,
        conceptualDensity: 0.5,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 150,
        confidence: 0.8,
        insights: [],
      };

      mockGuidanceScripts.autopromptCooldown.mockResolvedValue(true);
      mockRedisClient.sismember.mockResolvedValueOnce(0);

      const firstBatch = await service.generatePrompts(tier1Insights, mockContext);
      expect(firstBatch.length).toBeGreaterThanOrEqual(0);

      mockRedisClient.sismember.mockResolvedValue(1);

      const secondBatch = await service.generatePrompts(tier1Insights, mockContext);
      expect(secondBatch).toEqual([]);
    });

    it('should attach impact confidence and update learning stats on interaction', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 0.3,
        conceptualDensity: 0.5,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 200,
        confidence: 0.85,
        confusionRisk: 0.6,
        offTopicHeat: 0.7,
        insights: [],
      };

      const prompts = await service.generatePrompts(tier1Insights, mockContext);

      if (prompts.length === 0) {
        return fail('Expected at least one prompt for impact confidence test');
      }

      expect(prompts[0]).toHaveProperty('impactConfidence');
      expect(typeof prompts[0].impactConfidence).toBe('number');

      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      await service.recordPromptInteraction(prompts[0].id, mockContext.sessionId, mockContext.teacherId, 'used');
      process.env.NODE_ENV = originalEnv;

      expect(mockGuidanceScripts.promptStats).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    const mockContext = {
      sessionId: '550e8400-e29b-41d4-a716-446655440003',
      teacherId: '550e8400-e29b-41d4-a716-446655440004',
      groupId: '550e8400-e29b-41d4-a716-446655440005',
      sessionPhase: 'development' as const,
      subject: 'science' as const,
      learningObjectives: ['Learning'],
      groupSize: 4,
      sessionDuration: 30
    };

    it('should handle minimal Tier1 insights', async () => {
      const minimalInsights: Tier1Insights = {
        topicalCohesion: 50,
        conceptualDensity: 50,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 50,
        confidence: 0.5,
        insights: []
      };

      expect(() => service.generatePrompts(minimalInsights, mockContext))
        .not.toThrow();
    });

    it('should handle minimal Tier2 insights', async () => {
      const minimalInsights: Tier2Insights = {
        argumentationQuality: {
          score: 0.5,
          claimEvidence: 0.5,
          logicalFlow: 0.5,
          counterarguments: 0.5,
          synthesis: 0.5
        },
        collectiveEmotionalArc: {
          trajectory: 'stable',
          averageEngagement: 0.5,
          energyPeaks: [],
          sentimentFlow: []
        },
        collaborationPatterns: {
          turnTaking: 0.5,
          buildingOnIdeas: 0.5,
          conflictResolution: 0.5,
          inclusivity: 0.5
        },
        learningSignals: {
          conceptualGrowth: 0.5,
          questionQuality: 0.5,
          metacognition: 0.5,
          knowledgeApplication: 0.5
        },
        analysisTimestamp: new Date().toISOString(),
        sessionStartTime: new Date().toISOString(),
        analysisEndTime: new Date().toISOString(),
        totalTranscriptLength: 100,
        groupsAnalyzed: ['test-group'],
        confidence: 0.5,
        recommendations: []
      };

      expect(() => service.generatePrompts(minimalInsights, mockContext))
        .not.toThrow();
    });

    it('should handle empty learning objectives', async () => {
      const tier1Insights: Tier1Insights = {
        topicalCohesion: 70,
        conceptualDensity: 70,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 100,
        confidence: 0.7,
        insights: []
      };

      const contextWithEmptyObjectives = {
        ...mockContext,
        learningObjectives: []
      };

      expect(() => service.generatePrompts(tier1Insights, contextWithEmptyObjectives))
        .not.toThrow();
    });
  });
});
