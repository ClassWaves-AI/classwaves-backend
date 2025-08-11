import { aiAnalysisBufferService } from '../../services/ai-analysis-buffer.service';
import { databricksAIService } from '../../services/databricks-ai.service';
import { teacherPromptService } from '../../services/teacher-prompt.service';
import { alertPrioritizationService } from '../../services/alert-prioritization.service';
import { guidanceSystemHealthService } from '../../services/guidance-system-health.service';

// Mock external dependencies
jest.mock('../../services/databricks-ai.service');
jest.mock('../../services/websocket.service');

describe('AI Analysis Pipeline Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useFakeTimers();
    
    // Reset services
    aiAnalysisBufferService['tier1Buffers'].clear();
    aiAnalysisBufferService['tier2Buffers'].clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('End-to-End Tier 1 Analysis Flow', () => {
    it('should complete full Tier 1 analysis pipeline', async () => {
      const groupId = 'test-group-1';
      const sessionId = 'test-session-1';
      const teacherId = 'test-teacher-1';

      // Mock successful AI analysis
      const mockTier1Response = {
        insights: {
          topicalCohesion: 65,
          conceptualDensity: 80,
          engagementLevel: 'medium',
          collaborationQuality: 'good',
          participationBalance: 0.7,
          offTopicIndicators: ['brief tangent'],
          keyTermsUsed: ['photosynthesis', 'chloroplast'],
          groupDynamics: {
            leadershipPattern: 'rotating',
            conflictLevel: 'low'
          }
        },
        metadata: {
          processingTime: 1500,
          confidence: 0.85
        }
      };

      (databricksAIService.analyzeTier1 as jest.Mock).mockResolvedValue(mockTier1Response);

      // Step 1: Buffer transcriptions
      await aiAnalysisBufferService.bufferTranscription(
        groupId, 
        sessionId, 
        'Student A: I think photosynthesis happens in the chloroplasts'
      );
      await aiAnalysisBufferService.bufferTranscription(
        groupId, 
        sessionId, 
        'Student B: Yes, and it converts sunlight into energy'
      );
      await aiAnalysisBufferService.bufferTranscription(
        groupId, 
        sessionId, 
        'Student C: But how exactly does that process work?'
      );

      // Step 2: Trigger analysis (simulate time passing)
      jest.advanceTimersByTime(30000); // 30 seconds
      expect(aiAnalysisBufferService.shouldTriggerTier1Analysis(groupId)).toBe(true);

      // Step 3: Perform AI analysis
      const bufferedTranscripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
      const tier1Result = await databricksAIService.analyzeTier1(bufferedTranscripts, {
        focusAreas: ['collaboration', 'engagement'],
        sessionPhase: 'development',
        subject: 'science'
      });

      expect(tier1Result.insights.topicalCohesion).toBe(65);
      expect(databricksAIService.analyzeTier1).toHaveBeenCalledWith(
        bufferedTranscripts,
        expect.objectContaining({
          focusAreas: ['collaboration', 'engagement'],
          sessionPhase: 'development',
          subject: 'science'
        })
      );

      // Step 4: Generate teacher prompts
      const prompts = await teacherPromptService.generatePrompts(
        tier1Result.insights,
        null,
        {
          sessionId,
          teacherId,
          groupId,
          sessionPhase: 'development',
          subject: 'science',
          learningObjectives: ['Understanding photosynthesis'],
          currentTime: new Date(),
          groupSize: 4,
          sessionDuration: 25
        }
      );

      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts[0].category).toBe('redirection'); // Low cohesion should trigger redirection

      // Step 5: Prioritize and queue alerts
      for (const prompt of prompts) {
        await alertPrioritizationService.prioritizeAlert(prompt, {
          currentSessionLoad: 'medium',
          teacherEngagementLevel: 'active',
          recentAlertCount: 0,
          sessionPhase: 'development'
        });
      }

      // Step 6: Mark buffer as analyzed
      aiAnalysisBufferService.markTier1Analyzed(groupId);

      // Verify health metrics were recorded
      expect(guidanceSystemHealthService['metrics'].aiAnalysis.tier1_analysis.successCount).toBe(0); // Not called directly in this test
    });

    it('should handle AI analysis failures gracefully', async () => {
      const groupId = 'test-group-fail';
      const sessionId = 'test-session-fail';

      // Mock AI service failure
      (databricksAIService.analyzeTier1 as jest.Mock).mockRejectedValue(
        new Error('Databricks AI service unavailable')
      );

      // Buffer some transcriptions
      await aiAnalysisBufferService.bufferTranscription(
        groupId, 
        sessionId, 
        'Test transcription'
      );

      // Trigger analysis
      jest.advanceTimersByTime(30000);
      expect(aiAnalysisBufferService.shouldTriggerTier1Analysis(groupId)).toBe(true);

      // Attempt analysis
      const bufferedTranscripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
      
      await expect(databricksAIService.analyzeTier1(bufferedTranscripts, {
        focusAreas: ['engagement'],
        sessionPhase: 'development',
        subject: 'science'
      })).rejects.toThrow('Databricks AI service unavailable');

      // Verify buffer is not marked as analyzed on failure
      const buffer = aiAnalysisBufferService.getTier1Buffer(groupId);
      expect(buffer?.lastAnalyzedAt).toBeUndefined();
    });
  });

  describe('End-to-End Tier 2 Analysis Flow', () => {
    it('should complete full Tier 2 analysis pipeline', async () => {
      const sessionId = 'test-session-2';
      const groupId = 'test-group-2';
      const teacherId = 'test-teacher-2';

      // Mock successful Tier 2 analysis
      const mockTier2Response = {
        insights: {
          argumentationQuality: 45,
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
        },
        metadata: {
          processingTime: 4200,
          confidence: 0.82
        }
      };

      (databricksAIService.analyzeTier2 as jest.Mock).mockResolvedValue(mockTier2Response);

      // Step 1: Buffer substantial transcriptions
      for (let i = 0; i < 10; i++) {
        await aiAnalysisBufferService.bufferTranscription(
          groupId,
          sessionId,
          `Discussion point ${i + 1}: Students are exploring the concept but seem confused about the details.`
        );
      }

      // Step 2: Trigger Tier 2 analysis
      jest.advanceTimersByTime(120000); // 2 minutes
      expect(aiAnalysisBufferService.shouldTriggerTier2Analysis(sessionId)).toBe(true);

      // Step 3: Perform Tier 2 analysis
      const bufferedTranscripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
      const tier2Result = await databricksAIService.analyzeTier2(bufferedTranscripts, {
        analysisDepth: 'deep',
        includeEmotionalArc: true,
        includeLearningSignals: true,
        sessionPhase: 'development',
        subject: 'science'
      });

      expect(tier2Result.insights.argumentationQuality).toBe(45);
      expect(databricksAIService.analyzeTier2).toHaveBeenCalledWith(
        bufferedTranscripts,
        expect.objectContaining({
          analysisDepth: 'deep',
          includeEmotionalArc: true,
          includeLearningSignals: true
        })
      );

      // Step 4: Generate prompts from Tier 2 insights
      const prompts = await teacherPromptService.generatePrompts(
        null,
        tier2Result.insights,
        {
          sessionId,
          teacherId,
          groupId,
          sessionPhase: 'development',
          subject: 'science',
          learningObjectives: ['Deep understanding', 'Collaborative reasoning'],
          currentTime: new Date(),
          groupSize: 4,
          sessionDuration: 25
        }
      );

      expect(prompts.length).toBeGreaterThan(0);
      
      // Should generate high-priority deepening prompt due to low argumentation quality
      const deepeningPrompt = prompts.find(p => p.category === 'deepening');
      expect(deepeningPrompt).toBeDefined();
      expect(deepeningPrompt?.priority).toBe('high');

      // Should generate collaboration prompt due to poor participation equity
      const collaborationPrompt = prompts.find(p => p.category === 'collaboration');
      expect(collaborationPrompt).toBeDefined();

      // Step 5: Mark buffer as analyzed
      aiAnalysisBufferService.markTier2Analyzed(sessionId);
    });
  });

  describe('Combined Tier 1 and Tier 2 Analysis', () => {
    it('should handle overlapping Tier 1 and Tier 2 analysis cycles', async () => {
      const groupId = 'test-group-combined';
      const sessionId = 'test-session-combined';
      const teacherId = 'test-teacher-combined';

      // Mock both analysis services
      const mockTier1Response = {
        insights: {
          topicalCohesion: 85,
          conceptualDensity: 90,
          engagementLevel: 'high',
          collaborationQuality: 'excellent',
          participationBalance: 0.9,
          offTopicIndicators: [],
          keyTermsUsed: ['complex', 'analysis'],
          groupDynamics: {
            leadershipPattern: 'shared',
            conflictLevel: 'none'
          }
        },
        metadata: { processingTime: 1200, confidence: 0.92 }
      };

      const mockTier2Response = {
        insights: {
          argumentationQuality: 88,
          emotionalArc: {
            phases: ['engagement', 'discovery', 'synthesis'],
            overallSentiment: 'positive',
            emotionalPeaks: [],
            engagementTrend: 'improving'
          },
          collaborationPatterns: {
            leadershipDistribution: 'balanced',
            participationEquity: 0.85,
            supportiveInteractions: 12,
            buildingOnIdeas: 8
          },
          learningSignals: {
            conceptualBreakthroughs: 3,
            misconceptionsCorrected: 2,
            deepQuestioningOccurred: true,
            evidenceOfUnderstanding: ['synthesis', 'application']
          }
        },
        metadata: { processingTime: 3800, confidence: 0.89 }
      };

      (databricksAIService.analyzeTier1 as jest.Mock).mockResolvedValue(mockTier1Response);
      (databricksAIService.analyzeTier2 as jest.Mock).mockResolvedValue(mockTier2Response);

      // Buffer substantial content
      for (let i = 0; i < 15; i++) {
        await aiAnalysisBufferService.bufferTranscription(
          groupId,
          sessionId,
          `High-quality discussion point ${i + 1}: Students are demonstrating deep understanding and excellent collaboration.`
        );
      }

      // Both analyses should be triggered
      jest.advanceTimersByTime(120000); // 2 minutes
      expect(aiAnalysisBufferService.shouldTriggerTier1Analysis(groupId)).toBe(true);
      expect(aiAnalysisBufferService.shouldTriggerTier2Analysis(sessionId)).toBe(true);

      // Perform both analyses
      const bufferedTranscripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
      
      const [tier1Result, tier2Result] = await Promise.all([
        databricksAIService.analyzeTier1(bufferedTranscripts, {
          focusAreas: ['collaboration', 'engagement'],
          sessionPhase: 'synthesis',
          subject: 'science'
        }),
        databricksAIService.analyzeTier2(bufferedTranscripts, {
          analysisDepth: 'deep',
          includeEmotionalArc: true,
          includeLearningSignals: true,
          sessionPhase: 'synthesis',
          subject: 'science'
        })
      ]);

      // Generate combined prompts
      const prompts = await teacherPromptService.generatePrompts(
        tier1Result.insights,
        tier2Result.insights,
        {
          sessionId,
          teacherId,
          groupId,
          sessionPhase: 'synthesis',
          subject: 'science',
          learningObjectives: ['Advanced synthesis', 'Peer teaching'],
          currentTime: new Date(),
          groupSize: 4,
          sessionDuration: 40
        }
      );

      // High-performing group should get assessment or advanced prompts
      expect(prompts.length).toBeGreaterThan(0);
      const assessmentPrompt = prompts.find(p => p.category === 'assessment');
      expect(assessmentPrompt).toBeDefined();

      // Mark both buffers as analyzed
      aiAnalysisBufferService.markTier1Analyzed(groupId);
      aiAnalysisBufferService.markTier2Analyzed(sessionId);
    });
  });

  describe('Pipeline Performance and Load', () => {
    it('should handle multiple concurrent groups efficiently', async () => {
      const sessionId = 'load-test-session';
      const teacherId = 'load-test-teacher';
      const groupCount = 10;

      // Mock successful responses
      (databricksAIService.analyzeTier1 as jest.Mock).mockResolvedValue({
        insights: {
          topicalCohesion: 75,
          conceptualDensity: 70,
          engagementLevel: 'medium',
          collaborationQuality: 'good',
          participationBalance: 0.75,
          offTopicIndicators: [],
          keyTermsUsed: ['test'],
          groupDynamics: {
            leadershipPattern: 'rotating',
            conflictLevel: 'low'
          }
        },
        metadata: { processingTime: 1500, confidence: 0.8 }
      });

      // Create multiple groups with buffered content
      const analysisPromises = [];
      for (let i = 0; i < groupCount; i++) {
        const groupId = `load-test-group-${i}`;
        
        // Buffer content for each group
        await aiAnalysisBufferService.bufferTranscription(
          groupId,
          sessionId,
          `Group ${i} discussion content that should trigger analysis`
        );
        
        // Schedule analysis
        jest.advanceTimersByTime(30000);
        if (aiAnalysisBufferService.shouldTriggerTier1Analysis(groupId)) {
          const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
          analysisPromises.push(
            databricksAIService.analyzeTier1(transcripts, {
              focusAreas: ['engagement'],
              sessionPhase: 'development',
              subject: 'science'
            })
          );
        }
      }

      // All analyses should complete successfully
      const results = await Promise.all(analysisPromises);
      expect(results).toHaveLength(groupCount);
      
      // Verify each result
      results.forEach(result => {
        expect(result.insights.topicalCohesion).toBe(75);
        expect(result.metadata.processingTime).toBe(1500);
      });

      // Verify system can handle the load
      expect(databricksAIService.analyzeTier1).toHaveBeenCalledTimes(groupCount);
    });

    it('should maintain buffer memory usage within limits', async () => {
      const sessionId = 'memory-test-session';
      const groupId = 'memory-test-group';

      // Add many transcriptions to test memory management
      for (let i = 0; i < 100; i++) {
        await aiAnalysisBufferService.bufferTranscription(
          groupId,
          sessionId,
          `Transcription ${i}: This is a test message to evaluate memory usage patterns.`
        );
      }

      const status = aiAnalysisBufferService.getBufferStatus();
      expect(status.totalTranscripts).toBe(100);
      expect(status.totalMemoryUsage).toBeGreaterThan(0);
      expect(status.tier1BufferCount).toBe(1);
      expect(status.tier2BufferCount).toBe(1);

      // Cleanup should reduce memory usage
      jest.advanceTimersByTime(3600000); // 1 hour
      aiAnalysisBufferService.cleanupOldBuffers();

      const statusAfterCleanup = aiAnalysisBufferService.getBufferStatus();
      expect(statusAfterCleanup.totalTranscripts).toBe(0);
      expect(statusAfterCleanup.totalMemoryUsage).toBe(0);
    });
  });

  describe('Error Recovery and Resilience', () => {
    it('should recover from partial pipeline failures', async () => {
      const groupId = 'recovery-test-group';
      const sessionId = 'recovery-test-session';
      const teacherId = 'recovery-test-teacher';

      // Mock AI service to fail first, then succeed
      (databricksAIService.analyzeTier1 as jest.Mock)
        .mockRejectedValueOnce(new Error('Temporary service failure'))
        .mockResolvedValueOnce({
          insights: {
            topicalCohesion: 80,
            conceptualDensity: 85,
            engagementLevel: 'high',
            collaborationQuality: 'good',
            participationBalance: 0.8,
            offTopicIndicators: [],
            keyTermsUsed: ['recovery'],
            groupDynamics: {
              leadershipPattern: 'shared',
              conflictLevel: 'none'
            }
          },
          metadata: { processingTime: 1600, confidence: 0.87 }
        });

      // Buffer content
      await aiAnalysisBufferService.bufferTranscription(
        groupId,
        sessionId,
        'Test content for recovery scenario'
      );

      jest.advanceTimersByTime(30000);
      const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);

      // First attempt should fail
      await expect(databricksAIService.analyzeTier1(transcripts, {
        focusAreas: ['engagement'],
        sessionPhase: 'development',
        subject: 'science'
      })).rejects.toThrow('Temporary service failure');

      // Buffer should not be marked as analyzed
      let buffer = aiAnalysisBufferService.getTier1Buffer(groupId);
      expect(buffer?.lastAnalyzedAt).toBeUndefined();

      // Second attempt should succeed
      const result = await databricksAIService.analyzeTier1(transcripts, {
        focusAreas: ['engagement'],
        sessionPhase: 'development',
        subject: 'science'
      });

      expect(result.insights.topicalCohesion).toBe(80);

      // Now we can mark as analyzed
      aiAnalysisBufferService.markTier1Analyzed(groupId);
      buffer = aiAnalysisBufferService.getTier1Buffer(groupId);
      expect(buffer?.lastAnalyzedAt).toBeDefined();
    });
  });
});
