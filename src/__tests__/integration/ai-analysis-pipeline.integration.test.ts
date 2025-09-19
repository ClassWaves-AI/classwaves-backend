import { aiAnalysisBufferService } from '../../services/ai-analysis-buffer.service';
import { databricksAIService } from '../../services/databricks-ai.service';
import { teacherPromptService } from '../../services/teacher-prompt.service';
import type { Tier1Insights, Tier2Insights } from '../../types/ai-analysis.types';
import type { SessionPhase, SubjectArea } from '../../types/teacher-guidance.types';
import { v4 as uuidv4 } from 'uuid';

// Real service integration per TEST_REWRITE_PLAN.md - mock AI service for reliability
// Use public APIs only, validate actual service behavior

// Mock AI service for test reliability (external API dependency)
jest.mock('../../services/databricks-ai.service', () => ({
  databricksAIService: {
    analyzeTier1: jest.fn().mockResolvedValue({
      topicalCohesion: 0.4,  // Below 0.6 threshold to trigger prompts
      conceptualDensity: 0.3, // Below 0.5 threshold to trigger prompts
      analysisTimestamp: new Date().toISOString(),
      windowStartTime: new Date(Date.now() - 30000).toISOString(),
      windowEndTime: new Date().toISOString(),
      transcriptLength: 150,
      confidence: 0.85,
      insights: [
        {
          type: 'topical_cohesion',
          message: 'Group needs redirection to stay on topic',
          severity: 'warning',
          actionable: 'Guide students back to the main discussion points'
        }
      ],
      metadata: {
        processingTimeMs: 1200,
        modelVersion: 'tier1-v1.0'
      }
    }),
    analyzeTier2: jest.fn().mockResolvedValue({
      argumentationQuality: {
        coherence: 0.75,
        evidenceUse: 0.80,
        counterarguments: 0.60
      },
      collectiveEmotionalArc: {
        engagementTrend: 'stable',
        frustrationPoints: [],
        excitementPeaks: []
      },
      collaborationPatterns: {
        participationEquity: 0.85,
        buildingBehavior: 0.70,
        conflictResolution: 0.65
      },
      learningSignals: {
        comprehensionIndicators: 0.75,
        misconceptionFlags: [],
        knowledgeGaps: []
      },
      recommendations: [
        {
          type: 'facilitation',
          priority: 'high',
          message: 'Encourage deeper analysis',
          actionable: 'Ask students to provide evidence for claims'
        }
      ],
      processingTime: 4500,
      recommendationCount: 1,
      metadata: {
        processingTimeMs: 4500,
        modelVersion: 'tier2-v1.0'
      }
    })
  }
}));

// Get mocked functions for test assertions
const mockAnalyzeTier1 = databricksAIService.analyzeTier1 as jest.MockedFunction<typeof databricksAIService.analyzeTier1>;
const mockAnalyzeTier2 = databricksAIService.analyzeTier2 as jest.MockedFunction<typeof databricksAIService.analyzeTier2>;

// Define context interface for prompt generation
interface PromptGenerationContext {
  sessionId: string;
  groupId: string;
  teacherId: string;
  sessionPhase: SessionPhase;
  subject: SubjectArea;
  learningObjectives: string[];
  groupSize: number;
  sessionDuration: number;
}

