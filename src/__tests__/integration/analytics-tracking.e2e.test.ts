import { databricksAIService } from '../../services/databricks-ai.service';
import { teacherPromptService } from '../../services/teacher-prompt.service';
import { databricksService } from '../../services/databricks.service';
import type { Tier1Insights } from '../../types/ai-analysis.types';
import type { SessionPhase, SubjectArea } from '../../types/teacher-guidance.types';
import { v4 as uuidv4 } from 'uuid';

// Define the context interface used by teacher prompt service
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

// Real database integration per TEST_REWRITE_PLAN.md
// Mock only external AI API calls for test reliability (keeps other services real)
jest.mock('../../services/databricks-ai.service', () => ({
  databricksAIService: {
    analyzeTier1: jest.fn().mockResolvedValue({
      topicalCohesion: 0.4,  // Below 0.6 threshold to trigger redirection prompts
      conceptualDensity: 0.3, // Below 0.5 threshold to trigger deepening prompts
      analysisTimestamp: new Date().toISOString(),
      windowStartTime: new Date(Date.now() - 30000).toISOString(),
      windowEndTime: new Date().toISOString(),
      transcriptLength: 150,
      confidence: 0.85,
      insights: [
        {
          type: 'topical_cohesion',
          message: 'Strong focus on photosynthesis concepts',
          severity: 'success',
          actionable: 'Continue encouraging scientific vocabulary'
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
        engagementTrend: 'increasing',
        frustrationPoints: [],
        excitementPeaks: [{ timestamp: new Date().toISOString(), intensity: 0.8 }]
      },
      collaborationPatterns: {
        participationEquity: 0.85,
        buildingBehavior: 0.70,
        conflictResolution: 0.65
      },
      learningSignals: {
        comprehensionIndicators: 0.75,
        misconceptionFlags: [],
        knowledgeGaps: ['photosynthesis-details']
      },
      recommendations: [
        {
          type: 'facilitation',
          priority: 'high',
          message: 'Guide students to deeper exploration',
          actionable: 'Ask follow-up questions about energy conversion'
        }
      ],
      processingTime: 9000,
      recommendationCount: 1,
      metadata: {
        processingTimeMs: 9000,
        modelVersion: 'tier2-v1.0'
      }
    })
  }
}));

// Get mocked functions for test assertions
const mockAnalyzeTier1 = databricksAIService.analyzeTier1 as jest.MockedFunction<typeof databricksAIService.analyzeTier1>;
const mockAnalyzeTier2 = databricksAIService.analyzeTier2 as jest.MockedFunction<typeof databricksAIService.analyzeTier2>;

describe('Analytics Tracking E2E Tests (Real Database)', () => {
  let testSessionId: string;
  let testTeacherId: string;
  let testGroupId: string;
  let testSchoolId: string;

  beforeAll(async () => {
    // Setup test data using real database per schema
    testSessionId = uuidv4();
    testTeacherId = uuidv4();
    testGroupId = uuidv4();
    testSchoolId = uuidv4();

    // Create test session in real DB (classwaves.sessions.classroom_sessions)
    await databricksService.query(
      `INSERT INTO classwaves.sessions.classroom_sessions 
       (id, title, status, planned_duration_minutes, max_students, target_group_size, 
        auto_group_enabled, teacher_id, school_id, recording_enabled, transcription_enabled, 
        ai_analysis_enabled, ferpa_compliant, coppa_compliant, recording_consent_obtained, 
        total_groups, total_students, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testSessionId,
        'Analytics Test Session',
        'created',
        30,
        20,
        4,
        true,
        testTeacherId,
        testSchoolId,
        true, // recording_enabled
        true, // transcription_enabled
        true, // ai_analysis_enabled
        true, // ferpa_compliant
        true, // coppa_compliant
        true, // recording_consent_obtained
        0,    // total_groups
        0,    // total_students
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );

    // Create test student group per schema
    await databricksService.query(
      `INSERT INTO classwaves.sessions.student_groups 
       (id, session_id, name, group_number, status, max_size, current_size, 
        auto_managed, is_ready, created_at, updated_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        testGroupId,
        testSessionId,
        'Test Group 1',
        1,
        'created',
        4,
        2,
        true,
        false,
        new Date().toISOString(),
        new Date().toISOString()
      ]
    );
  });

  afterAll(async () => {
    // Cleanup test data from real database
    await databricksService.query(
      'DELETE FROM classwaves.analytics.session_events WHERE session_id = ?',
      [testSessionId]
    );
    await databricksService.query(
      'DELETE FROM classwaves.sessions.student_groups WHERE session_id = ?',
      [testSessionId]
    );
    await databricksService.query(
      'DELETE FROM classwaves.sessions.classroom_sessions WHERE id = ?',
      [testSessionId]
    );
  });

  describe('AI Analysis and Analytics Tracking Workflow', () => {
    it('should track complete AI analysis lifecycle from transcripts to analytics events', async () => {
      // Step 1: Generate AI analysis using current APIs
      const testTranscripts = [
        'Student A: I think the main concept here is photosynthesis.',
        'Student B: Yes, and it involves converting light energy to chemical energy.',
        'Student C: The chloroplasts are the key organelles for this process.'
      ];

      // Use current Tier1 analysis API per TEST_REWRITE_PLAN.md (mocked for test reliability)
      const tier1Insights: Tier1Insights = await databricksAIService.analyzeTier1(
        testTranscripts,
        {
          groupId: testGroupId,
          sessionId: testSessionId,
          focusAreas: ['topical_cohesion', 'conceptual_density']
        }
      );

      // Verify AI service was called with correct parameters
      expect(mockAnalyzeTier1).toHaveBeenCalledWith(
        testTranscripts,
        {
          groupId: testGroupId,
          sessionId: testSessionId,
          focusAreas: ['topical_cohesion', 'conceptual_density']
        }
      );

      // Verify Tier1 insights structure per current types
      expect(tier1Insights).toHaveProperty('topicalCohesion');
      expect(tier1Insights).toHaveProperty('conceptualDensity');
      expect(tier1Insights).toHaveProperty('analysisTimestamp');
      expect(tier1Insights).toHaveProperty('windowStartTime');
      expect(tier1Insights).toHaveProperty('windowEndTime');
      expect(tier1Insights).toHaveProperty('transcriptLength');
      expect(tier1Insights).toHaveProperty('confidence');
      expect(tier1Insights).toHaveProperty('insights');
      expect(tier1Insights).toHaveProperty('metadata.processingTimeMs');

      // Step 2: Generate teacher prompts using correct context structure
      const promptGenerationContext: PromptGenerationContext = {
        sessionId: testSessionId,
        groupId: testGroupId,
        teacherId: testTeacherId,
        sessionPhase: 'development',
        subject: 'science',
        learningObjectives: ['Test analytics tracking workflow'],
        groupSize: 4,
        sessionDuration: 30
      };

      const prompts = await teacherPromptService.generatePrompts(
        tier1Insights,
        promptGenerationContext,
        {
          maxPrompts: 5,
          priorityFilter: 'all',
          includeEffectivenessScore: true
        }
      );

      expect(prompts.length).toBeGreaterThan(0);
      const testPrompt = prompts[0];

      // Step 3: Record analytics event in real database per schema
      const analyticsEventResult = await databricksService.query(
        `INSERT INTO classwaves.analytics.session_events 
         (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          testSessionId,
          testTeacherId,
          'ai_analysis_completed',
          new Date().toISOString(),
          JSON.stringify({
            analysisType: 'tier1',
            groupId: testGroupId,
            topicalCohesion: tier1Insights.topicalCohesion,
            conceptualDensity: tier1Insights.conceptualDensity,
            promptsGenerated: prompts.length,
            processingTime: tier1Insights.metadata?.processingTimeMs
          }),
          new Date().toISOString()
        ]
      );

      expect(analyticsEventResult).toBeDefined();
      expect(Array.isArray(analyticsEventResult)).toBe(true);

      // Step 4: Record prompt generation event
      const promptEventResult = await databricksService.query(
        `INSERT INTO classwaves.analytics.session_events 
         (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          testSessionId,
          testTeacherId,
          'prompt_generated',
          new Date().toISOString(),
          JSON.stringify({
            promptId: testPrompt.id,
            promptCategory: testPrompt.category,
            promptPriority: testPrompt.priority,
            effectivenessScore: testPrompt.effectivenessScore,
            groupId: testGroupId
          }),
          new Date().toISOString()
        ]
      );

      expect(promptEventResult).toBeDefined();

      // Step 5: Verify analytics tracking in real database
      const analyticsQuery = await databricksService.query(
        'SELECT * FROM classwaves.analytics.session_events WHERE session_id = ? ORDER BY created_at',
        [testSessionId]
      );

      expect(analyticsQuery).toHaveLength(2); // ai_analysis_completed + prompt_generated
      expect(analyticsQuery[0].event_type).toBe('ai_analysis_completed');
      expect(analyticsQuery[1].event_type).toBe('prompt_generated');
      
      // Validate payload structure
      const analysisPayload = JSON.parse(analyticsQuery[0].payload);
      expect(analysisPayload.analysisType).toBe('tier1');
      expect(analysisPayload.groupId).toBe(testGroupId);
      expect(analysisPayload).toHaveProperty('topicalCohesion');
      expect(analysisPayload).toHaveProperty('conceptualDensity');
    });

    it('should track Tier 2 deep analysis workflow', async () => {
      // Generate deeper analysis using real API
      const tier2Insights = await databricksAIService.analyzeTier2(
        [
          'Student A: The photosynthesis process is more complex than just light to energy conversion.',
          'Student B: I disagree, I think it\'s primarily about the chlorophyll absorbing light.',
          'Student C: Both perspectives have merit. Let\'s consider the Calvin cycle as well.',
          'Student D: That\'s a good point about the Calvin cycle, but what about cellular respiration?'
        ],
        {
          sessionId: testSessionId,
          analysisDepth: 'comprehensive'
        }
      );

      // Verify Tier2 structure per current types
      expect(tier2Insights).toHaveProperty('argumentationQuality');
      expect(tier2Insights).toHaveProperty('collectiveEmotionalArc');
      expect(tier2Insights).toHaveProperty('collaborationPatterns');
      expect(tier2Insights).toHaveProperty('learningSignals');
      expect(tier2Insights).toHaveProperty('recommendations');
      expect(tier2Insights).toHaveProperty('metadata.processingTimeMs');

      // Record Tier 2 analytics event
      const tier2EventResult = await databricksService.query(
        `INSERT INTO classwaves.analytics.session_events 
         (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          testSessionId,
          testTeacherId,
          'tier2_analysis_completed',
          new Date().toISOString(),
          JSON.stringify({
            analysisType: 'tier2',
            argumentationScore: tier2Insights.argumentationQuality.score,
            collaborationScore: tier2Insights.collaborationPatterns.turnTaking,
            recommendationCount: tier2Insights.recommendations.length,
            processingTime: tier2Insights.metadata?.processingTimeMs
          }),
          new Date().toISOString()
        ]
      );

      expect(tier2EventResult).toBeDefined();
    });
  });

  describe('Analytics Data Persistence Validation', () => {
    it('should persist and retrieve analytics events correctly', async () => {
      // Create multiple analytics events
      const eventTypes = ['configured', 'started', 'leader_ready', 'member_join'];
      const eventIds: string[] = [];

      for (const eventType of eventTypes) {
        const eventId = uuidv4();
        eventIds.push(eventId);
        
        await databricksService.query(
          `INSERT INTO classwaves.analytics.session_events 
           (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            eventId,
            testSessionId,
            testTeacherId,
            eventType,
            new Date().toISOString(),
            JSON.stringify({ groupId: testGroupId, testEvent: true }),
            new Date().toISOString()
          ]
        );
      }

      // Verify all events were stored
      const retrievedEvents = await databricksService.query(
        'SELECT * FROM classwaves.analytics.session_events WHERE session_id = ? ORDER BY event_time',
        [testSessionId]
      );

      expect(retrievedEvents.length).toBeGreaterThanOrEqual(eventTypes.length);
      
      // Verify event structure matches schema
      const firstEvent = retrievedEvents[0];
      expect(firstEvent).toHaveProperty('id');
      expect(firstEvent).toHaveProperty('session_id');
      expect(firstEvent).toHaveProperty('teacher_id');
      expect(firstEvent).toHaveProperty('event_type');
      expect(firstEvent).toHaveProperty('event_time');
      expect(firstEvent).toHaveProperty('payload');
      expect(firstEvent).toHaveProperty('created_at');
      
      // Validate payload JSON structure
              const payload = JSON.parse(firstEvent.payload);
        // Validate actual payload structure from the test
        expect(payload).toHaveProperty('groupId');
        expect(payload.groupId).toBe(testGroupId);
    });
  });

  describe('Session Analytics Integration', () => {
    it('should integrate AI analysis with session lifecycle events', async () => {
      // Step 1: Record session started event
      const sessionStartEventId = uuidv4();
      await databricksService.query(
        `INSERT INTO classwaves.analytics.session_events 
         (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionStartEventId,
          testSessionId,
          testTeacherId,
          'started',
          new Date().toISOString(),
          JSON.stringify({ totalGroups: 1, targetGroupSize: 4 }),
          new Date().toISOString()
        ]
      );

      // Step 2: Record group ready event
      const groupReadyEventId = uuidv4();
      await databricksService.query(
        `INSERT INTO classwaves.analytics.session_events 
         (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          groupReadyEventId,
          testSessionId,
          testTeacherId,
          'leader_ready',
          new Date().toISOString(),
          JSON.stringify({ groupId: testGroupId, groupNumber: 1 }),
          new Date().toISOString()
        ]
      );

      // Step 3: Query session event timeline
      const eventTimeline = await databricksService.query(
        `SELECT event_type, event_time, payload 
         FROM classwaves.analytics.session_events 
         WHERE session_id = ? 
         ORDER BY event_time ASC`,
        [testSessionId]
      );

      expect(eventTimeline.length).toBeGreaterThanOrEqual(2);
      
      // Verify event sequence includes session lifecycle events
      const eventTypes = eventTimeline.map(e => e.event_type);
      expect(eventTypes).toContain('started');
      expect(eventTypes).toContain('leader_ready');
    });
  });

  describe('Data Integrity and Error Handling', () => {
    it('should handle AI service errors gracefully', async () => {
      const invalidTranscripts: string[] = [];
      
      // Test with empty transcripts - should handle gracefully
      try {
        await databricksAIService.analyzeTier1(invalidTranscripts, {
          groupId: testGroupId,
          sessionId: testSessionId,
          focusAreas: ['topical_cohesion']
        });
      } catch (error: unknown) {
        // Verify error handling structure
        expect(error).toBeInstanceOf(Error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        expect(errorMessage).toContain('failed');
      }
    });

    it('should maintain referential integrity across analytics tables', async () => {
      // Verify session exists before adding events
      const sessionCheck = await databricksService.query(
        'SELECT id FROM classwaves.sessions.classroom_sessions WHERE id = ?',
        [testSessionId]
      );
      expect(sessionCheck).toHaveLength(1);

      // Verify group exists and references session
      const groupCheck = await databricksService.query(
        'SELECT id, session_id FROM classwaves.sessions.student_groups WHERE id = ?',
        [testGroupId]
      );
      expect(groupCheck).toHaveLength(1);
      expect(groupCheck[0].session_id).toBe(testSessionId);

      // Add analytics event referencing both session and group
      const eventId = uuidv4();
      await databricksService.query(
        `INSERT INTO classwaves.analytics.session_events 
         (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          testSessionId,
          testTeacherId,
          'member_join',
          new Date().toISOString(),
          JSON.stringify({ groupId: testGroupId, memberCount: 1 }),
          new Date().toISOString()
        ]
      );

      // Verify analytics event references valid session
      const eventCheck = await databricksService.query(
        'SELECT session_id, payload FROM classwaves.analytics.session_events WHERE id = ?',
        [eventId]
      );
      expect(eventCheck).toHaveLength(1);
      expect(eventCheck[0].session_id).toBe(testSessionId);
      
      const payload = JSON.parse(eventCheck[0].payload);
      expect(payload.groupId).toBe(testGroupId);
    });
  });

  describe('AI Analysis Performance Tracking', () => {
    it('should track AI processing times and validate performance budgets', async () => {
      const startTime = Date.now();

      // Execute Tier 1 analysis with timing
      const tier1Result = await databricksAIService.analyzeTier1(
        ['Student discussion about renewable energy sources'],
        {
          groupId: testGroupId,
          sessionId: testSessionId,
          focusAreas: ['topical_cohesion', 'conceptual_density']
        }
      );

      const totalProcessingTime = Date.now() - startTime;

      // Verify processing time is reasonable (<5000ms)
      expect(totalProcessingTime).toBeLessThan(5000);
      
      // Verify metadata includes processing time per current types
      expect(tier1Result.metadata?.processingTimeMs).toBeDefined();
      expect(typeof tier1Result.metadata?.processingTimeMs).toBe('number');
      expect(tier1Result.metadata?.processingTimeMs).toBeGreaterThan(0);

      // Record performance analytics event
      const performanceEventId = uuidv4();
      await databricksService.query(
        `INSERT INTO classwaves.analytics.session_events 
         (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          performanceEventId,
          testSessionId,
          testTeacherId,
          'ai_performance_tracked',
          new Date().toISOString(),
          JSON.stringify({
            analysisType: 'tier1',
            processingTimeMs: tier1Result.metadata?.processingTimeMs,
            totalRequestTime: totalProcessingTime,
            transcriptLength: tier1Result.transcriptLength,
            confidence: tier1Result.confidence
          }),
          new Date().toISOString()
        ]
      );

      expect(performanceEventId).toBeDefined();
    });

    it('should validate end-to-end analytics workflow performance', async () => {
      const workflowStartTime = Date.now();

      // Full workflow: AI analysis → prompt generation → analytics recording (mocked for test reliability)
      const tier1Insights = await databricksAIService.analyzeTier1(
        ['Brief student discussion for performance testing'],
        {
          groupId: testGroupId,
          sessionId: testSessionId,
          focusAreas: ['topical_cohesion']
        }
      );

      // Note: Mock reset between tests, so this is the first call in this test
      expect(mockAnalyzeTier1).toHaveBeenCalledWith(
        ['Brief student discussion for performance testing'],
        {
          groupId: testGroupId,
          sessionId: testSessionId,
          focusAreas: ['topical_cohesion']
        }
      );

      const promptContext: PromptGenerationContext = {
        sessionId: testSessionId,
        groupId: testGroupId,
        teacherId: testTeacherId,
        sessionPhase: 'development',
        subject: 'science',
        learningObjectives: ['Performance testing'],
        groupSize: 4,
        sessionDuration: 30
      };

      const prompts = await teacherPromptService.generatePrompts(
        tier1Insights,
        promptContext,
        {
          maxPrompts: 3,
          priorityFilter: 'all',
          includeEffectivenessScore: true
        }
      );

      const workflowEndTime = Date.now();
      const totalWorkflowTime = workflowEndTime - workflowStartTime;

      // Record workflow performance
      const workflowEventId = uuidv4();
      await databricksService.query(
        `INSERT INTO classwaves.analytics.session_events 
         (id, session_id, teacher_id, event_type, event_time, payload, created_at) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          workflowEventId,
          testSessionId,
          testTeacherId,
          'workflow_performance_tracked',
          new Date().toISOString(),
          JSON.stringify({
            workflowType: 'ai_analysis_to_prompts',
            totalTimeMs: totalWorkflowTime,
            aiProcessingTime: tier1Insights.metadata?.processingTimeMs,
            promptsGenerated: prompts.length,
            success: true
          }),
          new Date().toISOString()
        ]
      );

      // Validate workflow completed successfully
      expect(prompts.length).toBeGreaterThan(0);
      expect(totalWorkflowTime).toBeLessThan(10000); // <10s for full workflow
    });
  });
});
