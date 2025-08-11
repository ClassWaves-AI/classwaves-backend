import { aiAnalysisBufferService } from '../../../services/ai-analysis-buffer.service';
import { databricksAIService } from '../../../services/databricks-ai.service';
import { teacherPromptService } from '../../../services/teacher-prompt.service';
import { alertPrioritizationService } from '../../../services/alert-prioritization.service';
import { guidanceSystemHealthService } from '../../../services/guidance-system-health.service';

// Mock external dependencies
jest.mock('../../../services/databricks-ai.service');
jest.mock('../../../services/websocket.service');
jest.mock('../../../services/databricks.service');

describe('Guidance System Concurrent Sessions Test', () => {
  jest.setTimeout(120000); // 2 minute timeout for comprehensive concurrent testing

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset services
    aiAnalysisBufferService['tier1Buffers'].clear();
    aiAnalysisBufferService['tier2Buffers'].clear();
    guidanceSystemHealthService['metrics'] = {
      aiAnalysis: {
        tier1_analysis: { successCount: 0, failureCount: 0, totalDuration: 0, lastFailure: null },
        tier2_analysis: { successCount: 0, failureCount: 0, totalDuration: 0, lastFailure: null }
      },
      promptGeneration: {
        generate_prompts: { successCount: 0, failureCount: 0, totalDuration: 0, lastFailure: null },
        prioritize_prompts: { successCount: 0, failureCount: 0, totalDuration: 0, lastFailure: null }
      },
      alertDelivery: {
        deliver_immediate: { successCount: 0, failureCount: 0, totalDuration: 0, lastFailure: null },
        deliver_batch: { successCount: 0, failureCount: 0, totalDuration: 0, lastFailure: null }
      },
      analyticsTracking: {
        track_interaction: { successCount: 0, failureCount: 0, totalDuration: 0, lastFailure: null },
        store_metrics: { successCount: 0, failureCount: 0, totalDuration: 0, lastFailure: null }
      }
    };

    // Setup realistic AI service mocks
    (databricksAIService.analyzeTier1 as jest.Mock).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 150));
      return {
        insights: {
          topicalCohesion: 60 + Math.random() * 30,
          conceptualDensity: 70 + Math.random() * 25,
          engagementLevel: ['low', 'medium', 'high'][Math.floor(Math.random() * 3)],
          collaborationQuality: ['poor', 'fair', 'good', 'excellent'][Math.floor(Math.random() * 4)],
          participationBalance: 0.4 + Math.random() * 0.5,
          offTopicIndicators: Math.random() > 0.7 ? ['distraction'] : [],
          keyTermsUsed: ['discussion', 'collaboration', 'learning'],
          groupDynamics: {
            leadershipPattern: ['single', 'rotating', 'shared'][Math.floor(Math.random() * 3)],
            conflictLevel: ['none', 'low', 'medium'][Math.floor(Math.random() * 3)]
          }
        },
        metadata: {
          processingTime: 50 + Math.random() * 150,
          confidence: 0.75 + Math.random() * 0.2
        }
      };
    });

    (databricksAIService.analyzeTier2 as jest.Mock).mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
      return {
        insights: {
          argumentationQuality: 40 + Math.random() * 50,
          emotionalArc: {
            phases: ['engagement', 'development', 'synthesis'],
            overallSentiment: ['positive', 'neutral', 'frustrated'][Math.floor(Math.random() * 3)],
            emotionalPeaks: [],
            engagementTrend: ['improving', 'stable', 'declining'][Math.floor(Math.random() * 3)]
          },
          collaborationPatterns: {
            leadershipDistribution: ['balanced', 'dominated', 'unclear'][Math.floor(Math.random() * 3)],
            participationEquity: 0.3 + Math.random() * 0.6,
            supportiveInteractions: Math.floor(Math.random() * 15),
            buildingOnIdeas: Math.floor(Math.random() * 10)
          },
          learningSignals: {
            conceptualBreakthroughs: Math.floor(Math.random() * 4),
            misconceptionsCorrected: Math.floor(Math.random() * 3),
            deepQuestioningOccurred: Math.random() > 0.5,
            evidenceOfUnderstanding: ['basic_recall', 'application', 'synthesis'].slice(0, Math.floor(Math.random() * 3) + 1)
          }
        },
        metadata: {
          processingTime: 200 + Math.random() * 300,
          confidence: 0.7 + Math.random() * 0.25
        }
      };
    });
  });

  describe('Multi-Session Classroom Simulation', () => {
    it('should handle 25 concurrent classroom sessions with realistic usage patterns', async () => {
      const sessionCount = 25;
      const groupsPerSession = 6; // Realistic class size
      const sessionDuration = 45; // 45-second simulation
      const transcriptionInterval = 3000; // Every 3 seconds

      console.log(`🏫 Classroom simulation: ${sessionCount} sessions, ${groupsPerSession} groups each`);
      console.log(`⏱️ Duration: ${sessionDuration}s, transcriptions every ${transcriptionInterval/1000}s`);

      const sessionPromises = [];
      const startTime = Date.now();

      // Create concurrent classroom sessions
      for (let sessionIndex = 0; sessionIndex < sessionCount; sessionIndex++) {
        const sessionPromise = simulateClassroomSession({
          sessionId: `classroom-${sessionIndex}`,
          teacherId: `teacher-${sessionIndex}`,
          groupCount: groupsPerSession,
          duration: sessionDuration,
          transcriptionInterval,
          subject: ['science', 'mathematics', 'literature', 'history'][sessionIndex % 4]
        });

        sessionPromises.push(sessionPromise);
      }

      // Wait for all sessions to complete
      const sessionResults = await Promise.all(sessionPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Analyze results
      const totalGroups = sessionCount * groupsPerSession;
      const successfulSessions = sessionResults.filter(r => r.success).length;
      const totalPrompts = sessionResults.reduce((sum, r) => sum + r.totalPrompts, 0);
      const totalAlerts = sessionResults.reduce((sum, r) => sum + r.totalAlerts, 0);
      const totalTranscriptions = sessionResults.reduce((sum, r) => sum + r.totalTranscriptions, 0);

      // Assertions
      expect(successfulSessions).toBe(sessionCount);
      expect(totalPrompts).toBeGreaterThan(sessionCount); // At least one prompt per session
      expect(totalTranscriptions).toBeGreaterThan(totalGroups * 10); // Multiple transcriptions per group

      // Performance metrics
      const avgSessionTime = totalTime / sessionCount;
      const promptsPerSecond = totalPrompts / (totalTime / 1000);
      
      console.log(`📊 Simulation Results:`);
      console.log(`  ✅ Sessions completed: ${successfulSessions}/${sessionCount}`);
      console.log(`  📝 Total transcriptions: ${totalTranscriptions}`);
      console.log(`  💡 Total prompts generated: ${totalPrompts}`);
      console.log(`  🚨 Total alerts delivered: ${totalAlerts}`);
      console.log(`  ⏱️ Average session time: ${avgSessionTime.toFixed(2)}ms`);
      console.log(`  🏃 Prompts per second: ${promptsPerSecond.toFixed(2)}`);

      // System health check
      const healthReport = await guidanceSystemHealthService.performHealthCheck();
      expect(healthReport.overallHealth).toBe('healthy');

      // Memory usage should be reasonable
      const bufferStatus = aiAnalysisBufferService.getBufferStatus();
      expect(bufferStatus.totalMemoryUsage).toBeLessThan(50 * 1024 * 1024); // 50MB limit
    });

    it('should maintain performance under sustained concurrent load', async () => {
      const loadDuration = 60; // 60 seconds of sustained load
      const sessionCount = 15;
      const groupsPerSession = 4;

      console.log(`⚡ Sustained load test: ${sessionCount} sessions for ${loadDuration}s`);

      const performanceMetrics = [];
      const sessionPromises = [];
      let globalTranscriptionCount = 0;
      let globalPromptCount = 0;

      // Start sustained load monitoring
      const monitoringInterval = setInterval(() => {
        const bufferStatus = aiAnalysisBufferService.getBufferStatus();
        performanceMetrics.push({
          timestamp: Date.now(),
          memoryUsage: bufferStatus.totalMemoryUsage,
          activeBuffers: bufferStatus.tier1BufferCount + bufferStatus.tier2BufferCount,
          totalTranscriptions: bufferStatus.totalTranscripts
        });
      }, 5000);

      try {
        // Start concurrent sessions
        for (let i = 0; i < sessionCount; i++) {
          const sessionPromise = (async () => {
            const sessionId = `sustained-${i}`;
            const teacherId = `teacher-${i}`;
            let sessionTranscriptions = 0;
            let sessionPrompts = 0;

            // Run session for the full duration
            const sessionStart = Date.now();
            while (Date.now() - sessionStart < loadDuration * 1000) {
              // Simulate group discussions
              for (let g = 0; g < groupsPerSession; g++) {
                const groupId = `group-${i}-${g}`;
                
                await aiAnalysisBufferService.bufferTranscription(
                  groupId,
                  sessionId,
                  `Sustained load transcription ${globalTranscriptionCount++}: Students are engaging in continuous discussion during the sustained load test scenario.`
                );
                sessionTranscriptions++;

                // Check for analysis triggers
                if (aiAnalysisBufferService.shouldTriggerTier1Analysis(groupId)) {
                  try {
                    const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
                    const result = await databricksAIService.analyzeTier1(transcripts, {
                      focusAreas: ['engagement', 'collaboration'],
                      sessionPhase: 'development',
                      subject: 'science'
                    });

                    const prompts = await teacherPromptService.generatePrompts(
                      result.insights,
                      null,
                      {
                        sessionId, teacherId, groupId,
                        sessionPhase: 'development',
                        subject: 'science',
                        learningObjectives: ['Sustained collaboration'],
                        currentTime: new Date(),
                        groupSize: 4,
                        sessionDuration: 60
                      }
                    );

                    sessionPrompts += prompts.length;
                    globalPromptCount += prompts.length;
                    aiAnalysisBufferService.markTier1Analyzed(groupId);
                  } catch (error) {
                    console.warn(`Analysis failed for ${groupId}:`, error.message);
                  }
                }
              }

              // Simulate realistic intervals between transcriptions
              await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
            }

            return { sessionId, sessionTranscriptions, sessionPrompts };
          })();

          sessionPromises.push(sessionPromise);
        }

        const sessionResults = await Promise.all(sessionPromises);
        clearInterval(monitoringInterval);

        // Analyze sustained performance
        const totalSessionTranscriptions = sessionResults.reduce((sum, r) => sum + r.sessionTranscriptions, 0);
        const totalSessionPrompts = sessionResults.reduce((sum, r) => sum + r.sessionPrompts, 0);

        console.log(`📊 Sustained Load Results:`);
        console.log(`  📝 Total transcriptions: ${totalSessionTranscriptions}`);
        console.log(`  💡 Total prompts: ${totalSessionPrompts}`);
        console.log(`  📈 Performance samples: ${performanceMetrics.length}`);

        // Verify system remained stable
        expect(sessionResults).toHaveLength(sessionCount);
        expect(totalSessionTranscriptions).toBeGreaterThan(sessionCount * 10);

        // Check memory usage stayed reasonable throughout
        const maxMemoryUsage = Math.max(...performanceMetrics.map(m => m.memoryUsage));
        expect(maxMemoryUsage).toBeLessThan(75 * 1024 * 1024); // 75MB max

        // Verify performance degradation was minimal
        const earlyMetrics = performanceMetrics.slice(0, 3);
        const lateMetrics = performanceMetrics.slice(-3);
        
        const earlyAvgMemory = earlyMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) / earlyMetrics.length;
        const lateAvgMemory = lateMetrics.reduce((sum, m) => sum + m.memoryUsage, 0) / lateMetrics.length;
        
        // Memory should not have grown excessively
        expect(lateAvgMemory).toBeLessThan(earlyAvgMemory * 3); // Less than 3x growth

        console.log(`💾 Memory usage: ${earlyAvgMemory.toFixed(0)} → ${lateAvgMemory.toFixed(0)} bytes`);

      } finally {
        clearInterval(monitoringInterval);
      }
    });
  });

  describe('Cross-Session Resource Isolation', () => {
    it('should maintain isolation between concurrent sessions', async () => {
      const sessionCount = 12;
      const groupsPerSession = 5;

      console.log(`🔒 Isolation test: ${sessionCount} isolated sessions`);

      const isolationPromises = [];

      for (let i = 0; i < sessionCount; i++) {
        const isolationPromise = (async () => {
          const sessionId = `isolation-${i}`;
          const teacherId = `teacher-${i}`;
          const sessionData = {
            sessionId,
            teacherId,
            transcriptions: [],
            prompts: [],
            bufferIds: []
          };

          // Create session-specific data
          for (let g = 0; g < groupsPerSession; g++) {
            const groupId = `isolation-group-${i}-${g}`;
            sessionData.bufferIds.push(groupId);

            // Buffer session-specific transcriptions
            const transcriptionText = `Session ${i} Group ${g} transcription: Isolated discussion content specific to this session and group.`;
            await aiAnalysisBufferService.bufferTranscription(groupId, sessionId, transcriptionText);
            sessionData.transcriptions.push(transcriptionText);

            // Trigger analysis for this session's data
            if (aiAnalysisBufferService.shouldTriggerTier1Analysis(groupId)) {
              const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
              
              // Verify transcripts only contain this session's data
              expect(transcripts.every(t => t.text.includes(`Session ${i}`))).toBe(true);

              const result = await databricksAIService.analyzeTier1(transcripts, {
                focusAreas: ['engagement'],
                sessionPhase: 'development',
                subject: 'science'
              });

              const prompts = await teacherPromptService.generatePrompts(
                result.insights,
                null,
                {
                  sessionId, teacherId, groupId,
                  sessionPhase: 'development',
                  subject: 'science',
                  learningObjectives: [`Isolation test session ${i}`],
                  currentTime: new Date(),
                  groupSize: 4,
                  sessionDuration: 30
                }
              );

              sessionData.prompts.push(...prompts);
              aiAnalysisBufferService.markTier1Analyzed(groupId);
            }
          }

          return sessionData;
        })();

        isolationPromises.push(isolationPromise);
      }

      const sessionDataResults = await Promise.all(isolationPromises);

      // Verify isolation between sessions
      for (let i = 0; i < sessionDataResults.length; i++) {
        const sessionData = sessionDataResults[i];
        
        // Each session should have its own data
        expect(sessionData.transcriptions.length).toBeGreaterThan(0);
        expect(sessionData.transcriptions.every(t => t.includes(`Session ${i}`))).toBe(true);
        
        // Prompts should be session-specific
        expect(sessionData.prompts.every(p => p.sessionId === sessionData.sessionId)).toBe(true);
        expect(sessionData.prompts.every(p => p.teacherId === sessionData.teacherId)).toBe(true);

        // Verify no cross-contamination with other sessions
        for (let j = 0; j < sessionDataResults.length; j++) {
          if (i !== j) {
            const otherSession = sessionDataResults[j];
            
            // No prompts should belong to other sessions
            expect(sessionData.prompts.every(p => p.sessionId !== otherSession.sessionId)).toBe(true);
            expect(sessionData.prompts.every(p => p.teacherId !== otherSession.teacherId)).toBe(true);
          }
        }
      }

      console.log(`✅ Isolation verified: ${sessionCount} sessions maintained separate data`);
      
      // Verify global buffer state
      const bufferStatus = aiAnalysisBufferService.getBufferStatus();
      expect(bufferStatus.tier1BufferCount).toBe(sessionCount * groupsPerSession);
      expect(bufferStatus.tier2BufferCount).toBe(sessionCount);
    });
  });

  describe('System Health Under Concurrent Load', () => {
    it('should maintain health metrics across concurrent sessions', async () => {
      const sessionCount = 20;
      const duration = 30;

      console.log(`🏥 Health monitoring: ${sessionCount} concurrent sessions for ${duration}s`);

      const healthSnapshots = [];
      const sessionPromises = [];

      // Start health monitoring
      const healthMonitoring = setInterval(async () => {
        const healthReport = await guidanceSystemHealthService.performHealthCheck();
        healthSnapshots.push({
          timestamp: Date.now(),
          overallHealth: healthReport.overallHealth,
          componentHealth: Object.keys(healthReport.componentHealth).reduce((acc, key) => {
            acc[key] = healthReport.componentHealth[key].status;
            return acc;
          }, {} as Record<string, string>)
        });
      }, 5000);

      try {
        // Start concurrent sessions with health tracking
        for (let i = 0; i < sessionCount; i++) {
          const sessionPromise = (async () => {
            const sessionId = `health-${i}`;
            const teacherId = `teacher-${i}`;
            const groupId = `health-group-${i}`;

            const sessionStart = Date.now();
            let operationCount = 0;

            while (Date.now() - sessionStart < duration * 1000) {
              try {
                // Record operation start for health metrics
                const opStart = Date.now();

                await aiAnalysisBufferService.bufferTranscription(
                  groupId,
                  sessionId,
                  `Health monitoring transcription ${operationCount++}: Continuous monitoring of system health during concurrent operations.`
                );

                if (aiAnalysisBufferService.shouldTriggerTier1Analysis(groupId)) {
                  const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
                  const result = await databricksAIService.analyzeTier1(transcripts, {
                    focusAreas: ['engagement'],
                    sessionPhase: 'development',
                    subject: 'science'
                  });

                  const prompts = await teacherPromptService.generatePrompts(
                    result.insights,
                    null,
                    {
                      sessionId, teacherId, groupId,
                      sessionPhase: 'development',
                      subject: 'science',
                      learningObjectives: ['Health monitoring'],
                      currentTime: new Date(),
                      groupSize: 4,
                      sessionDuration: 30
                    }
                  );

                  // Record successful operation
                  const opDuration = Date.now() - opStart;
                  guidanceSystemHealthService.recordSuccess('aiAnalysis', 'tier1_analysis', opDuration);
                  guidanceSystemHealthService.recordSuccess('promptGeneration', 'generate_prompts', opDuration);

                  aiAnalysisBufferService.markTier1Analyzed(groupId);
                }

                await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
              } catch (error) {
                // Record failure for health metrics
                guidanceSystemHealthService.recordFailure(
                  'aiAnalysis',
                  'tier1_analysis',
                  Date.now() - Date.now(),
                  error.message
                );
              }
            }

            return { sessionId, operationCount };
          })();

          sessionPromises.push(sessionPromise);
        }

        const sessionResults = await Promise.all(sessionPromises);
        clearInterval(healthMonitoring);

        // Analyze health progression
        expect(healthSnapshots.length).toBeGreaterThan(3);
        
        // System should maintain health throughout
        const healthySnapshots = healthSnapshots.filter(s => s.overallHealth === 'healthy');
        const healthPercentage = (healthySnapshots.length / healthSnapshots.length) * 100;
        
        expect(healthPercentage).toBeGreaterThan(80); // At least 80% healthy

        console.log(`🏥 Health Results:`);
        console.log(`  📊 Health snapshots: ${healthSnapshots.length}`);
        console.log(`  ✅ Healthy percentage: ${healthPercentage.toFixed(1)}%`);
        console.log(`  🔧 Operations completed: ${sessionResults.reduce((sum, r) => sum + r.operationCount, 0)}`);

        // Verify final health state
        const finalHealthReport = await guidanceSystemHealthService.performHealthCheck();
        expect(['healthy', 'warning']).toContain(finalHealthReport.overallHealth);

      } finally {
        clearInterval(healthMonitoring);
      }
    });
  });
});