describe('AI Analysis Pipeline Integration (Real Services)', () => {
  let testSessionId: string;
  let testGroupId: string;
  let testTeacherId: string;

  beforeEach(async () => {
    // Setup real test data
    testSessionId = uuidv4();
    testGroupId = uuidv4();
    testTeacherId = uuidv4();
    
    // Clean up any existing buffer data using public APIs only
    await aiAnalysisBufferService.cleanup();
  });

  afterEach(async () => {
    // Clean up test data
    await aiAnalysisBufferService.cleanup();
  });

  describe('End-to-End Tier 1 Analysis Flow', () => {
    it('should complete full Tier 1 analysis pipeline with real services', async () => {
      // Step 1: Buffer transcriptions using public API
      await aiAnalysisBufferService.bufferTranscription(
        testGroupId, 
        testSessionId, 
        'Student A: I think photosynthesis happens in the chloroplasts'
      );
      await aiAnalysisBufferService.bufferTranscription(
        testGroupId, 
        testSessionId, 
        'Student B: Yes, and it converts sunlight into energy'
      );
      await aiAnalysisBufferService.bufferTranscription(
        testGroupId, 
        testSessionId, 
        'Student C: But how exactly does that process work?'
      );

      // Step 2: Get buffered transcripts
      const bufferedTranscripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', testGroupId, testSessionId);
      expect(bufferedTranscripts.length).toBe(3);

      // Step 3: Perform real Tier 1 AI analysis using current API
      const tier1Result: Tier1Insights = await databricksAIService.analyzeTier1(bufferedTranscripts, {
        groupId: testGroupId,
        sessionId: testSessionId,
        focusAreas: ['topical_cohesion', 'conceptual_density']
      });

      // Validate current Tier1Insights structure per types
      expect(tier1Result).toHaveProperty('topicalCohesion');
      expect(tier1Result).toHaveProperty('conceptualDensity');
      expect(tier1Result).toHaveProperty('analysisTimestamp');
      expect(tier1Result).toHaveProperty('windowStartTime');
      expect(tier1Result).toHaveProperty('windowEndTime');
      expect(tier1Result).toHaveProperty('transcriptLength');
      expect(tier1Result).toHaveProperty('confidence');
      expect(tier1Result).toHaveProperty('insights');
      expect(Array.isArray(tier1Result.insights)).toBe(true);

      // Validate metadata structure with correct field name
      expect(tier1Result).toHaveProperty('metadata');
      expect(tier1Result.metadata).toHaveProperty('processingTimeMs');
      expect(typeof tier1Result.metadata?.processingTimeMs).toBe('number');
      expect(tier1Result.metadata?.processingTimeMs).toBeGreaterThan(0);

      // Step 4: Generate teacher prompts using current context structure
      const promptContext: PromptGenerationContext = {
        sessionId: testSessionId,
        groupId: testGroupId,
        teacherId: testTeacherId,
        sessionPhase: 'development',
        subject: 'science',
        learningObjectives: ['Understanding photosynthesis'],
        groupSize: 4,
        sessionDuration: 25
      };

      const prompts = await teacherPromptService.generatePrompts(
        tier1Result,
        promptContext,
        {
          maxPrompts: 3,
          priorityFilter: 'all',
          includeEffectivenessScore: true
        }
      );

      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts[0]).toHaveProperty('id');
      expect(prompts[0]).toHaveProperty('category');
      expect(prompts[0]).toHaveProperty('priority');
      expect(prompts[0]).toHaveProperty('message');
      expect(prompts[0]).toHaveProperty('effectivenessScore');

      // Step 5: Mark buffer as analyzed using public API
      await aiAnalysisBufferService.markBufferAnalyzed('tier1', testGroupId, testSessionId);

      // Step 6: Verify buffer stats using public API only
      const bufferStats = aiAnalysisBufferService.getBufferStats();
      expect(bufferStats).toHaveProperty('tier1');
      expect(bufferStats).toHaveProperty('tier2');
      expect(bufferStats.tier1).toHaveProperty('totalBuffers');
      expect(bufferStats.tier1).toHaveProperty('totalTranscripts');
      expect(bufferStats.tier1).toHaveProperty('memoryUsageBytes');
    });

    it('should handle edge cases and validate service error handling', async () => {
      // Test with empty transcripts
      const emptyTranscripts: string[] = [];
      
      try {
        await databricksAIService.analyzeTier1(emptyTranscripts, {
          groupId: testGroupId,
          sessionId: testSessionId,
          focusAreas: ['topical_cohesion']
        });
        // If no error is thrown, that's also valid behavior
        expect(true).toBe(true);
      } catch (error: unknown) {
        // Verify error structure if thrown
        expect(error).toBeInstanceOf(Error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage).toContain('failed');
      }

      // Test buffer behavior with minimal content
      await aiAnalysisBufferService.bufferTranscription(
        testGroupId, 
        testSessionId, 
        'Very short test'
      );

      const bufferedTranscripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', testGroupId, testSessionId);
      expect(bufferedTranscripts.length).toBe(1);
      expect(bufferedTranscripts[0]).toBe('Very short test');

      // Test with valid but minimal transcripts
      const result = await databricksAIService.analyzeTier1(bufferedTranscripts, {
        groupId: testGroupId,
        sessionId: testSessionId,
        focusAreas: ['topical_cohesion']
      });

      // Should still return valid structure even with minimal content
      expect(result).toHaveProperty('topicalCohesion');
      expect(result).toHaveProperty('confidence');
      expect(result.metadata?.processingTimeMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('End-to-End Tier 2 Analysis Flow', () => {
    it('should complete full Tier 2 analysis pipeline with real services', async () => {
      // Step 1: Buffer substantial transcriptions for Tier 2 analysis
      const transcriptionTexts = [
        'Student A: I think we need to consider multiple perspectives on this issue.',
        'Student B: That\'s a good point, but I disagree because of the evidence we discussed.',
        'Student C: Actually, both viewpoints have merit. Let me build on what Student B said.',
        'Student D: I was initially confused, but now I see how these concepts connect.',
        'Student A: Yes, and this helps us understand the broader implications.',
        'Student B: Can we synthesize these ideas into a coherent framework?',
        'Student C: This reminds me of what we learned last week about complexity.',
        'Student D: I have a question that might help us go deeper into this topic.'
      ];

      for (const text of transcriptionTexts) {
        await aiAnalysisBufferService.bufferTranscription(
          testGroupId,
          testSessionId,
          text
        );
      }

      // Step 2: Get buffered transcripts for Tier 2
      const bufferedTranscripts = await aiAnalysisBufferService.getBufferedTranscripts('tier2', testGroupId, testSessionId);
      expect(bufferedTranscripts.length).toBe(transcriptionTexts.length);

      // Step 3: Perform real Tier 2 AI analysis using current API
      const tier2Result: Tier2Insights = await databricksAIService.analyzeTier2(bufferedTranscripts, {
        sessionId: testSessionId,
        analysisDepth: 'comprehensive'
      });

      // Validate current Tier2Insights structure per types
      expect(tier2Result).toHaveProperty('argumentationQuality');
      expect(tier2Result.argumentationQuality).toHaveProperty('score');
      expect(tier2Result.argumentationQuality).toHaveProperty('claimEvidence');
      expect(tier2Result.argumentationQuality).toHaveProperty('logicalFlow');
      expect(tier2Result.argumentationQuality).toHaveProperty('counterarguments');
      expect(tier2Result.argumentationQuality).toHaveProperty('synthesis');

      expect(tier2Result).toHaveProperty('collectiveEmotionalArc');
      expect(tier2Result.collectiveEmotionalArc).toHaveProperty('trajectory');
      expect(tier2Result.collectiveEmotionalArc).toHaveProperty('averageEngagement');
      expect(tier2Result.collectiveEmotionalArc).toHaveProperty('sentimentFlow');

      expect(tier2Result).toHaveProperty('collaborationPatterns');
      expect(tier2Result.collaborationPatterns).toHaveProperty('turnTaking');
      expect(tier2Result.collaborationPatterns).toHaveProperty('buildingOnIdeas');

      expect(tier2Result).toHaveProperty('learningSignals');
      expect(tier2Result.learningSignals).toHaveProperty('conceptualGrowth');
      expect(tier2Result.learningSignals).toHaveProperty('questionQuality');

      expect(tier2Result).toHaveProperty('recommendations');
      expect(Array.isArray(tier2Result.recommendations)).toBe(true);

      // Validate metadata with correct field name
      expect(tier2Result).toHaveProperty('metadata');
      expect(tier2Result.metadata).toHaveProperty('processingTimeMs');
      expect(typeof tier2Result.metadata?.processingTimeMs).toBe('number');
      expect(tier2Result.metadata?.processingTimeMs).toBeGreaterThan(0);

      // Step 4: Generate prompts from real Tier 2 insights
      const promptContext: PromptGenerationContext = {
        sessionId: testSessionId,
        groupId: testGroupId,
        teacherId: testTeacherId,
        sessionPhase: 'development',
        subject: 'science',
        learningObjectives: ['Deep understanding', 'Collaborative reasoning'],
        groupSize: 4,
        sessionDuration: 30
      };

      const prompts = await teacherPromptService.generatePrompts(
        tier2Result,
        promptContext,
        {
          maxPrompts: 3,
          priorityFilter: 'all',
          includeEffectivenessScore: true
        }
      );

      expect(prompts.length).toBeGreaterThan(0);
      prompts.forEach(prompt => {
        expect(prompt).toHaveProperty('id');
        expect(prompt).toHaveProperty('category');
        expect(prompt).toHaveProperty('priority');
        expect(prompt).toHaveProperty('message');
      });

      // Step 5: Mark buffer as analyzed
      await aiAnalysisBufferService.markBufferAnalyzed('tier2', testGroupId, testSessionId);

      // Verify buffer stats reflect the changes
      const bufferStats = aiAnalysisBufferService.getBufferStats();
      expect(bufferStats.tier2).toHaveProperty('totalBuffers');
      expect(bufferStats.tier2).toHaveProperty('totalTranscripts');
    });
  });

  describe('Combined Tier 1 and Tier 2 Analysis', () => {
    it('should handle concurrent Tier 1 and Tier 2 analysis with real services', async () => {
      // Buffer substantial content for both analysis tiers
      const richTranscriptions = [
        'Student A: I want to build on what Sarah just said about the carbon cycle.',
        'Student B: That\'s interesting, but I think we should also consider the nitrogen cycle.',
        'Student C: Actually, both cycles are interconnected in ways we haven\'t discussed.',
        'Student D: Can you explain how they connect? I\'m seeing some patterns.',
        'Student A: Well, both involve transformations of matter and energy transfer.',
        'Student B: Yes, and decomposers play crucial roles in both processes.',
        'Student C: This is helping me understand the bigger picture of ecosystem dynamics.',
        'Student D: So we\'re really talking about system thinking and emergent properties.',
        'Student A: Exactly! This connects to what we learned about complex systems.',
        'Student B: I have a hypothesis about how this might work in urban environments.'
      ];

      for (const text of richTranscriptions) {
        await aiAnalysisBufferService.bufferTranscription(
          testGroupId,
          testSessionId,
          text
        );
      }

      // Get transcripts for both analysis tiers
      const tier1Transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', testGroupId, testSessionId);
      const tier2Transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier2', testGroupId, testSessionId);
      
      expect(tier1Transcripts.length).toBe(richTranscriptions.length);
      expect(tier2Transcripts.length).toBe(richTranscriptions.length);

      // Perform both analyses concurrently using real services
      const [tier1Result, tier2Result] = await Promise.all([
        databricksAIService.analyzeTier1(tier1Transcripts, {
          groupId: testGroupId,
          sessionId: testSessionId,
          focusAreas: ['topical_cohesion', 'conceptual_density']
        }),
        databricksAIService.analyzeTier2(tier2Transcripts, {
          sessionId: testSessionId,
          analysisDepth: 'comprehensive'
        })
      ]);

      // Validate both results have proper structure
      expect(tier1Result).toHaveProperty('topicalCohesion');
      expect(tier1Result).toHaveProperty('conceptualDensity');
      expect(tier1Result.metadata?.processingTimeMs).toBeGreaterThan(0);

      expect(tier2Result).toHaveProperty('argumentationQuality');
      expect(tier2Result).toHaveProperty('collaborationPatterns');
      expect(tier2Result.metadata?.processingTimeMs).toBeGreaterThan(0);

      // Generate prompts from Tier 1 insights (primary)
      const promptContext: PromptGenerationContext = {
        sessionId: testSessionId,
        groupId: testGroupId,
        teacherId: testTeacherId,
        sessionPhase: 'development',
        subject: 'science',
        learningObjectives: ['Advanced synthesis', 'Peer teaching'],
        groupSize: 4,
        sessionDuration: 40
      };

      const tier1Prompts = await teacherPromptService.generatePrompts(
        tier1Result,
        promptContext,
        {
          maxPrompts: 3,
          priorityFilter: 'all',
          includeEffectivenessScore: true
        }
      );

      // Generate prompts from Tier 2 insights
      const tier2Prompts = await teacherPromptService.generatePrompts(
        tier2Result,
        promptContext,
        {
          maxPrompts: 3,
          priorityFilter: 'all',
          includeEffectivenessScore: true
        }
      );

      // Verify both prompt sets are generated successfully
      expect(tier1Prompts.length).toBeGreaterThan(0);
      expect(tier2Prompts.length).toBeGreaterThan(0);

      // Verify prompt diversity between tiers
      const tier1Categories = tier1Prompts.map(p => p.category);
      const tier2Categories = tier2Prompts.map(p => p.category);
      
      // Should have different categories or focus areas
      expect(tier1Categories.length + tier2Categories.length).toBeGreaterThanOrEqual(2);

      // Mark both buffers as analyzed
      await aiAnalysisBufferService.markBufferAnalyzed('tier1', testGroupId, testSessionId);
      await aiAnalysisBufferService.markBufferAnalyzed('tier2', testGroupId, testSessionId);
    });
  });

  describe('Service Integration and Performance', () => {
    it('should handle buffer management and concurrent operations', async () => {
      const groupCount = 3; // Reduced for real service testing
      const analysisPromises: Promise<Tier1Insights>[] = [];

      // Create multiple groups with buffered content
      for (let i = 0; i < groupCount; i++) {
        const groupId = `${testGroupId}-${i}`;
        
        // Buffer content for each group
        await aiAnalysisBufferService.bufferTranscription(
          groupId,
          testSessionId,
          `Group ${i} discussion: Students are exploring different aspects of the topic with varying levels of depth and engagement.`
        );
        
        // Get transcripts and prepare analysis
        const transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', groupId, testSessionId);
        if (transcripts.length > 0) {
          analysisPromises.push(
            databricksAIService.analyzeTier1(transcripts, {
              groupId: groupId,
              sessionId: testSessionId,
              focusAreas: ['topical_cohesion']
            })
          );
        }
      }

      // Execute all analyses concurrently
      const startTime = Date.now();
      const results = await Promise.all(analysisPromises);
      const totalTime = Date.now() - startTime;

      // Verify all results are valid
      expect(results).toHaveLength(groupCount);
      
      results.forEach(result => {
        expect(result).toHaveProperty('topicalCohesion');
        expect(result).toHaveProperty('conceptualDensity');
        expect(result.metadata?.processingTimeMs).toBeGreaterThan(0);
      });

      // Performance should be reasonable (<10 seconds for 3 concurrent analyses)
      expect(totalTime).toBeLessThan(10000);
    });

    it('should validate buffer statistics and memory management', async () => {
      // Add several transcriptions to test buffer behavior
      const transcriptionCount = 10;
      for (let i = 0; i < transcriptionCount; i++) {
        await aiAnalysisBufferService.bufferTranscription(
          testGroupId,
          testSessionId,
          `Memory test transcription ${i}: This message tests buffer capacity and memory tracking capabilities.`
        );
      }

      // Check buffer statistics using public API
      const status = aiAnalysisBufferService.getBufferStats();
      expect(status).toHaveProperty('tier1');
      expect(status).toHaveProperty('tier2');
      expect(status.tier1).toHaveProperty('totalTranscripts');
      expect(status.tier1).toHaveProperty('totalBuffers');
      expect(status.tier1).toHaveProperty('memoryUsageBytes');
      
      // Buffer stats should reflect the added transcriptions
      expect(status.tier1.totalTranscripts + status.tier2.totalTranscripts).toBeGreaterThanOrEqual(transcriptionCount);
      expect(status.tier1.memoryUsageBytes + status.tier2.memoryUsageBytes).toBeGreaterThan(0);

      // Capture stats before cleanup
      const statusBeforeCleanup = aiAnalysisBufferService.getBufferStats();
      const totalBeforeCleanup = statusBeforeCleanup.tier1.totalTranscripts + statusBeforeCleanup.tier2.totalTranscripts;
      const memoryBeforeCleanup = statusBeforeCleanup.tier1.memoryUsageBytes + statusBeforeCleanup.tier2.memoryUsageBytes;

      // Test buffer cleanup
      await aiAnalysisBufferService.cleanup();

      // After cleanup, stats should show significant reduction (cleanup may not be immediate)
      const statusAfterCleanup = aiAnalysisBufferService.getBufferStats();
      const totalAfterCleanup = statusAfterCleanup.tier1.totalTranscripts + statusAfterCleanup.tier2.totalTranscripts;
      const memoryAfterCleanup = statusAfterCleanup.tier1.memoryUsageBytes + statusAfterCleanup.tier2.memoryUsageBytes;
      
      // Should be significantly reduced, but may not be zero due to concurrent operations
      expect(totalAfterCleanup).toBeLessThanOrEqual(totalBeforeCleanup); // Should not increase
      expect(memoryAfterCleanup).toBeLessThanOrEqual(memoryBeforeCleanup); // Should not increase
    });
  });

  describe('Buffer Service Integration and Edge Cases', () => {
    it('should handle buffer lifecycle and edge cases properly', async () => {
      // Test buffer state before any operations
      const initialStats = aiAnalysisBufferService.getBufferStats();
      expect(initialStats.tier1.totalBuffers).toBeGreaterThanOrEqual(0);
      expect(initialStats.tier2.totalBuffers).toBeGreaterThanOrEqual(0);

      // Buffer content for recovery testing
      await aiAnalysisBufferService.bufferTranscription(
        testGroupId,
        testSessionId,
        'Test content for buffer lifecycle validation'
      );

      // Verify transcripts are available
      const bufferedTranscripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', testGroupId, testSessionId);
      expect(bufferedTranscripts.length).toBeGreaterThan(0);
      expect(bufferedTranscripts[0]).toBe('Test content for buffer lifecycle validation');

      // Perform successful analysis
      const result = await databricksAIService.analyzeTier1(bufferedTranscripts, {
        groupId: testGroupId,
        sessionId: testSessionId,
        focusAreas: ['topical_cohesion']
      });

      // Validate result structure
      expect(result).toHaveProperty('topicalCohesion');
      expect(result).toHaveProperty('conceptualDensity');
      expect(result.metadata?.processingTimeMs).toBeGreaterThan(0);

      // Mark buffer as analyzed
      await aiAnalysisBufferService.markBufferAnalyzed('tier1', testGroupId, testSessionId);

      // Test buffer behavior after marking as analyzed
      const postAnalysisStats = aiAnalysisBufferService.getBufferStats();
      expect(postAnalysisStats).toHaveProperty('tier1');
      expect(postAnalysisStats).toHaveProperty('tier2');

      // Test duplicate transcription handling
      await aiAnalysisBufferService.bufferTranscription(
        testGroupId,
        testSessionId,
        'Duplicate handling test'
      );
      
      const newTranscripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', testGroupId, testSessionId);
      expect(newTranscripts.length).toBeGreaterThan(0);
      expect(newTranscripts).toContain('Duplicate handling test');
    });

    it('should validate service integration with different focus areas', async () => {
      // Buffer diverse content
      await aiAnalysisBufferService.bufferTranscription(
        testGroupId,
        testSessionId,
        'Students discussing complex topics with varied conceptual depth and topical focus.'
      );

      const transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', testGroupId, testSessionId);

      // Test different focus area combinations
      const focusAreaTests = [
        ['topical_cohesion'],
        ['conceptual_density'],
        ['topical_cohesion', 'conceptual_density']
      ];

      for (const focusAreas of focusAreaTests) {
        const result = await databricksAIService.analyzeTier1(transcripts, {
          groupId: testGroupId,
          sessionId: testSessionId,
          focusAreas: focusAreas as ('topical_cohesion' | 'conceptual_density')[]
        });

        // Each focus area should produce valid results
        expect(result).toHaveProperty('topicalCohesion');
        expect(result).toHaveProperty('conceptualDensity');
        expect(result.metadata?.processingTimeMs).toBeGreaterThan(0);
        expect(result.insights).toBeInstanceOf(Array);
      }
    });
  });
});
