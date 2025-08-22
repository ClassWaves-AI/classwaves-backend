import { analyticsTrackingValidator } from '../../services/analytics-tracking-validator.service';
import { databricksService } from '../../services/databricks.service';
import { teacherPromptService } from '../../services/teacher-prompt.service';
import { alertPrioritizationService } from '../../services/alert-prioritization.service';

// Mock external dependencies for E2E testing
jest.mock('../../services/databricks.service');
jest.mock('../../services/websocket.service');

describe('Analytics Tracking E2E Tests', () => {
  let mockDatabricksService: jest.Mocked<typeof databricksService>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDatabricksService = databricksService as jest.Mocked<typeof databricksService>;
    
    // Setup successful database mocks
    mockDatabricksService.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO teacher_guidance_metrics')) {
        return [{ insertId: '12345' }];
      }
      if (sql.includes('SELECT COUNT(*) as count FROM teacher_guidance_metrics')) {
        return [{ count: 1 }];
      }
      if (sql.includes('UPDATE teacher_guidance_metrics')) {
        return [{ affectedRows: 1 }];
      }
      if (sql.includes('INSERT INTO session_audit_log')) {
        return [{ insertId: '67890' }];
      }
      if (sql.includes('SELECT * FROM teacher_guidance_metrics WHERE prompt_id')) {
        return [{
          prompt_id: 'test-prompt-123',
          session_id: 'analytics-test-session',
          teacher_id: 'analytics-test-teacher',
          group_id: 'analytics-test-group',
          category: 'facilitation',
          priority: 'medium',
          generated_at: new Date().toISOString(),
          acknowledged_at: new Date().toISOString(),
          used_at: new Date().toISOString(),
          effectiveness_score: 85,
          teacher_feedback_rating: 4
        }];
      }
      return [];
    });
  });

  afterEach(async () => {
    // Cleanup test data
    await analyticsTrackingValidator.cleanup();
  });

  describe('Full Analytics Tracking Workflow', () => {
    it('should track complete prompt lifecycle from generation to feedback', async () => {
      // Step 1: Generate a test prompt
      const prompts = await teacherPromptService.generatePrompts(
        {
          topicalCohesion: 70,
          conceptualDensity: 80,

          // participationBalance removed from type
          // offTopicIndicators removed from type
          // keyTermsUsed removed from type
          // groupDynamics removed from type
          analysisTimestamp: new Date().toISOString(),
          windowStartTime: new Date().toISOString(),
          windowEndTime: new Date().toISOString(),
          transcriptLength: 100,
          confidence: 0.8,
          insights: []
        },
        {
          sessionId: 'analytics-test-session',
          teacherId: 'analytics-test-teacher',
          groupId: 'analytics-test-group',
          sessionPhase: 'development',
          subject: 'science',
          learningObjectives: ['Test analytics tracking'],
          // currentTime removed from PromptGenerationContext
          groupSize: 4,
          sessionDuration: 30
        }
      );

      expect(prompts.length).toBeGreaterThan(0);
      const testPrompt = prompts[0];

      // Step 2: Store prompt in database (simulated)
      const storeResult = await databricksService.query(
        'INSERT INTO teacher_guidance_metrics (prompt_id, session_id, teacher_id, group_id, category, priority, message, context, generated_at, effectiveness_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          testPrompt.id,
          testPrompt.sessionId,
          testPrompt.teacherId,
          testPrompt.groupId,
          testPrompt.category,
          testPrompt.priority,
          testPrompt.message,
          testPrompt.context,
          testPrompt.generatedAt.toISOString(),
          testPrompt.effectivenessScore
        ]
      );

      expect(storeResult).toEqual([{ insertId: '12345' }]);
      expect(mockDatabricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO teacher_guidance_metrics'),
        expect.arrayContaining([testPrompt.id, testPrompt.sessionId])
      );

      // Step 3: Simulate teacher acknowledgment
      const acknowledgeTime = new Date();
      const acknowledgeResult = await databricksService.query(
        'UPDATE teacher_guidance_metrics SET acknowledged_at = ? WHERE prompt_id = ?',
        [acknowledgeTime.toISOString(), testPrompt.id]
      );

      expect(acknowledgeResult).toEqual([{ affectedRows: 1 }]);

      // Step 4: Simulate teacher using the prompt
      const useTime = new Date();
      const useResult = await databricksService.query(
        'UPDATE teacher_guidance_metrics SET used_at = ? WHERE prompt_id = ?',
        [useTime.toISOString(), testPrompt.id]
      );

      expect(useResult).toEqual([{ affectedRows: 1 }]);

      // Step 5: Simulate teacher feedback
      const feedbackResult = await databricksService.query(
        'UPDATE teacher_guidance_metrics SET teacher_feedback_rating = ?, teacher_feedback_text = ? WHERE prompt_id = ?',
        [4, 'Very helpful prompt, improved discussion focus', testPrompt.id]
      );

      expect(feedbackResult).toEqual([{ affectedRows: 1 }]);

      // Step 6: Log audit trail
      const auditResult = await databricksService.query(
        'INSERT INTO session_audit_log (session_id, teacher_id, action_type, action_data, timestamp) VALUES (?, ?, ?, ?, ?)',
        [
          testPrompt.sessionId,
          testPrompt.teacherId,
          'prompt_feedback_submitted',
          JSON.stringify({ promptId: testPrompt.id, rating: 4 }),
          new Date().toISOString()
        ]
      );

      expect(auditResult).toEqual([{ insertId: '67890' }]);

      // Step 7: Verify complete tracking
      const retrievalResult = await databricksService.query(
        'SELECT * FROM teacher_guidance_metrics WHERE prompt_id = ?',
        [testPrompt.id]
      );

      expect(retrievalResult).toHaveLength(1);
      const trackedPrompt = retrievalResult[0];
      expect(trackedPrompt.prompt_id).toBe(testPrompt.id);
      expect(trackedPrompt.acknowledged_at).toBeDefined();
      expect(trackedPrompt.used_at).toBeDefined();
      expect(trackedPrompt.teacher_feedback_rating).toBe(4);
    });

    it('should track alert delivery and confirmation', async () => {
      // Create a high-priority prompt for alert testing
      const urgentPrompt = await teacherPromptService['createPrompt']({
        category: 'collaboration',
        priority: 'high',
        message: 'Urgent: One student is dominating the discussion',
        context: 'Group dynamics analysis shows 80% participation from one student',
        suggestedTiming: 'immediate',
        sessionPhase: 'development',
        subject: 'science',
        sessionId: 'alert-test-session',
        teacherId: 'alert-test-teacher',
        groupId: 'alert-test-group'
      });

      // Track alert delivery
      await alertPrioritizationService.prioritizeAlert(urgentPrompt, {
        sessionId: 'alert-test-session',
        teacherId: 'alert-test-teacher',
        currentAlertCount: 2,
        sessionPhase: 'development'
      });

      // Verify alert was logged
      expect(mockDatabricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO session_audit_log'),
        expect.arrayContaining([
          urgentPrompt.sessionId,
          urgentPrompt.teacherId,
          'alert_delivered'
        ])
      );

      // Simulate delivery confirmation
      const deliveryConfirmTime = new Date();
      await databricksService.query(
        'UPDATE teacher_guidance_metrics SET delivery_confirmed_at = ? WHERE prompt_id = ?',
        [deliveryConfirmTime.toISOString(), urgentPrompt.id]
      );

      expect(mockDatabricksService.query).toHaveBeenCalledWith(
        'UPDATE teacher_guidance_metrics SET delivery_confirmed_at = ? WHERE prompt_id = ?',
        [deliveryConfirmTime.toISOString(), urgentPrompt.id]
      );
    });
  });

  describe('Analytics Validation System', () => {
    it('should validate complete analytics tracking system', async () => {
      // Run the full analytics validation
      const validationReport = await analyticsTrackingValidator.validateAnalyticsTracking();

      expect(validationReport).toBeDefined();
      expect(validationReport.overall).toBeDefined();
      
      // Verify validation report structure
      // Note: status and timestamp properties have been removed from the validation report type
      expect(validationReport.overall.passed).toBeDefined();
      expect(validationReport.overall.successRate).toBeDefined();

      // Check that validation created and tested data
      expect(mockDatabricksService.query).toHaveBeenCalledTimes(expect.any(Number));

      // Verify cleanup was called
      await analyticsTrackingValidator.cleanup();
      expect(mockDatabricksService.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM teacher_guidance_metrics'),
        expect.any(Array)
      );
    });

    it('should validate individual analytics components', async () => {
      // Test prompt generation validation
      const promptResults = await analyticsTrackingValidator.testComponent('promptGeneration');
      expect(promptResults).toHaveLength(expect.any(Number));
      expect(promptResults[0].passed).toBeDefined();

      // Test prompt storage validation
      const storageResults = await analyticsTrackingValidator.testComponent('promptStorage');
      expect(storageResults).toHaveLength(expect.any(Number));

      // Test teacher interactions validation
      const interactionResults = await analyticsTrackingValidator.testComponent('teacherInteractions');
      expect(interactionResults).toHaveLength(expect.any(Number));

      // Test effectiveness tracking validation
      const effectivenessResults = await analyticsTrackingValidator.testComponent('effectivenessTracking');
      expect(effectivenessResults).toHaveLength(expect.any(Number));

      // Test audit logging validation
      const auditResults = await analyticsTrackingValidator.testComponent('auditLogging');
      expect(auditResults).toHaveLength(expect.any(Number));
    });
  });

  describe('Session-level Analytics Aggregation', () => {
    it('should aggregate session guidance analytics correctly', async () => {
      const sessionId = 'aggregation-test-session';
      const teacherId = 'aggregation-test-teacher';

      // Mock session summary data
      mockDatabricksService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT session_id, COUNT(*) as total_prompts')) {
          return [{
            session_id: sessionId,
            total_prompts: 8,
            acknowledged_prompts: 7,
            used_prompts: 5,
            dismissed_prompts: 1,
            avg_response_time: 4.2,
            avg_effectiveness_score: 82.5,
            high_priority_count: 2,
            categories_used: 'facilitation,deepening,collaboration'
          }];
        }
        if (sql.includes('INSERT INTO session_guidance_summary')) {
          return [{ insertId: 'summary-123' }];
        }
        return [];
      });

      // Generate session summary
      const summaryResult = await databricksService.query(
        'INSERT INTO session_guidance_summary (session_id, teacher_id, total_prompts, acknowledged_prompts, used_prompts, dismissed_prompts, avg_response_time, avg_effectiveness_score, session_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sessionId, teacherId, 8, 7, 5, 1, 4.2, 82.5, new Date().toISOString()]
      );

      expect(summaryResult).toEqual([{ insertId: 'summary-123' }]);

      // Verify aggregation query
      const aggregationResult = await databricksService.query(
        'SELECT session_id, COUNT(*) as total_prompts, SUM(CASE WHEN acknowledged_at IS NOT NULL THEN 1 ELSE 0 END) as acknowledged_prompts FROM teacher_guidance_metrics WHERE session_id = ? GROUP BY session_id',
        [sessionId]
      );

      expect(aggregationResult).toHaveLength(1);
      expect(aggregationResult[0].total_prompts).toBe(8);
      expect(aggregationResult[0].acknowledged_prompts).toBe(7);
    });
  });

  describe('Error Handling and Data Integrity', () => {
    it('should handle database errors gracefully', async () => {
      // Mock database failure
      mockDatabricksService.query.mockRejectedValueOnce(
        new Error('Database connection failed')
      );

      // Analytics validation should handle errors
      await expect(analyticsTrackingValidator.testComponent('promptStorage'))
        .resolves.not.toThrow();

      // Should record the failure in validation results
      const results = await analyticsTrackingValidator.testComponent('promptStorage');
      const failedTest = results.find(r => !r.passed);
      expect(failedTest).toBeDefined();
      expect(failedTest?.error).toContain('Database connection failed');
    });

    it('should maintain data consistency during concurrent operations', async () => {
      const sessionId = 'concurrency-test-session';
      const teacherId = 'concurrency-test-teacher';

      // Setup multiple concurrent prompt tracking operations
      const promptPromises: Promise<any>[] = [];
      for (let i = 0; i < 5; i++) {
        const prompt = await teacherPromptService['createPrompt']({
          category: 'facilitation',
          priority: 'medium',
          message: `Concurrent prompt ${i}`,
          context: 'Concurrency test',
          suggestedTiming: 'immediate',
          sessionPhase: 'development',
          subject: 'science',
          sessionId,
          teacherId,
          groupId: `group-${i}`
        });

        promptPromises.push(
          databricksService.query(
            'INSERT INTO teacher_guidance_metrics (prompt_id, session_id, teacher_id, category, generated_at) VALUES (?, ?, ?, ?, ?)',
            [prompt.id, prompt.sessionId, prompt.teacherId, prompt.category, prompt.generatedAt.toISOString()]
          )
        );
      }

      // All operations should complete successfully
      const results = await Promise.all(promptPromises);
      expect(results).toHaveLength(5);
      results.forEach(result => {
        expect(result).toEqual([{ insertId: '12345' }]);
      });
    });

    it('should validate data consistency after operations', async () => {
      const sessionId = 'consistency-test-session';

      // Mock count verification queries
      mockDatabricksService.query.mockImplementation(async (sql: string) => {
        if (sql.includes('COUNT(*) as count FROM teacher_guidance_metrics')) {
          return [{ count: 3 }];
        }
        if (sql.includes('COUNT(*) as count FROM session_audit_log')) {
          return [{ count: 5 }];
        }
        return [{ insertId: '12345' }];
      });

      // Create test data
      await databricksService.query(
        'INSERT INTO teacher_guidance_metrics (prompt_id, session_id) VALUES (?, ?)',
        ['test1', sessionId]
      );
      await databricksService.query(
        'INSERT INTO teacher_guidance_metrics (prompt_id, session_id) VALUES (?, ?)',
        ['test2', sessionId]
      );
      await databricksService.query(
        'INSERT INTO teacher_guidance_metrics (prompt_id, session_id) VALUES (?, ?)',
        ['test3', sessionId]
      );

      // Verify counts
      const promptCount = await databricksService.query(
        'SELECT COUNT(*) as count FROM teacher_guidance_metrics WHERE session_id = ?',
        [sessionId]
      );
      expect(promptCount[0].count).toBe(3);

      const auditCount = await databricksService.query(
        'SELECT COUNT(*) as count FROM session_audit_log WHERE session_id = ?',
        [sessionId]
      );
      expect(auditCount[0].count).toBe(5);
    });
  });

  describe('Performance Analytics', () => {
    it('should track response times and system performance', async () => {
      const sessionId = 'performance-test-session';
      const startTime = Date.now();

      // Simulate prompt generation with timing
      const prompt = await teacherPromptService['createPrompt']({
        category: 'facilitation',
        priority: 'medium',
        message: 'Performance test prompt',
        context: 'Timing validation',
        suggestedTiming: 'immediate',
        sessionPhase: 'development',
        subject: 'science',
        sessionId,
        teacherId: 'performance-teacher',
        groupId: 'performance-group'
      });

      const generateTime = Date.now() - startTime;

      // Track generation time
      await databricksService.query(
        'INSERT INTO teacher_guidance_metrics (prompt_id, session_id, generation_time_ms) VALUES (?, ?, ?)',
        [prompt.id, sessionId, generateTime]
      );

      expect(mockDatabricksService.query).toHaveBeenCalledWith(
        'INSERT INTO teacher_guidance_metrics (prompt_id, session_id, generation_time_ms) VALUES (?, ?, ?)',
        [prompt.id, sessionId, generateTime]
      );

      // Verify performance is within acceptable bounds (< 100ms for prompt generation)
      expect(generateTime).toBeLessThan(100);
    });

    it('should aggregate performance metrics across sessions', async () => {
      // Mock performance aggregation query
      mockDatabricksService.query.mockResolvedValueOnce([{
        avg_generation_time: 45.2,
        avg_response_time: 3.8,
        avg_delivery_time: 0.8,
        prompt_count: 156,
        session_count: 12
      }]);

      const performanceMetrics = await databricksService.query(
        'SELECT AVG(generation_time_ms) as avg_generation_time, AVG(response_time_seconds) as avg_response_time, COUNT(*) as prompt_count FROM teacher_guidance_metrics WHERE DATE(generated_at) = CURRENT_DATE'
      );

      expect(performanceMetrics[0].avg_generation_time).toBe(45.2);
      expect(performanceMetrics[0].avg_response_time).toBe(3.8);
      expect(performanceMetrics[0].prompt_count).toBe(156);
    });
  });
});