// Helper function to simulate a complete classroom session
async function simulateClassroomSession(config: {
  sessionId: string;
  teacherId: string;
  groupCount: number;
  duration: number;
  transcriptionInterval: number;
  subject: string;
}) {
  const { sessionId, teacherId, groupCount, duration, transcriptionInterval, subject } = config;
  
  let totalTranscriptions = 0;
  let totalPrompts = 0;
  let totalAlerts = 0;
  let success = true;

  try {
    const sessionStart = Date.now();
    const transcriptionTexts = [
      "Students are discussing the main concepts actively",
      "One student is explaining their understanding to others",
      "The group is working through a challenging problem together",
      "Students are asking clarifying questions about the topic",
      "There's collaborative building on each other's ideas",
      "Students are making connections to previous learning",
      "The discussion has shifted to a related subtopic",
      "Students are struggling with a particular concept",
      "One student is dominating the conversation",
      "The group energy seems to be declining"
    ];

    while (Date.now() - sessionStart < duration * 1000) {
      // Simulate transcriptions from each group
      for (let g = 0; g < groupCount; g++) {
        const groupId = `${sessionId}-group-${g}`;
        const transcriptionText = `${subject} discussion: ${transcriptionTexts[totalTranscriptions % transcriptionTexts.length]}`;
        
        await aiAnalysisBufferService.bufferTranscription(groupId, sessionId, transcriptionText);
        totalTranscriptions++;

        // Check for Tier 1 analysis trigger
        if (aiAnalysisBufferService.shouldTriggerTier1Analysis(groupId)) {
          const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
          const result = await databricksAIService.analyzeTier1(transcripts, {
            focusAreas: ['engagement', 'collaboration'],
            sessionPhase: 'development',
            subject
          });

          const prompts = await teacherPromptService.generatePrompts(
            result.insights,
            null,
            {
              sessionId, teacherId, groupId,
              sessionPhase: 'development',
              subject,
              learningObjectives: [`${subject} learning objectives`],
              currentTime: new Date(),
              groupSize: 4,
              sessionDuration: 45
            }
          );

          totalPrompts += prompts.length;

          // Simulate alert delivery for high priority prompts
          for (const prompt of prompts) {
            if (prompt.priority === 'high') {
              await alertPrioritizationService.prioritizeAlert(prompt, {
                currentSessionLoad: 'medium',
                teacherEngagementLevel: 'active',
                recentAlertCount: totalAlerts,
                sessionPhase: 'development'
              });
              totalAlerts++;
            }
          }

          aiAnalysisBufferService.markTier1Analyzed(groupId);
        }

        // Check for Tier 2 analysis trigger (less frequent)
        if (totalTranscriptions > 15 && aiAnalysisBufferService.shouldTriggerTier2Analysis(sessionId)) {
          const transcripts = aiAnalysisBufferService.getBufferedTranscripts(groupId);
          const result = await databricksAIService.analyzeTier2(transcripts, {
            analysisDepth: 'deep',
            includeEmotionalArc: true,
            includeLearningSignals: true,
            sessionPhase: 'development',
            subject
          });

          const tier2Prompts = await teacherPromptService.generatePrompts(
            null,
            result.insights,
            {
              sessionId, teacherId, groupId,
              sessionPhase: 'development',
              subject,
              learningObjectives: [`Advanced ${subject} analysis`],
              currentTime: new Date(),
              groupSize: 4,
              sessionDuration: 45
            }
          );

          totalPrompts += tier2Prompts.length;
          aiAnalysisBufferService.markTier2Analyzed(sessionId);
        }
      }

      // Wait before next round of transcriptions
      await new Promise(resolve => setTimeout(resolve, transcriptionInterval));
    }

  } catch (error) {
    console.error(`Session ${sessionId} failed:`, error.message);
    success = false;
  }

  return {
    sessionId,
    success,
    totalTranscriptions,
    totalPrompts,
    totalAlerts
  };
}
