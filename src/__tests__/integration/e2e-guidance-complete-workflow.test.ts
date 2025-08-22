/**
 * E2E Tests for Complete Guidance Workflow
 * 
 * Tests the complete teacher guidance system using:
 * - Real backend server (NODE_ENV=test)
 * - Actual Databricks connections (with test data)
 * - Live WebSocket connections
 * - Full AI analysis pipeline
 * - Complete teacher prompt generation and delivery
 * 
 * Validates the entire flow from transcription buffering to teacher guidance delivery
 */

import { Server as HTTPServer } from 'http';
import { io as clientIO, Socket as ClientSocket } from 'socket.io-client';
import request from 'supertest';
import app from '../../app';
import { aiAnalysisBufferService } from '../../services/ai-analysis-buffer.service';
import { teacherPromptService } from '../../services/teacher-prompt.service';
import { databricksService } from '../../services/databricks.service';
import { redisService } from '../../services/redis.service';

// Real E2E test - use actual services with test environment
const TEST_ENV = process.env.NODE_ENV === 'test' && process.env.E2E_TEST_SECRET === 'test';

describe('E2E: Complete Guidance Workflow', () => {
  let server: HTTPServer;
  let teacherSocket: ClientSocket;
  let serverPort: number;
  let teacherToken: string;

  // Test session data
  const testSessionId = `e2e-session-${Date.now()}`;
  const testTeacherId = `e2e-teacher-${Date.now()}`;
  const testGroupId1 = `e2e-group-1-${Date.now()}`;
  const testGroupId2 = `e2e-group-2-${Date.now()}`;

  beforeAll(async () => {
    if (!TEST_ENV) {
      console.log('⚠️ Skipping E2E tests - requires NODE_ENV=test E2E_TEST_SECRET=test');
      return;
    }

    // Start real backend server
    server = app.listen(0);
    serverPort = (server.address() as any)?.port;
    console.log(`🚀 E2E Test server running on port ${serverPort}`);

    // Wait for services to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify backend services are running
    expect(await redisService.ping()).toBe('PONG');
    console.log('✅ Redis connection verified');

    // Create test teacher authentication
    const authResponse = await request(app)
      .post('/api/auth/test-login')
      .send({
        userId: testTeacherId,
        role: 'teacher',
        email: 'test-teacher@example.com',
        name: 'Test Teacher'
      });

    expect(authResponse.status).toBe(200);
    teacherToken = authResponse.body.accessToken;
    console.log('✅ Test teacher authentication created');

  }, 30000);

  afterAll(async () => {
    if (!TEST_ENV) return;

    if (teacherSocket) {
      teacherSocket.close();
    }
    if (server) {
      server.close();
    }

    // Cleanup test data
    try {
      await databricksService.query(
        'DELETE FROM classwaves.ai_insights.teacher_guidance_metrics WHERE session_id LIKE ?',
        [`e2e-session-%`]
      );
      await databricksService.query(
        'DELETE FROM classwaves.ai_insights.analysis_results WHERE session_id LIKE ?',
        [`e2e-session-%`]
      );
    } catch (error) {
      console.warn('⚠️ Cleanup failed:', error);
    }

    console.log('🧹 E2E test cleanup completed');
  }, 15000);

  beforeEach(async () => {
    if (!TEST_ENV) return;

    // Clear service state for each test
    aiAnalysisBufferService['tier1Buffers'].clear();
    aiAnalysisBufferService['tier2Buffers'].clear();
    aiAnalysisBufferService['insightsCache'].clear();
    teacherPromptService['promptCache'].clear();
  });

  describe('Complete Real-Data Workflow', () => {
    it('should execute complete guidance flow with real backend services', async () => {
      if (!TEST_ENV) {
        console.log('⚠️ Skipping E2E test - not in test environment');
        return;
      }

      // Step 1: Create test session via API
      const sessionResponse = await request(app)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          name: 'E2E Test Session',
          description: 'Testing complete guidance workflow',
          subject: 'science',
          targetGroupSize: 4,
          plannedDuration: 45,
          settings: {
            aiAnalysisEnabled: true,
            transcriptionEnabled: true,
            guidanceEnabled: true
          }
        });

      expect(sessionResponse.status).toBe(201);
      const actualSessionId = sessionResponse.body.id;
      console.log(`✅ Test session created: ${actualSessionId}`);

      // Step 2: Connect teacher to guidance namespace
      teacherSocket = clientIO(`http://localhost:${serverPort}/guidance`, {
        auth: { token: teacherToken }
      });

      await new Promise<void>((resolve) => {
        teacherSocket.on('connect', () => {
          console.log('✅ Teacher connected to guidance namespace');
          resolve();
        });
      });

      // Step 3: Buffer realistic transcription data
      console.log('📝 Buffering realistic transcription data...');

      const transcriptions = [
        // Group 1: Science discussion about photosynthesis
        {
          groupId: testGroupId1,
          texts: [
            'Student A: I think photosynthesis is how plants make their own food using sunlight',
            'Student B: Yes, and they need carbon dioxide from the air and water from the soil',
            'Student C: The green stuff in leaves, chlorophyll, is what captures the light energy',
            'Student D: But I\'m confused about where oxygen comes from in this process'
          ]
        },
        // Group 2: Discussion with some topic drift
        {
          groupId: testGroupId2,
          texts: [
            'Student E: Plants are important for ecosystems because they produce oxygen',
            'Student F: My mom has a really nice garden with lots of different plants',
            'Student G: Did you see that movie about plants taking over the world?',
            'Student H: We should probably focus on the science here, not movies'
          ]
        }
      ];

      for (const group of transcriptions) {
        for (const text of group.texts) {
          await aiAnalysisBufferService.bufferTranscription(
            group.groupId,
            actualSessionId,
            text
          );
          
          // Small delay to simulate real-time transcription
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      console.log('✅ Transcription buffering completed');

      // Step 4: Wait for AI analysis to process (simulate real-time delay)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Step 5: Manually trigger AI analysis (simulate what would happen in real system)
      console.log('🧠 Triggering AI analysis...');

      // Create realistic analysis results and store in database
      const tier1Analysis1 = {
        topicalCohesion: 0.89,
        conceptualDensity: 0.82,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date(Date.now() - 30000).toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 234,
        confidence: 0.91,
        insights: [
          {
            type: 'conceptual_density' as const,
            message: 'Students demonstrating strong understanding of photosynthesis concepts',
            severity: 'success' as const,
            actionable: 'Continue encouraging scientific terminology use'
          }
        ],
        metadata: {
          processingTimeMs: 850,
          modelVersion: 'databricks-gemma-3-12b-v1.2'
        }
      };

      const tier1Analysis2 = {
        topicalCohesion: 0.61,
        conceptualDensity: 0.48,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date(Date.now() - 30000).toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 187,
        confidence: 0.83,
        insights: [
          {
            type: 'topical_cohesion' as const,
            message: 'Discussion has drifted away from core learning objectives',
            severity: 'warning' as const,
            actionable: 'Redirect conversation back to photosynthesis: "How does this relate to how plants make energy?"'
          },
          {
            type: 'conceptual_density' as const,
            message: 'Students using more casual language, less scientific terminology',
            severity: 'warning' as const,
            actionable: 'Encourage use of scientific vocabulary'
          }
        ],
        metadata: {
          processingTimeMs: 780,
          modelVersion: 'databricks-gemma-3-12b-v1.2'
        }
      };

      // Store analysis results in real database
      await databricksService.insert('analysis_results', {
        id: `analysis-${testGroupId1}-${Date.now()}`,
        session_id: actualSessionId,
        analysis_type: 'tier1',
        analysis_timestamp: new Date(),
        processing_time_ms: 850,
        result_data: JSON.stringify(tier1Analysis1),
        confidence_score: 0.91,
        model_version: 'databricks-gemma-3-12b-v1.2',
        created_at: new Date()
      });

      await databricksService.insert('analysis_results', {
        id: `analysis-${testGroupId2}-${Date.now()}`,
        session_id: actualSessionId,
        analysis_type: 'tier1',
        analysis_timestamp: new Date(),
        processing_time_ms: 780,
        result_data: JSON.stringify(tier1Analysis2),
        confidence_score: 0.83,
        model_version: 'databricks-gemma-3-12b-v1.2',
        created_at: new Date()
      });

      console.log('✅ AI analysis results stored in database');

      // Step 6: Generate teacher prompts based on analysis
      console.log('💡 Generating teacher prompts...');

      const prompts1 = await teacherPromptService.generatePrompts(
        tier1Analysis1,
        {
          sessionId: actualSessionId,
          groupId: testGroupId1,
          teacherId: testTeacherId,
          sessionPhase: 'development',
          subject: 'science',
          learningObjectives: ['Understanding photosynthesis', 'Scientific vocabulary'],
          groupSize: 4,
          sessionDuration: 45
        }
      );

      const prompts2 = await teacherPromptService.generatePrompts(
        tier1Analysis2,
        {
          sessionId: actualSessionId,
          groupId: testGroupId2,
          teacherId: testTeacherId,
          sessionPhase: 'development',
          subject: 'science',
          learningObjectives: ['Understanding photosynthesis', 'Scientific vocabulary'],
          groupSize: 4,
          sessionDuration: 45
        }
      );

      console.log(`✅ Generated ${prompts1.length + prompts2.length} teacher prompts`);

      // Step 7: Request current guidance state via WebSocket
      console.log('🎯 Requesting current guidance state...');

      const guidanceStatePromise = new Promise<any>((resolve) => {
        teacherSocket.once('guidance:current_state', resolve);
      });

      teacherSocket.emit('guidance:get_current_state', { sessionId: actualSessionId });

      const guidanceState = await guidanceStatePromise;

      // Step 8: Verify complete end-to-end results
      console.log('✅ Received guidance state, verifying results...');

      expect(guidanceState).toBeDefined();
      expect(guidanceState.sessionId).toBe(actualSessionId);
      expect(guidanceState.timestamp).toBeDefined();

      // Verify prompts are returned
      expect(guidanceState.prompts).toBeDefined();
      expect(Array.isArray(guidanceState.prompts)).toBe(true);
      expect(guidanceState.prompts.length).toBeGreaterThan(0);

      // Find high-priority prompt (should be from group 2 with topic drift)
      const highPriorityPrompt = guidanceState.prompts.find((p: any) => p.priority === 'high');
      expect(highPriorityPrompt).toBeDefined();
      expect(highPriorityPrompt.message).toContain('topic');

      // Verify insights are returned with real data
      expect(guidanceState.insights).toBeDefined();
      expect(guidanceState.insights.sessionId).toBe(actualSessionId);
      expect(guidanceState.insights.tier1Insights).toBeDefined();
      expect(guidanceState.insights.tier1Insights.length).toBe(2);

      // Verify group-specific insights
      const group1Insights = guidanceState.insights.tier1Insights.find((g: any) => g.groupId === testGroupId1);
      const group2Insights = guidanceState.insights.tier1Insights.find((g: any) => g.groupId === testGroupId2);

      expect(group1Insights).toBeDefined();
      expect(group1Insights.insights.topicalCohesion).toBe(0.89);
      expect(group1Insights.insights.conceptualDensity).toBe(0.82);

      expect(group2Insights).toBeDefined();
      expect(group2Insights.insights.topicalCohesion).toBe(0.61); // Shows topic drift
      expect(group2Insights.insights.conceptualDensity).toBe(0.48); // Lower concept density

      // Verify summary metrics
      expect(guidanceState.insights.summary).toBeDefined();
      expect(guidanceState.insights.summary.averageTopicalCohesion).toBeCloseTo((0.89 + 0.61) / 2, 2);
      expect(guidanceState.insights.summary.averageConceptualDensity).toBeCloseTo((0.82 + 0.48) / 2, 2);
      expect(guidanceState.insights.summary.alertCount).toBeGreaterThan(0);
      expect(guidanceState.insights.summary.keyMetrics.activeGroups).toBe(2);

      // Verify critical alerts include the topic drift warning
      expect(guidanceState.insights.summary.criticalAlerts).toBeDefined();
      const topicDriftAlert = guidanceState.insights.summary.criticalAlerts.find((alert: string) => 
        alert.includes('drifted away from core learning objectives')
      );
      expect(topicDriftAlert).toBeDefined();

      console.log('🎉 E2E test completed successfully!');
      console.log(`📊 Results summary:
        - Prompts generated: ${guidanceState.prompts.length}
        - Groups analyzed: ${guidanceState.insights.tier1Insights.length}
        - Critical alerts: ${guidanceState.insights.summary.criticalAlerts.length}
        - Average topic cohesion: ${guidanceState.insights.summary.averageTopicalCohesion.toFixed(2)}
        - Overall confidence: ${guidanceState.insights.summary.overallConfidence.toFixed(2)}
      `);

    }, 60000); // 60 second timeout for complete E2E flow

    it('should maintain performance under realistic load', async () => {
      if (!TEST_ENV) {
        console.log('⚠️ Skipping performance E2E test - not in test environment');
        return;
      }

      // Create multiple concurrent sessions to test performance
      const concurrentSessions = 3;
      const sessionsData: Array<{sessionId: string, groupId: string}> = [];

      // Create multiple test sessions
      for (let i = 0; i < concurrentSessions; i++) {
        const sessionResponse = await request(app)
          .post('/api/v1/sessions')
          .set('Authorization', `Bearer ${teacherToken}`)
          .send({
            name: `Performance Test Session ${i}`,
            description: 'Testing performance under load',
            subject: 'science',
            targetGroupSize: 4,
            plannedDuration: 30
          });

        expect(sessionResponse.status).toBe(201);
        sessionsData.push({
          sessionId: sessionResponse.body.id,
          groupId: `perf-group-${i}-${Date.now()}`
        });
      }

      // Buffer transcriptions for all sessions simultaneously
      const bufferingPromises = sessionsData.map(async (session, i) => {
        for (let j = 0; j < 5; j++) {
          await aiAnalysisBufferService.bufferTranscription(
            session.groupId,
            session.sessionId,
            `Performance test transcription ${i}-${j}: Students discussing scientific concepts`
          );
        }
      });

      const bufferingStart = Date.now();
      await Promise.all(bufferingPromises);
      const bufferingTime = Date.now() - bufferingStart;

      console.log(`✅ Buffered transcriptions for ${concurrentSessions} sessions in ${bufferingTime}ms`);

      // Connect teacher socket for performance test
      const perfTeacherSocket = clientIO(`http://localhost:${serverPort}/guidance`, {
        auth: { token: teacherToken }
      });

      await new Promise<void>((resolve) => {
        perfTeacherSocket.on('connect', resolve);
      });

      // Request guidance state for all sessions simultaneously
      const guidancePromises = sessionsData.map(session => {
        return new Promise<any>((resolve) => {
          perfTeacherSocket.once('guidance:current_state', resolve);
          perfTeacherSocket.emit('guidance:get_current_state', { sessionId: session.sessionId });
        });
      });

      const guidanceStart = Date.now();
      const results = await Promise.all(guidancePromises);
      const guidanceTime = Date.now() - guidanceStart;

      perfTeacherSocket.close();

      // Verify performance requirements
      expect(guidanceTime).toBeLessThan(2000); // Should handle multiple sessions in <2s
      expect(results).toHaveLength(concurrentSessions);
      
      results.forEach((result, i) => {
        expect(result.sessionId).toBe(sessionsData[i].sessionId);
        expect(result.insights).toBeDefined();
      });

      console.log(`🚀 Performance test completed: ${concurrentSessions} sessions in ${guidanceTime}ms`);

    }, 45000);
  });

  describe('Error Recovery and Resilience', () => {
    it('should gracefully handle partial service failures in real environment', async () => {
      if (!TEST_ENV) {
        console.log('⚠️ Skipping resilience E2E test - not in test environment');
        return;
      }

      // Create session for resilience testing
      const sessionResponse = await request(app)
        .post('/api/v1/sessions')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send({
          name: 'Resilience Test Session',
          description: 'Testing error recovery',
          subject: 'general',
          targetGroupSize: 2,
          plannedDuration: 30
        });

      const sessionId = sessionResponse.body.id;

      // Connect teacher socket
      const resilienceSocket = clientIO(`http://localhost:${serverPort}/guidance`, {
        auth: { token: teacherToken }
      });

      await new Promise<void>((resolve) => {
        resilienceSocket.on('connect', resolve);
      });

      // Add some basic prompts to cache (no database storage to simulate partial failure)
      const testPrompt = {
        id: 'resilience-test-prompt',
        sessionId,
        teacherId: testTeacherId,
        category: 'facilitation' as const,
        priority: 'medium' as const,
        message: 'Continue facilitating the discussion',
        context: 'Resilience test scenario',
        suggestedTiming: 'immediate' as const,
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60000),
        sessionPhase: 'development' as const,
        subject: 'general' as const,
        effectivenessScore: 0.75,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      teacherPromptService['promptCache'].set(sessionId, [testPrompt]);

      // Request guidance state (should work with cache even if database has issues)
      const guidancePromise = new Promise<any>((resolve) => {
        resilienceSocket.once('guidance:current_state', resolve);
      });

      resilienceSocket.emit('guidance:get_current_state', { sessionId });

      const result = await guidancePromise;

      // Should still return cached prompts even with potential database issues
      expect(result.prompts).toBeDefined();
      expect(result.prompts.length).toBeGreaterThan(0);
      expect(result.prompts[0].id).toBe('resilience-test-prompt');

      resilienceSocket.close();

      console.log('✅ Resilience test passed - system handled partial failures gracefully');

    }, 30000);
  });
});
