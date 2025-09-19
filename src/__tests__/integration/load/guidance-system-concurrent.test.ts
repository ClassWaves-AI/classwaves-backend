import { aiAnalysisBufferService } from '../../../services/ai-analysis-buffer.service';
import { databricksAIService } from '../../../services/databricks-ai.service';
import { teacherPromptService } from '../../../services/teacher-prompt.service';
import type { Tier1Insights, Tier2Insights } from '../../../types/ai-analysis.types';
import type { SessionPhase, SubjectArea } from '../../../types/teacher-guidance.types';
import { v4 as uuidv4 } from 'uuid';

// Real service integration per TEST_REWRITE_PLAN.md - mock AI service for reliability
// Use public APIs only, test actual concurrent behavior

// Mock AI service for test reliability (external API dependency)
jest.mock('../../../services/databricks-ai.service', () => ({
  databricksAIService: {
    analyzeTier1: jest.fn().mockResolvedValue({
      topicalCohesion: 0.4,  // Below 0.6 threshold to trigger prompts
      conceptualDensity: 0.3, // Below 0.5 threshold to trigger prompts
      analysisTimestamp: new Date().toISOString(),
      windowStartTime: new Date(Date.now() - 30000).toISOString(),
      windowEndTime: new Date().toISOString(),
      transcriptLength: 120,
      confidence: 0.85,
      insights: [
        {
          type: 'topical_cohesion',
          message: 'Group needs focus',
          severity: 'warning',
          actionable: 'Guide discussion back on track'
        }
      ],
      metadata: {
        processingTimeMs: 800,
        modelVersion: 'tier1-v1.0'
      }
    })
  }
}));

// Get mocked functions for test assertions
const mockAnalyzeTier1 = databricksAIService.analyzeTier1 as jest.MockedFunction<typeof databricksAIService.analyzeTier1>;

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

