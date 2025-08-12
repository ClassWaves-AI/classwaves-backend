/**
 * Integration Tests for Guidance Namespace with New Methods
 * 
 * Tests the complete integration of:
 * - TeacherPromptService.getActivePrompts()
 * - AIAnalysisBufferService.getCurrentInsights()
 * - GuidanceNamespaceService.handleGetCurrentState()
 * 
 * Uses real data patterns without mocks for comprehensive validation
 */

import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { io as clientIO, Socket as ClientSocket } from 'socket.io-client';
import { GuidanceNamespaceService } from '../../services/websocket/guidance-namespace.service';
import { aiAnalysisBufferService } from '../../services/ai-analysis-buffer.service';
import { teacherPromptService } from '../../services/teacher-prompt.service';
import { databricksService } from '../../services/databricks.service';
import type { TeacherPrompt } from '../../types/teacher-guidance.types';
import type { Tier1Insights, Tier2Insights } from '../../types/ai-analysis.types';

// Mock only databricks for controlled data
jest.mock('../../services/databricks.service');
const mockDatabricksService = databricksService as jest.Mocked<typeof databricksService>;

describe('Guidance Namespace Integration Tests', () => {
  let httpServer: HTTPServer;
  let io: SocketIOServer;
  let guidanceService: GuidanceNamespaceService;
  let teacherSocket: ClientSocket;
  let serverPort: number;

  const mockSessionId = '550e8400-e29b-41d4-a716-446655440001';
  const mockTeacherId = '550e8400-e29b-41d4-a716-446655440002';
  const mockGroupId1 = '550e8400-e29b-41d4-a716-446655440003';
  const mockGroupId2 = '550e8400-e29b-41d4-a716-446655440004';

  beforeAll(async () => {
    // Setup real HTTP server
    httpServer = new HTTPServer();
    io = new SocketIOServer(httpServer, {
      cors: { origin: "*", methods: ["GET", "POST"] }
    });

    // Initialize guidance namespace
    const guidanceNamespace = io.of('/guidance');
    guidanceService = new GuidanceNamespaceService(guidanceNamespace);

    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        serverPort = (httpServer.address() as any)?.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (teacherSocket) {
      teacherSocket.close();
    }
    httpServer.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Clear service state
    aiAnalysisBufferService['tier1Buffers'].clear();
    aiAnalysisBufferService['tier2Buffers'].clear();
    aiAnalysisBufferService['insightsCache'].clear();
    teacherPromptService['promptCache'].clear();

    // Mock JWT verification for teacher authentication
    jest.spyOn(require('jsonwebtoken'), 'verify').mockReturnValue({
      userId: mockTeacherId,
      role: 'teacher',
      schoolId: 'test-school'
    });

    // Mock databricks service responses
    mockDatabricksService.recordAuditLog.mockResolvedValue(undefined);
    mockDatabricksService.query.mockResolvedValue([]);
    mockDatabricksService.queryOne.mockResolvedValue(null);

    // Connect teacher socket
    teacherSocket = clientIO(`http://localhost:${serverPort}/guidance`, {
      auth: { token: 'mock-jwt-token' }
    });

    await new Promise<void>((resolve) => {
      teacherSocket.on('connect', resolve);
    });
  });

  afterEach(() => {
    if (teacherSocket) {
      teacherSocket.disconnect();
    }
  });

  describe('Real Data Integration Flow', () => {
    it('should integrate getActivePrompts and getCurrentInsights in guidance:get_current_state', async () => {
      const now = new Date();

      // Step 1: Setup realistic AI insights data in buffers
      const tier1Buffer1 = {
        transcripts: [
          { content: 'Student A: I think ecosystems are interconnected systems', timestamp: now, sequenceNumber: 1 },
          { content: 'Student B: Yes, like food webs and energy flow', timestamp: now, sequenceNumber: 2 },
          { content: 'Student C: But what about human impact on these systems?', timestamp: now, sequenceNumber: 3 }
        ],
        windowStart: new Date(now.getTime() - 30000),
        lastUpdate: new Date(now.getTime() - 5000),
        lastAnalysis: new Date(now.getTime() - 2000),
        groupId: mockGroupId1,
        sessionId: mockSessionId,
        sequenceCounter: 3
      };

      const tier1Buffer2 = {
        transcripts: [
          { content: 'Student D: Climate change affects biodiversity significantly', timestamp: now, sequenceNumber: 1 },
          { content: 'Student E: We need to consider conservation strategies', timestamp: now, sequenceNumber: 2 }
        ],
        windowStart: new Date(now.getTime() - 25000),
        lastUpdate: new Date(now.getTime() - 3000),
        lastAnalysis: new Date(now.getTime() - 1000),
        groupId: mockGroupId2,
        sessionId: mockSessionId,
        sequenceCounter: 2
      };

      aiAnalysisBufferService['tier1Buffers'].set(`${mockSessionId}:${mockGroupId1}`, tier1Buffer1);
      aiAnalysisBufferService['tier1Buffers'].set(`${mockSessionId}:${mockGroupId2}`, tier1Buffer2);

      // Step 2: Setup realistic teacher prompts in cache and database
      const cachedPrompts: TeacherPrompt[] = [
        {
          id: 'prompt-high-priority',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          groupId: mockGroupId1,
          category: 'redirection',
          priority: 'high',
          message: 'Guide the discussion back to ecosystem structure. Ask: "How do these concepts relate to our ecosystem diagram?"',
          context: 'Group showing some topic drift from main learning objective',
          suggestedTiming: 'immediate',
          generatedAt: new Date(now.getTime() - 3 * 60000),
          expiresAt: new Date(now.getTime() + 27 * 60000),
          sessionPhase: 'development',
          subject: 'science',
          targetMetric: 'topicalCohesion',
          effectivenessScore: 0.87,
          createdAt: new Date(now.getTime() - 3 * 60000),
          updatedAt: new Date(now.getTime() - 3 * 60000)
        },
        {
          id: 'prompt-medium-priority',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          groupId: mockGroupId2,
          category: 'deepening',
          priority: 'medium',
          message: 'Encourage students to provide specific examples. Try: "Can you give a concrete example of that concept?"',
          context: 'Discussion could benefit from more concrete examples',
          suggestedTiming: 'next_break',
          generatedAt: new Date(now.getTime() - 5 * 60000),
          expiresAt: new Date(now.getTime() + 25 * 60000),
          sessionPhase: 'development',
          subject: 'science',
          targetMetric: 'conceptualDensity',
          effectivenessScore: 0.73,
          createdAt: new Date(now.getTime() - 5 * 60000),
          updatedAt: new Date(now.getTime() - 5 * 60000)
        }
      ];

      teacherPromptService['promptCache'].set(mockSessionId, cachedPrompts);

      // Step 3: Setup realistic AI analysis results in mock database
      const tier1Analysis1: Tier1Insights = {
        topicalCohesion: 0.73,
        conceptualDensity: 0.84,
        analysisTimestamp: new Date(now.getTime() - 2000).toISOString(),
        windowStartTime: new Date(now.getTime() - 30000).toISOString(),
        windowEndTime: now.toISOString(),
        transcriptLength: 124,
        confidence: 0.89,
        insights: [
          {
            type: 'conceptual_density',
            message: 'Students are using sophisticated scientific vocabulary',
            severity: 'success',
            actionable: 'Continue encouraging use of technical terms'
          },
          {
            type: 'topical_cohesion',
            message: 'Some minor deviation from core ecosystem concepts',
            severity: 'warning',
            actionable: 'Gently redirect to ecosystem structure'
          }
        ],
        metadata: {
          processingTimeMs: 890,
          modelVersion: 'databricks-gemma-3-12b-v1.2'
        }
      };

      const tier1Analysis2: Tier1Insights = {
        topicalCohesion: 0.91,
        conceptualDensity: 0.76,
        analysisTimestamp: new Date(now.getTime() - 1000).toISOString(),
        windowStartTime: new Date(now.getTime() - 25000).toISOString(),
        windowEndTime: now.toISOString(),
        transcriptLength: 87,
        confidence: 0.85,
        insights: [
          {
            type: 'topical_cohesion',
            message: 'Excellent focus on environmental science concepts',
            severity: 'success',
            actionable: 'Acknowledge students\' strong conceptual understanding'
          }
        ],
        metadata: {
          processingTimeMs: 720,
          modelVersion: 'databricks-gemma-3-12b-v1.2'
        }
      };

      const tier2Analysis: Tier2Insights = {
        argumentationQuality: {
          score: 0.81,
          claimEvidence: 0.84,
          logicalFlow: 0.79,
          counterarguments: 0.72,
          synthesis: 0.89
        },
        collectiveEmotionalArc: {
          trajectory: 'ascending',
          averageEngagement: 0.87,
          energyPeaks: [now.getTime() - 120000, now.getTime() - 60000],
          sentimentFlow: [
            { timestamp: new Date(now.getTime() - 180000).toISOString(), sentiment: 0.4, confidence: 0.8 },
            { timestamp: new Date(now.getTime() - 120000).toISOString(), sentiment: 0.6, confidence: 0.85 },
            { timestamp: new Date(now.getTime() - 60000).toISOString(), sentiment: 0.8, confidence: 0.9 }
          ]
        },
        collaborationPatterns: {
          turnTaking: 0.85,
          buildingOnIdeas: 0.88,
          conflictResolution: 0.78,
          inclusivity: 0.71
        },
        learningSignals: {
          conceptualGrowth: 0.86,
          questionQuality: 0.82,
          metacognition: 0.74,
          knowledgeApplication: 0.91
        },
        analysisTimestamp: new Date(now.getTime() - 30000).toISOString(),
        sessionStartTime: new Date(now.getTime() - 1800000).toISOString(),
        analysisEndTime: now.toISOString(),
        totalTranscriptLength: 1456,
        groupsAnalyzed: [mockGroupId1, mockGroupId2],
        confidence: 0.86,
        recommendations: [
          {
            type: 'praise',
            priority: 'medium',
            message: 'Students are demonstrating excellent collaborative learning',
            suggestedAction: 'Acknowledge the quality of their group work',
            targetGroups: [mockGroupId1, mockGroupId2]
          },
          {
            type: 'intervention',
            priority: 'high',
            message: 'Consider strategies to increase participation from quieter students',
            suggestedAction: 'Use targeted questioning to engage all voices',
            targetGroups: [mockGroupId2]
          }
        ]
      };

      // Mock database responses for insights
      mockDatabricksService.queryOne
        .mockResolvedValueOnce({ result_data: JSON.stringify(tier1Analysis1) }) // Group 1 Tier 1
        .mockResolvedValueOnce({ result_data: JSON.stringify(tier1Analysis2) }) // Group 2 Tier 1
        .mockResolvedValueOnce({ result_data: JSON.stringify(tier2Analysis) }); // Session Tier 2

      // Step 4: Execute the guidance request
      const responsePromise = new Promise<any>((resolve) => {
        teacherSocket.once('guidance:current_state', resolve);
      });

      teacherSocket.emit('guidance:get_current_state', { sessionId: mockSessionId });

      const response = await responsePromise;

      // Step 5: Verify comprehensive integration results
      expect(response).toBeDefined();
      expect(response.sessionId).toBe(mockSessionId);
      expect(response.timestamp).toBeDefined();

      // Verify prompts integration
      expect(response.prompts).toHaveLength(2);
      const highPriorityPrompt = response.prompts.find((p: any) => p.priority === 'high');
      const mediumPriorityPrompt = response.prompts.find((p: any) => p.priority === 'medium');

      expect(highPriorityPrompt).toBeDefined();
      expect(highPriorityPrompt.message).toContain('ecosystem diagram');
      expect(highPriorityPrompt.groupId).toBe(mockGroupId1);

      expect(mediumPriorityPrompt).toBeDefined();
      expect(mediumPriorityPrompt.message).toContain('concrete example');
      expect(mediumPriorityPrompt.groupId).toBe(mockGroupId2);

      // Verify insights integration
      expect(response.insights).toBeDefined();
      expect(response.insights.sessionId).toBe(mockSessionId);
      expect(response.insights.tier1Insights).toHaveLength(2);
      expect(response.insights.tier2Insights).toBeDefined();

      // Verify tier1 insights for each group
      const group1Insights = response.insights.tier1Insights.find((g: any) => g.groupId === mockGroupId1);
      const group2Insights = response.insights.tier1Insights.find((g: any) => g.groupId === mockGroupId2);

      expect(group1Insights.insights.topicalCohesion).toBe(0.73);
      expect(group1Insights.insights.conceptualDensity).toBe(0.84);
      expect(group1Insights.bufferInfo.transcriptCount).toBe(3);

      expect(group2Insights.insights.topicalCohesion).toBe(0.91);
      expect(group2Insights.insights.conceptualDensity).toBe(0.76);
      expect(group2Insights.bufferInfo.transcriptCount).toBe(2);

      // Verify tier2 insights
      expect(response.insights.tier2Insights.insights.argumentationQuality.score).toBe(0.81);
      expect(response.insights.tier2Insights.insights.collaborationPatterns.inclusivity).toBe(0.71);
      expect(response.insights.tier2Insights.insights.recommendations).toHaveLength(2);

      // Verify summary metrics
      expect(response.insights.summary.averageTopicalCohesion).toBeCloseTo((0.73 + 0.91) / 2, 2);
      expect(response.insights.summary.averageConceptualDensity).toBeCloseTo((0.84 + 0.76) / 2, 2);
      expect(response.insights.summary.alertCount).toBe(4); // 3 tier1 insights + 2 tier2 recommendations
      expect(response.insights.summary.keyMetrics.activeGroups).toBe(2);
      expect(response.insights.summary.keyMetrics.totalTranscripts).toBe(5);

      // Verify critical alerts
      expect(response.insights.summary.criticalAlerts).toContain('Group group-001: Some minor deviation from core ecosystem concepts');
      expect(response.insights.summary.criticalAlerts).toContain('Session: Consider strategies to increase participation from quieter students');

      // Verify compliance auditing was called
      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'teacher_prompt_access',
          actorId: 'system'
        })
      );

      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'ai_insights_access',
          actorId: 'system'
        })
      );
    });

    it('should handle graceful degradation when services partially fail', async () => {
      // Setup scenario where prompts work but insights fail
      const cachedPrompts: TeacherPrompt[] = [
        {
          id: 'working-prompt',
          sessionId: mockSessionId,
          teacherId: mockTeacherId,
          category: 'facilitation',
          priority: 'medium',
          message: 'Continue facilitating the discussion',
          context: 'Group discussion flowing well',
          suggestedTiming: 'next_break',
          generatedAt: new Date(Date.now() - 2 * 60000),
          expiresAt: new Date(Date.now() + 28 * 60000),
          sessionPhase: 'development',
          subject: 'general',
          effectivenessScore: 0.8,
          createdAt: new Date(Date.now() - 2 * 60000),
          updatedAt: new Date(Date.now() - 2 * 60000)
        }
      ];

      teacherPromptService['promptCache'].set(mockSessionId, cachedPrompts);

      // Mock insights failure
      mockDatabricksService.queryOne.mockRejectedValue(new Error('Database connection failed'));

      const responsePromise = new Promise<any>((resolve) => {
        teacherSocket.once('guidance:current_state', resolve);
      });

      teacherSocket.emit('guidance:get_current_state', { sessionId: mockSessionId });

      const response = await responsePromise;

      // Should still return prompts
      expect(response.prompts).toHaveLength(1);
      expect(response.prompts[0].id).toBe('working-prompt');

      // Should return empty insights gracefully
      expect(response.insights).toEqual({});
    });

    it('should handle complete service failures with appropriate error response', async () => {
      // Mock complete failure
      mockDatabricksService.query.mockRejectedValue(new Error('Complete system failure'));
      mockDatabricksService.queryOne.mockRejectedValue(new Error('Complete system failure'));

      const errorPromise = new Promise<any>((resolve) => {
        teacherSocket.once('error', resolve);
      });

      teacherSocket.emit('guidance:get_current_state', { sessionId: mockSessionId });

      const errorResponse = await errorPromise;

      expect(errorResponse.code).toBe('STATE_FETCH_FAILED');
      expect(errorResponse.message).toBe('Failed to fetch current guidance state');
    });
  });

  describe('Performance and Real-time Requirements', () => {
    it('should meet <500ms response time requirement for real-time guidance', async () => {
      // Setup minimal but realistic data
      const prompt: TeacherPrompt = {
        id: 'performance-test-prompt',
        sessionId: mockSessionId,
        teacherId: mockTeacherId,
        category: 'energy',
        priority: 'high',
        message: 'Quick guidance prompt',
        context: 'Performance test scenario',
        suggestedTiming: 'immediate',
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60000),
        sessionPhase: 'development',
        subject: 'general',
        effectivenessScore: 0.75,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      teacherPromptService['promptCache'].set(mockSessionId, [prompt]);

      // Use cache for insights
      const cachedInsights = {
        sessionId: mockSessionId,
        lastUpdated: new Date(),
        tier1Insights: [],
        summary: {
          overallConfidence: 0.8,
          averageTopicalCohesion: 0.75,
          averageConceptualDensity: 0.8,
          alertCount: 1,
          keyMetrics: { activeGroups: 1, totalTranscripts: 5, recentAnalyses: 1 },
          criticalAlerts: ['Performance test alert']
        },
        metadata: { dataAge: 0, cacheHit: false, processingTime: 0 }
      };

      aiAnalysisBufferService['insightsCache'].set(mockSessionId, {
        insights: cachedInsights,
        timestamp: new Date()
      });

      const startTime = Date.now();

      const responsePromise = new Promise<any>((resolve) => {
        teacherSocket.once('guidance:current_state', resolve);
      });

      teacherSocket.emit('guidance:get_current_state', { sessionId: mockSessionId });

      const response = await responsePromise;
      const responseTime = Date.now() - startTime;

      // Verify sub-500ms requirement
      expect(responseTime).toBeLessThan(500);
      expect(response.prompts).toHaveLength(1);
      expect(response.insights.summary.overallConfidence).toBe(0.8);
    });
  });

  describe('FERPA/COPPA Compliance Integration', () => {
    it('should maintain audit trail throughout complete guidance flow', async () => {
      teacherPromptService['promptCache'].set(mockSessionId, []);
      mockDatabricksService.queryOne.mockResolvedValue(null);

      const responsePromise = new Promise<any>((resolve) => {
        teacherSocket.once('guidance:current_state', resolve);
      });

      teacherSocket.emit('guidance:get_current_state', { sessionId: mockSessionId });

      await responsePromise;

      // Verify both services logged audit events
      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'teacher_prompt_access',
          actorId: 'system',
          eventCategory: 'data_access',
          resourceType: 'teacher_guidance',
          resourceId: mockSessionId,
          complianceBasis: 'legitimate_interest',
          description: expect.stringContaining('Retrieve active teacher prompts')
        })
      );

      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'ai_insights_access',
          actorId: 'system',
          eventCategory: 'data_access',
          resourceType: 'session_insights',
          resourceId: mockSessionId,
          complianceBasis: 'legitimate_interest',
          description: expect.stringContaining('Retrieve current AI insights')
        })
      );
    });
  });
});
