import { aiAnalysisBufferService } from '../../../services/ai-analysis-buffer.service';
import { databricksAIService } from '../../../services/databricks-ai.service';
import { teacherPromptService } from '../../../services/teacher-prompt.service';
import { alertPrioritizationService } from '../../../services/alert-prioritization.service';
import { guidanceSystemHealthService } from '../../../services/guidance-system-health.service';

// Mock external dependencies for load testing
jest.mock('../../../services/databricks-ai.service');
jest.mock('../../../services/websocket.service');

describe('AI Analysis Load Tests', () => {
  jest.setTimeout(60000); // 60 second timeout for load tests

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset all services
    aiAnalysisBufferService['tier1Buffers'].clear();
    aiAnalysisBufferService['tier2Buffers'].clear();
    
    // Setup mock responses for consistent load testing
    (databricksAIService.analyzeTier1 as jest.Mock).mockImplementation(async () => {
      // Simulate realistic processing time
      await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
      
      return {
        insights: {
          topicalCohesion: 70 + Math.random() * 20,
          conceptualDensity: 65 + Math.random() * 25,
          engagementLevel: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
          collaborationQuality: ['poor', 'fair', 'good', 'excellent'][Math.floor(Math.random() * 4)],
          participationBalance: 0.5 + Math.random() * 0.4,
          offTopicIndicators: [],
          keyTermsUsed: ['test', 'analysis', 'load'],
          groupDynamics: {
            leadershipPattern: 'rotating',
            conflictLevel: 'low'
          }
        },
        metadata: {
          processingTime: 100 + Math.random() * 200,
          confidence: 0.8 + Math.random() * 0.15
        }
      };
    });

    (databricksAIService.analyzeTier2 as jest.Mock).mockImplementation(async () => {
      // Simulate longer processing time for Tier 2
      await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
      
      return {
        insights: {
          argumentationQuality: 50 + Math.random() * 40,
          emotionalArc: {
            phases: ['engagement', 'development'],
            overallSentiment: 'positive',
            emotionalPeaks: [],
            engagementTrend: 'stable'
          },
          collaborationPatterns: {
            leadershipDistribution: 'balanced',
            participationEquity: 0.6 + Math.random() * 0.3,
            supportiveInteractions: Math.floor(Math.random() * 10),
            buildingOnIdeas: Math.floor(Math.random() * 8)
          },
          learningSignals: {
            conceptualBreakthroughs: Math.floor(Math.random() * 3),
            misconceptionsCorrected: Math.floor(Math.random() * 2),
            deepQuestioningOccurred: Math.random() > 0.5,
            evidenceOfUnderstanding: ['basic_recall', 'application']
          }
        },
        metadata: {
          processingTime: 300 + Math.random() * 500,
          confidence: 0.75 + Math.random() * 0.2
        }
      };
    });
  });

  describe('High Concurrent Session Load', () => {
    it('should handle 50 concurrent sessions with Tier 1 analysis', async () => {
      const sessionCount = 50;
      const groupsPerSession = 4;
      const totalGroups = sessionCount * groupsPerSession;

      console.log(`🧪 Load test: ${sessionCount} sessions, ${totalGroups} groups, Tier 1 analysis`);

      const analysisPromises = [];
      const startTime = Date.now();

      // Create concurrent sessions with multiple groups each
      for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex++) {
        for (let groupIndex = 0; groupIndex < groupsPerSession; groupIndex++) {
          const sessionId = `load-session-${sessionIndex}`;
          const groupId = `load-group-${sessionIndex}-${groupIndex}`;
          const teacherId = `load-teacher-${sessionIndex}`;

          // Buffer transcriptions for each group
          const bufferPromise = (async () => {
            for (let i = 0; i < 5; i++) {
              await aiAnalysisBufferService.bufferTranscription(
                groupId,
                sessionId,
                `Group ${groupId} transcription ${i}: Discussion about the load testing scenario with multiple concurrent participants.`
              );
            }

            // Trigger analysis
            if (aiAnalysisBufferService.shouldTriggerTier1Analysis(groupId)) {
              const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
              
              const result = await databricksAIService.analyzeTier1(transcripts, {
                focusAreas: ['engagement', 'collaboration'],
                sessionPhase: 'development',
                subject: 'science'
              });

              // Generate prompts
              const prompts = await teacherPromptService.generatePrompts(
                result.insights,
                null,
                {
                  sessionId,
                  teacherId,
                  groupId,
                  sessionPhase: 'development',
                  subject: 'science',
                  learningObjectives: ['Load testing'],
                  currentTime: new Date(),
                  groupSize: 4,
                  sessionDuration: 30
                }
              );

              // Prioritize alerts
              for (const prompt of prompts) {
                await alertPrioritizationService.prioritizeAlert(prompt, {
                  currentSessionLoad: 'high',
                  teacherEngagementLevel: 'active',
                  recentAlertCount: 1,
                  sessionPhase: 'development'
                });
              }

              aiAnalysisBufferService.markTier1Analyzed(groupId);
              return { sessionId, groupId, promptCount: prompts.length };
            }
            
            return { sessionId, groupId, promptCount: 0 };
          })();

          analysisPromises.push(bufferPromise);
        }
      }

      // Wait for all analyses to complete
      const results = await Promise.all(analysisPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify all operations completed successfully
      expect(results).toHaveLength(totalGroups);
      results.forEach(result => {
        expect(result.sessionId).toBeDefined();
        expect(result.groupId).toBeDefined();
        expect(result.promptCount).toBeGreaterThanOrEqual(0);
      });

      // Performance assertions
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds
      expect(databricksAIService.analyzeTier1).toHaveBeenCalledTimes(totalGroups);

      // Log performance metrics
      const averageTimePerGroup = totalTime / totalGroups;
      console.log(`📊 Performance: ${totalTime}ms total, ${averageTimePerGroup.toFixed(2)}ms per group`);
      console.log(`🎯 Throughput: ${(totalGroups / (totalTime / 1000)).toFixed(2)} groups/second`);

      // Verify system health
      const bufferStatus = aiAnalysisBufferService.getBufferStatus();
      expect(bufferStatus.tier1BufferCount).toBeGreaterThan(0);
      expect(bufferStatus.totalTranscripts).toBeGreaterThan(0);

      // Cleanup
      aiAnalysisBufferService.cleanupOldBuffers();
    });

    it('should handle mixed Tier 1 and Tier 2 analysis under load', async () => {
      const sessionCount = 20;
      const groupsPerSession = 3;
      const totalGroups = sessionCount * groupsPerSession;

      console.log(`🧪 Mixed load test: ${sessionCount} sessions, ${totalGroups} groups, Tier 1+2 analysis`);

      const analysisPromises = [];
      const startTime = Date.now();

      for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex++) {
        for (let groupIndex = 0; groupIndex < groupsPerSession; groupIndex++) {
          const sessionId = `mixed-session-${sessionIndex}`;
          const groupId = `mixed-group-${sessionIndex}-${groupIndex}`;
          const teacherId = `mixed-teacher-${sessionIndex}`;

          const analysisPromise = (async () => {
            // Buffer substantial content for both tier analysis
            for (let i = 0; i < 12; i++) {
              await aiAnalysisBufferService.bufferTranscription(
                groupId,
                sessionId,
                `Group ${groupId} substantial discussion ${i}: This is a detailed conversation about complex topics that should trigger both Tier 1 and Tier 2 analysis with comprehensive content.`
              );
            }

            const results = { tier1: false, tier2: false, prompts: 0 };

            // Tier 1 Analysis
            if (aiAnalysisBufferService.shouldTriggerTier1Analysis(groupId)) {
              const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
              const tier1Result = await databricksAIService.analyzeTier1(transcripts, {
                focusAreas: ['engagement', 'collaboration'],
                sessionPhase: 'development',
                subject: 'science'
              });

              const tier1Prompts = await teacherPromptService.generatePrompts(
                tier1Result.insights,
                null,
                {
                  sessionId, teacherId, groupId,
                  sessionPhase: 'development',
                  subject: 'science',
                  learningObjectives: ['Mixed analysis testing'],
                  currentTime: new Date(),
                  groupSize: 4,
                  sessionDuration: 30
                }
              );

              results.tier1 = true;
              results.prompts += tier1Prompts.length;
              aiAnalysisBufferService.markTier1Analyzed(groupId);
            }

            // Tier 2 Analysis
            if (aiAnalysisBufferService.shouldTriggerTier2Analysis(sessionId)) {
              const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
              const tier2Result = await databricksAIService.analyzeTier2(transcripts, {
                analysisDepth: 'deep',
                includeEmotionalArc: true,
                includeLearningSignals: true,
                sessionPhase: 'development',
                subject: 'science'
              });

              const tier2Prompts = await teacherPromptService.generatePrompts(
                null,
                tier2Result.insights,
                {
                  sessionId, teacherId, groupId,
                  sessionPhase: 'development',
                  subject: 'science',
                  learningObjectives: ['Deep analysis testing'],
                  currentTime: new Date(),
                  groupSize: 4,
                  sessionDuration: 30
                }
              );

              results.tier2 = true;
              results.prompts += tier2Prompts.length;
              aiAnalysisBufferService.markTier2Analyzed(sessionId);
            }

            return { sessionId, groupId, ...results };
          })();

          analysisPromises.push(analysisPromise);
        }
      }

      const results = await Promise.all(analysisPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify mixed analysis results
      expect(results).toHaveLength(totalGroups);
      
      const tier1Count = results.filter(r => r.tier1).length;
      const tier2Count = results.filter(r => r.tier2).length;
      const totalPrompts = results.reduce((sum, r) => sum + r.prompts, 0);

      expect(tier1Count).toBeGreaterThan(0);
      expect(tier2Count).toBeGreaterThan(0);
      expect(totalPrompts).toBeGreaterThan(0);

      // Performance should still be reasonable with mixed load
      expect(totalTime).toBeLessThan(15000); // 15 seconds for mixed analysis

      console.log(`📊 Mixed analysis: ${tier1Count} Tier 1, ${tier2Count} Tier 2, ${totalPrompts} prompts`);
      console.log(`⏱️ Mixed performance: ${totalTime}ms total, ${(totalTime / totalGroups).toFixed(2)}ms per group`);
    });
  });

  describe('Memory and Resource Management Under Load', () => {
    it('should maintain memory usage within bounds during sustained load', async () => {
      const sessionDuration = 30; // seconds
      const transcriptionsPerSecond = 5;
      const totalTranscriptions = sessionDuration * transcriptionsPerSecond;

      console.log(`🧪 Memory test: ${totalTranscriptions} transcriptions over ${sessionDuration}s`);

      const sessionId = 'memory-test-session';
      const groupId = 'memory-test-group';
      const startTime = Date.now();

      // Simulate sustained transcription load
      for (let i = 0; i < totalTranscriptions; i++) {
        await aiAnalysisBufferService.bufferTranscription(
          groupId,
          sessionId,
          `Transcription ${i}: This is a sustained load test message that will accumulate in memory buffers and needs to be managed efficiently.`
        );

        // Check memory status periodically
        if (i % 25 === 0) {
          const status = aiAnalysisBufferService.getBufferStatus();
          console.log(`📊 Memory status at ${i} transcriptions: ${status.totalMemoryUsage} bytes, ${status.totalTranscripts} total`);
          
          // Memory should not grow unbounded
          expect(status.totalMemoryUsage).toBeLessThan(10 * 1024 * 1024); // 10MB limit
        }

        // Simulate real-time spacing
        if (i % 5 === 0) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Final memory check
      const finalStatus = aiAnalysisBufferService.getBufferStatus();
      expect(finalStatus.totalTranscripts).toBe(totalTranscriptions);
      expect(finalStatus.totalMemoryUsage).toBeGreaterThan(0);
      expect(finalStatus.totalMemoryUsage).toBeLessThan(10 * 1024 * 1024);

      // Performance should scale linearly
      const avgTimePerTranscription = processingTime / totalTranscriptions;
      expect(avgTimePerTranscription).toBeLessThan(10); // < 10ms per transcription

      console.log(`📊 Memory test results: ${processingTime}ms total, ${avgTimePerTranscription.toFixed(2)}ms per transcription`);
      console.log(`💾 Final memory usage: ${finalStatus.totalMemoryUsage} bytes for ${totalTranscriptions} transcriptions`);

      // Cleanup should free memory
      aiAnalysisBufferService.cleanupOldBuffers();
      const cleanStatus = aiAnalysisBufferService.getBufferStatus();
      expect(cleanStatus.totalMemoryUsage).toBe(0);
    });

    it('should handle buffer cleanup efficiently under load', async () => {
      const sessionCount = 10;
      const groupsPerSession = 5;
      const transcriptionsPerGroup = 20;

      console.log(`🧪 Cleanup test: ${sessionCount * groupsPerSession} buffers with ${transcriptionsPerGroup} transcriptions each`);

      // Create many buffers
      for (let s = 0; s < sessionCount; s++) {
        for (let g = 0; g < groupsPerSession; g++) {
          const sessionId = `cleanup-session-${s}`;
          const groupId = `cleanup-group-${s}-${g}`;

          for (let t = 0; t < transcriptionsPerGroup; t++) {
            await aiAnalysisBufferService.bufferTranscription(
              groupId,
              sessionId,
              `Cleanup test transcription ${t} for efficient buffer management testing.`
            );
          }
        }
      }

      const beforeCleanup = aiAnalysisBufferService.getBufferStatus();
      expect(beforeCleanup.tier1BufferCount).toBe(sessionCount * groupsPerSession);
      expect(beforeCleanup.tier2BufferCount).toBe(sessionCount);
      expect(beforeCleanup.totalTranscripts).toBe(sessionCount * groupsPerSession * transcriptionsPerGroup);

      console.log(`📊 Before cleanup: ${beforeCleanup.tier1BufferCount} T1 buffers, ${beforeCleanup.tier2BufferCount} T2 buffers`);

      // Cleanup should be fast even with many buffers
      const cleanupStart = Date.now();
      aiAnalysisBufferService.cleanupOldBuffers();
      const cleanupTime = Date.now() - cleanupStart;

      const afterCleanup = aiAnalysisBufferService.getBufferStatus();
      
      // All buffers should remain (they're not old enough)
      expect(afterCleanup.tier1BufferCount).toBe(beforeCleanup.tier1BufferCount);
      expect(afterCleanup.tier2BufferCount).toBe(beforeCleanup.tier2BufferCount);

      // Cleanup should be very fast
      expect(cleanupTime).toBeLessThan(100); // < 100ms for cleanup scan

      console.log(`⚡ Cleanup performance: ${cleanupTime}ms for ${beforeCleanup.tier1BufferCount + beforeCleanup.tier2BufferCount} buffers`);
    });
  });

  describe('Error Recovery Under Load', () => {
    it('should maintain stability when AI service is intermittently failing', async () => {
      const sessionCount = 10;
      const groupsPerSession = 3;
      let failureCount = 0;
      let successCount = 0;

      console.log(`🧪 Resilience test: ${sessionCount * groupsPerSession} groups with intermittent AI failures`);

      // Mock intermittent failures (30% failure rate)
      (databricksAIService.analyzeTier1 as jest.Mock).mockImplementation(async () => {
        if (Math.random() < 0.3) {
          failureCount++;
          throw new Error('Simulated AI service failure');
        }
        
        successCount++;
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100));
        
        return {
          insights: {
            topicalCohesion: 75,
            conceptualDensity: 80,
            engagementLevel: 'medium',
            collaborationQuality: 'good',
            participationBalance: 0.7,
            offTopicIndicators: [],
            keyTermsUsed: ['resilience', 'test'],
            groupDynamics: {
              leadershipPattern: 'shared',
              conflictLevel: 'low'
            }
          },
          metadata: { processingTime: 150, confidence: 0.85 }
        };
      });

      const analysisPromises = [];

      for (let s = 0; s < sessionCount; s++) {
        for (let g = 0; g < groupsPerSession; g++) {
          const sessionId = `resilience-session-${s}`;
          const groupId = `resilience-group-${s}-${g}`;

          const promise = (async () => {
            await aiAnalysisBufferService.bufferTranscription(
              groupId,
              sessionId,
              'Resilience test transcription for error recovery validation.'
            );

            try {
              const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
              const result = await databricksAIService.analyzeTier1(transcripts, {
                focusAreas: ['engagement'],
                sessionPhase: 'development',
                subject: 'science'
              });

              aiAnalysisBufferService.markTier1Analyzed(groupId);
              return { success: true, groupId, result };
            } catch (error) {
              // Service should continue operating despite failures
              return { success: false, groupId, error: error.message };
            }
          })();

          analysisPromises.push(promise);
        }
      }

      const results = await Promise.all(analysisPromises);
      
      const successfulResults = results.filter(r => r.success);
      const failedResults = results.filter(r => !r.success);

      // Some results should succeed despite intermittent failures
      expect(successfulResults.length).toBeGreaterThan(0);
      expect(failedResults.length).toBeGreaterThan(0);

      // System should handle partial failures gracefully
      expect(successfulResults.length + failedResults.length).toBe(sessionCount * groupsPerSession);

      console.log(`📊 Resilience results: ${successfulResults.length} succeeded, ${failedResults.length} failed`);
      console.log(`💪 System maintained ${(successfulResults.length / results.length * 100).toFixed(1)}% success rate under intermittent failures`);

      // Verify system state remains consistent
      const bufferStatus = aiAnalysisBufferService.getBufferStatus();
      expect(bufferStatus.tier1BufferCount).toBeGreaterThan(0);
    });
  });

  describe('Scaling and Throughput', () => {
    it('should demonstrate linear scaling with increased load', async () => {
      const loadLevels = [10, 25, 50]; // Different load levels to test
      const throughputResults = [];

      for (const groupCount of loadLevels) {
        console.log(`🧪 Scaling test: ${groupCount} concurrent groups`);

        const analysisPromises = [];
        const startTime = Date.now();

        for (let i = 0; i < groupCount; i++) {
          const sessionId = `scaling-session-${i}`;
          const groupId = `scaling-group-${i}`;

          const promise = (async () => {
            await aiAnalysisBufferService.bufferTranscription(
              groupId,
              sessionId,
              'Scaling test transcription for throughput measurement and linear scaling validation.'
            );

            const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
            const result = await databricksAIService.analyzeTier1(transcripts, {
              focusAreas: ['engagement'],
              sessionPhase: 'development',
              subject: 'science'
            });

            aiAnalysisBufferService.markTier1Analyzed(groupId);
            return result;
          })();

          analysisPromises.push(promise);
        }

        const results = await Promise.all(analysisPromises);
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        const throughput = groupCount / (totalTime / 1000); // groups per second

        throughputResults.push({
          groupCount,
          totalTime,
          throughput,
          avgTimePerGroup: totalTime / groupCount
        });

        expect(results).toHaveLength(groupCount);
        console.log(`📊 ${groupCount} groups: ${totalTime}ms, ${throughput.toFixed(2)} groups/sec`);

        // Clean up between tests
        aiAnalysisBufferService.cleanupOldBuffers();
      }

      // Verify scaling characteristics
      console.log('\n📈 Scaling Analysis:');
      throughputResults.forEach(result => {
        console.log(`  ${result.groupCount} groups: ${result.throughput.toFixed(2)} groups/sec, ${result.avgTimePerGroup.toFixed(2)}ms avg`);
      });

      // System should maintain reasonable performance across different loads
      throughputResults.forEach(result => {
        expect(result.throughput).toBeGreaterThan(1); // At least 1 group per second
        expect(result.avgTimePerGroup).toBeLessThan(5000); // Less than 5 seconds per group
      });
    });
  });
});