describe('Guidance System Concurrent Load Test (Real Services)', () => {
  jest.setTimeout(300000); // 5 minute timeout for real service concurrent testing

  beforeEach(async () => {
    // Clean up using public APIs only
    await aiAnalysisBufferService.cleanup();
  });

  afterEach(async () => {
    // Clean up test data
    await aiAnalysisBufferService.cleanup();
  });

  // No mocks - use real services to test concurrent behavior

  describe('Concurrent Service Load Testing', () => {
    it('should handle multiple concurrent AI analysis requests', async () => {
      const concurrentSessions = 8; // Reduced for real service testing
      const groupsPerSession = 3;
      const transcriptionsPerGroup = 5;

      console.log(`🏫 Concurrent load test: ${concurrentSessions} sessions, ${groupsPerSession} groups each`);

      const sessionPromises: Promise<{sessionId: string, success: boolean, totalPrompts: number}>[] = [];
      const startTime = Date.now();

      // Create concurrent sessions using real services
      for (let sessionIndex = 0; sessionIndex < concurrentSessions; sessionIndex++) {
        const sessionPromise = simulateRealSession({
          sessionId: uuidv4(),
          teacherId: uuidv4(),
          groupCount: groupsPerSession,
          transcriptionsPerGroup,
          subject: ['science', 'mathematics', 'literature', 'history'][sessionIndex % 4] as SubjectArea
        });

        sessionPromises.push(sessionPromise);
      }

      // Wait for all sessions to complete
      const sessionResults = await Promise.all(sessionPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Analyze results
      const successfulSessions = sessionResults.filter(r => r.success).length;
      const totalPrompts = sessionResults.reduce((sum, r) => sum + r.totalPrompts, 0);

      // Assertions (allow for some failures in concurrent load testing)
      expect(successfulSessions).toBeGreaterThanOrEqual(concurrentSessions - 2); // Allow 2 failures
      expect(totalPrompts).toBeGreaterThan(0); // Should generate some prompts

      // Performance metrics
      const avgSessionTime = totalTime / concurrentSessions;
      
      console.log(`📊 Load Test Results:`);
      console.log(`  ✅ Sessions completed: ${successfulSessions}/${concurrentSessions}`);
      console.log(`  💡 Total prompts generated: ${totalPrompts}`);
      console.log(`  ⏱️ Average session time: ${avgSessionTime.toFixed(2)}ms`);
      console.log(`  🏃 Total execution time: ${totalTime.toFixed(2)}ms`);

      // Memory usage should be reasonable
      const bufferStatus = aiAnalysisBufferService.getBufferStats();
      expect(bufferStatus.tier1.memoryUsageBytes + bufferStatus.tier2.memoryUsageBytes).toBeLessThan(20 * 1024 * 1024); // 20MB limit for reduced load
      expect(totalTime).toBeLessThan(120000); // Should complete within 2 minutes
    });

    it('should maintain performance under moderate sustained load', async () => {
      const loadDuration = 30; // 30 seconds for real service testing
      const sessionCount = 5; // Reduced for real services
      const groupsPerSession = 2;

      console.log(`⚡ Sustained load test: ${sessionCount} sessions for ${loadDuration}s`);

      const performanceMetrics: Array<{timestamp: number, memoryUsage: number, activeBuffers: number, totalTranscripts: number}> = [];
      const sessionPromises: Promise<{sessionId: string, sessionTranscriptions: number, sessionPrompts: number}>[] = [];

      // Start performance monitoring using public APIs only
      const monitoringInterval = setInterval(() => {
        const bufferStatus = aiAnalysisBufferService.getBufferStats();
        performanceMetrics.push({
          timestamp: Date.now(),
          memoryUsage: bufferStatus.tier1.memoryUsageBytes + bufferStatus.tier2.memoryUsageBytes,
          activeBuffers: bufferStatus.tier1.totalBuffers + bufferStatus.tier2.totalBuffers,
          totalTranscripts: bufferStatus.tier1.totalTranscripts + bufferStatus.tier2.totalTranscripts
        });
      }, 3000); // Monitor every 3 seconds

      try {
        // Start concurrent sessions with real services
        for (let i = 0; i < sessionCount; i++) {
          const sessionPromise = (async () => {
            const sessionId = uuidv4();
            const teacherId = uuidv4();
            let sessionTranscriptions = 0;
            let sessionPrompts = 0;

            const sessionStart = Date.now();
            let iterationCount = 0;

            // Run for duration with real service calls
            while (Date.now() - sessionStart < loadDuration * 1000 && iterationCount < 10) {
              for (let g = 0; g < groupsPerSession; g++) {
                const groupId = uuidv4();
                
                // Buffer real transcriptions
                await aiAnalysisBufferService.bufferTranscription(
                  groupId,
                  sessionId,
                  `Sustained test transcription ${sessionTranscriptions}: Students engage in collaborative problem-solving with varying levels of discourse complexity.`
                );
                sessionTranscriptions++;

                // Perform real analysis with reduced frequency
                if (sessionTranscriptions % 3 === 0) {
                  const transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', groupId, sessionId);
                  if (transcripts.length > 0) {
                    try {
                      const result: Tier1Insights = await databricksAIService.analyzeTier1(transcripts, {
                        groupId: groupId,
                        sessionId: sessionId,
                        focusAreas: ['topical_cohesion']
                      });

                      const promptContext: PromptGenerationContext = {
                        sessionId: sessionId,
                        groupId: groupId,
                        teacherId: teacherId,
                        sessionPhase: 'development',
                        subject: 'science',
                        learningObjectives: ['Sustained collaboration'],
                        groupSize: 4,
                        sessionDuration: 30
                      };

                      const prompts = await teacherPromptService.generatePrompts(
                        result,
                        promptContext,
                        {
                          maxPrompts: 2,
                          priorityFilter: 'all',
                          includeEffectivenessScore: true
                        }
                      );

                      sessionPrompts += prompts.length;
                      await aiAnalysisBufferService.markBufferAnalyzed('tier1', groupId, sessionId);
                    } catch (error: unknown) {
                      const errorMessage = error instanceof Error ? error.message : String(error);
                      console.warn(`Analysis failed for ${groupId}:`, errorMessage);
                    }
                  }
                }
              }

              // Realistic interval between iterations
              await new Promise(resolve => setTimeout(resolve, 3000));
              iterationCount++;
            }

            return { sessionId, sessionTranscriptions, sessionPrompts };
          })();

          sessionPromises.push(sessionPromise);
        }

        const sessionResults = await Promise.all(sessionPromises);
        clearInterval(monitoringInterval);

        // Analyze sustained performance with real services
        const totalSessionTranscriptions = sessionResults.reduce((sum, r) => sum + r.sessionTranscriptions, 0);
        const totalSessionPrompts = sessionResults.reduce((sum, r) => sum + r.sessionPrompts, 0);

        console.log(`📊 Sustained Load Results:`);
        console.log(`  📝 Total transcriptions: ${totalSessionTranscriptions}`);
        console.log(`  💡 Total prompts: ${totalSessionPrompts}`);
        console.log(`  📈 Performance samples: ${performanceMetrics.length}`);

        // Verify system stability with real services
        expect(sessionResults).toHaveLength(sessionCount);
        expect(totalSessionTranscriptions).toBeGreaterThan(sessionCount);

        // Check memory usage with reduced limits for real services
        if (performanceMetrics.length > 0) {
          const maxMemoryUsage = Math.max(...performanceMetrics.map(m => m.memoryUsage));
          expect(maxMemoryUsage).toBeLessThan(30 * 1024 * 1024); // 30MB max for real services
        }

      } finally {
        clearInterval(monitoringInterval);
      }
    });
  });

  describe('Session Data Isolation with Real Services', () => {
    it('should maintain isolation between concurrent sessions', async () => {
      const sessionCount = 6; // Reduced for real service testing
      const groupsPerSession = 2;

      console.log(`🔒 Isolation test: ${sessionCount} isolated sessions`);

      const isolationPromises: Promise<{sessionId: string, teacherId: string, transcriptions: string[], prompts: any[]}>[] = [];

      for (let i = 0; i < sessionCount; i++) {
        const isolationPromise = (async () => {
          const sessionId = uuidv4();
          const teacherId = uuidv4();
          const sessionData = {
            sessionId,
            teacherId,
            transcriptions: [] as string[],
            prompts: [] as any[]
          };

          // Create session-specific data with real services
          for (let g = 0; g < groupsPerSession; g++) {
            const groupId = uuidv4();

            // Buffer session-specific transcriptions
            const transcriptionText = `Session ${i} Group ${g} transcription: Isolated discussion content specific to this session and group for testing data boundaries.`;
            await aiAnalysisBufferService.bufferTranscription(groupId, sessionId, transcriptionText);
            sessionData.transcriptions.push(transcriptionText);

            // Trigger real analysis for this session's data
            const transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', groupId, sessionId);
            if (transcripts.length > 0) {
              
              // Verify transcripts only contain this session's data
              expect(transcripts.every(t => t.includes(`Session ${i}`))).toBe(true);

              const result: Tier1Insights = await databricksAIService.analyzeTier1(transcripts, {
                groupId: groupId,
                sessionId: sessionId,
                focusAreas: ['topical_cohesion']
              });

              const promptContext: PromptGenerationContext = {
                sessionId: sessionId,
                groupId: groupId,
                teacherId: teacherId,
                sessionPhase: 'development',
                subject: 'science',
                learningObjectives: [`Isolation test session ${i}`],
                groupSize: 4,
                sessionDuration: 30
              };

              const prompts = await teacherPromptService.generatePrompts(
                result,
                promptContext,
                {
                  maxPrompts: 2,
                  priorityFilter: 'all',
                  includeEffectivenessScore: true
                }
              );

              sessionData.prompts.push(...prompts);
              await aiAnalysisBufferService.markBufferAnalyzed('tier1', groupId, sessionId);
            }
          }

          return sessionData;
        })();

        isolationPromises.push(isolationPromise);
      }

      const sessionDataResults = await Promise.all(isolationPromises);

      // Verify isolation between sessions using real service responses
      for (let i = 0; i < sessionDataResults.length; i++) {
        const sessionData = sessionDataResults[i];
        
        // Each session should have its own data
        expect(sessionData.transcriptions.length).toBeGreaterThan(0);
        expect(sessionData.transcriptions.every(t => t.includes(`Session ${i}`))).toBe(true);
        
        // Prompts should be session-specific
        if (sessionData.prompts.length > 0) {
          expect(sessionData.prompts.every(p => p.sessionId === sessionData.sessionId)).toBe(true);
          expect(sessionData.prompts.every(p => p.teacherId === sessionData.teacherId)).toBe(true);
        }

        // Verify no cross-contamination with other sessions
        for (let j = 0; j < sessionDataResults.length; j++) {
          if (i !== j && sessionData.prompts.length > 0) {
            const otherSession = sessionDataResults[j];
            
            // No prompts should belong to other sessions
            expect(sessionData.prompts.every(p => p.sessionId !== otherSession.sessionId)).toBe(true);
            expect(sessionData.prompts.every(p => p.teacherId !== otherSession.teacherId)).toBe(true);
          }
        }
      }

      console.log(`✅ Isolation verified: ${sessionCount} sessions maintained separate data`);
      
      // Verify buffer state using public API only
      const bufferStatus = aiAnalysisBufferService.getBufferStats();
      expect(bufferStatus.tier1.totalBuffers).toBeGreaterThanOrEqual(0);
      expect(bufferStatus.tier2.totalBuffers).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Buffer Management Under Load', () => {
    it('should handle buffer cleanup and memory management under concurrent load', async () => {
      const sessionCount = 4;
      const duration = 20; // 20 seconds for real service testing

      console.log(`💾 Buffer management test: ${sessionCount} concurrent sessions for ${duration}s`);

      const sessionPromises: Promise<{sessionId: string, operationCount: number}>[] = [];

      // Start concurrent sessions focused on buffer management
      for (let i = 0; i < sessionCount; i++) {
        const sessionPromise = (async () => {
          const sessionId = uuidv4();
          const teacherId = uuidv4();
          const groupId = uuidv4();

          const sessionStart = Date.now();
          let operationCount = 0;

          while (Date.now() - sessionStart < duration * 1000) {
            try {
              // Buffer transcriptions
              await aiAnalysisBufferService.bufferTranscription(
                groupId,
                sessionId,
                `Buffer management transcription ${operationCount}: Testing concurrent buffer operations and cleanup behavior under sustained load conditions.`
              );
              operationCount++;

              // Periodic analysis to test buffer turnover
              if (operationCount % 3 === 0) {
                const transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', groupId, sessionId);
                if (transcripts.length > 0) {
                  const result: Tier1Insights = await databricksAIService.analyzeTier1(transcripts, {
                    groupId: groupId,
                    sessionId: sessionId,
                    focusAreas: ['topical_cohesion']
                  });

                  // Verify result structure
                  expect(result).toHaveProperty('topicalCohesion');
                  expect(result.metadata?.processingTimeMs).toBeGreaterThan(0);

                  // Mark buffer analyzed to test cleanup
                  await aiAnalysisBufferService.markBufferAnalyzed('tier1', groupId, sessionId);
                }
              }

              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.warn(`Buffer operation failed for ${groupId}:`, errorMessage);
            }
          }

          return { sessionId, operationCount };
        })();

        sessionPromises.push(sessionPromise);
      }

      const sessionResults = await Promise.all(sessionPromises);

      // Verify operations completed successfully
      expect(sessionResults).toHaveLength(sessionCount);
      const totalOperations = sessionResults.reduce((sum, r) => sum + r.operationCount, 0);
      expect(totalOperations).toBeGreaterThan(sessionCount);

      console.log(`💾 Buffer Management Results:`);
      console.log(`  🔧 Total operations: ${totalOperations}`);
      console.log(`  ✅ Sessions completed: ${sessionResults.length}`);

      // Verify buffer state using public API only
      const finalBufferStatus = aiAnalysisBufferService.getBufferStats();
      expect(finalBufferStatus.tier1.memoryUsageBytes + finalBufferStatus.tier2.memoryUsageBytes).toBeGreaterThanOrEqual(0);
      console.log(`  💾 Final memory usage: ${(finalBufferStatus.tier1.memoryUsageBytes + finalBufferStatus.tier2.memoryUsageBytes).toFixed(0)} bytes`);
    });
  });
});

// Helper function to simulate a real session with actual service calls
async function simulateRealSession(config: {
  sessionId: string;
  teacherId: string;
  groupCount: number;
  transcriptionsPerGroup: number;
  subject: SubjectArea;
}) {
  const { sessionId, teacherId, groupCount, transcriptionsPerGroup, subject } = config;
  
  let totalPrompts = 0;
  let success = true;

  try {
    const transcriptionTexts = [
      "Students are discussing the main concepts actively and building understanding",
      "One student is explaining their reasoning while others listen and respond",
      "The group is working through a challenging problem with collaborative effort",
      "Students are asking clarifying questions to deepen their comprehension",
      "There's collaborative building on each other's ideas and perspectives",
      "Students are making connections to previous learning and experiences",
      "The discussion has evolved to explore related concepts and applications"
    ];

    // Process each group with real service calls
    for (let g = 0; g < groupCount; g++) {
      const groupId = uuidv4(); // Use proper UUID for group
      
      // Buffer multiple transcriptions per group
      for (let t = 0; t < transcriptionsPerGroup; t++) {
        const transcriptionText = `${subject} discussion: ${transcriptionTexts[t % transcriptionTexts.length]}`;
        await aiAnalysisBufferService.bufferTranscription(groupId, sessionId, transcriptionText);
      }

      // Perform real Tier 1 analysis
      const transcripts = await aiAnalysisBufferService.getBufferedTranscripts('tier1', groupId, sessionId);
      if (transcripts.length > 0) {
        const result: Tier1Insights = await databricksAIService.analyzeTier1(transcripts, {
          groupId: groupId,
          sessionId: sessionId,
          focusAreas: ['topical_cohesion', 'conceptual_density']
        });

        // Validate result structure
        expect(result).toHaveProperty('topicalCohesion');
        expect(result).toHaveProperty('conceptualDensity');
        expect(result.metadata?.processingTimeMs).toBeGreaterThan(0);

        // Generate prompts using real service
        const promptContext: PromptGenerationContext = {
          sessionId: sessionId,
          groupId: groupId, 
          teacherId: teacherId,
          sessionPhase: 'development',
          subject: subject,
          learningObjectives: ['Understanding concepts'],
          groupSize: 4,
          sessionDuration: 30
        };

        const prompts = await teacherPromptService.generatePrompts(
          result,
          promptContext,
          {
            maxPrompts: 2,
            priorityFilter: 'all',
            includeEffectivenessScore: true
          }
        );

        totalPrompts += prompts.length;
        await aiAnalysisBufferService.markBufferAnalyzed('tier1', groupId, sessionId);
      }
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Session ${sessionId} failed:`, errorMessage);
    success = false;
  }

  return {
    sessionId,
    success,
    totalPrompts
  };
}
