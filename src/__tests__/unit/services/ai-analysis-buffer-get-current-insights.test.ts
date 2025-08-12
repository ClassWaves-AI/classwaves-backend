/**
 * Unit Tests for AIAnalysisBufferService.getCurrentInsights()
 * 
 * Tests the newly implemented getCurrentInsights method with real data patterns
 * - Tier 1 and Tier 2 insights aggregation
 * - Caching and performance optimization
 * - Database integration and fallback handling
 * - Real-time summary metrics calculation
 */

import { AIAnalysisBufferService } from '../../../services/ai-analysis-buffer.service';
import { databricksService } from '../../../services/databricks.service';
import type { Tier1Insights, Tier2Insights } from '../../../types/ai-analysis.types';

// Mock databricks service
jest.mock('../../../services/databricks.service');
const mockDatabricksService = databricksService as jest.Mocked<typeof databricksService>;

describe('AIAnalysisBufferService.getCurrentInsights()', () => {
  let service: AIAnalysisBufferService;
  const mockSessionId = '550e8400-e29b-41d4-a716-446655440001';

  beforeEach(() => {
    service = new AIAnalysisBufferService();
    jest.clearAllMocks();
    
    // Clear service state
    service['tier1Buffers'].clear();
    service['tier2Buffers'].clear();
    service['insightsCache'].clear();
    
    // Mock audit logging
    mockDatabricksService.recordAuditLog.mockResolvedValue(undefined);
  });

  describe('Real Data Integration', () => {
    it('should aggregate Tier 1 insights from multiple groups with real analysis data', async () => {
      const now = new Date();
      
      // Setup realistic buffer data for multiple groups
      const tier1Buffer1 = {
        transcripts: [
          { content: 'Student A: I think photosynthesis happens in chloroplasts', timestamp: now, sequenceNumber: 1 },
          { content: 'Student B: Yes, and it converts sunlight into energy', timestamp: now, sequenceNumber: 2 },
          { content: 'Student C: But how exactly does that process work?', timestamp: now, sequenceNumber: 3 }
        ],
        windowStart: new Date(now.getTime() - 30000),
        lastUpdate: new Date(now.getTime() - 5000),
        lastAnalysis: new Date(now.getTime() - 2000),
        groupId: 'group-001',
        sessionId: mockSessionId,
        sequenceCounter: 3
      };

      const tier1Buffer2 = {
        transcripts: [
          { content: 'Student D: The light reactions produce ATP and NADPH', timestamp: now, sequenceNumber: 1 },
          { content: 'Student E: And the dark reactions use those to make glucose', timestamp: now, sequenceNumber: 2 }
        ],
        windowStart: new Date(now.getTime() - 25000),
        lastUpdate: new Date(now.getTime() - 3000),
        lastAnalysis: new Date(now.getTime() - 1000),
        groupId: 'group-002',
        sessionId: mockSessionId,
        sequenceCounter: 2
      };

      service['tier1Buffers'].set(`${mockSessionId}:group-001`, tier1Buffer1);
      service['tier1Buffers'].set(`${mockSessionId}:group-002`, tier1Buffer2);

      // Mock realistic Tier 1 analysis results from database
      const tier1Analysis1: Tier1Insights = {
        topicalCohesion: 0.85,
        conceptualDensity: 0.72,
        analysisTimestamp: new Date(now.getTime() - 2000).toISOString(),
        windowStartTime: new Date(now.getTime() - 30000).toISOString(),
        windowEndTime: now.toISOString(),
        transcriptLength: 156,
        confidence: 0.89,
        insights: [
          {
            type: 'conceptual_density',
            message: 'Group is using sophisticated, science-specific terminology',
            severity: 'success',
            actionable: 'Continue encouraging use of scientific vocabulary'
          }
        ],
        metadata: {
          processingTimeMs: 850,
          modelVersion: 'databricks-gemma-3-12b-v1.2',
          rawScores: { vocabulary_sophistication: 0.78, concept_accuracy: 0.85 }
        }
      };

      const tier1Analysis2: Tier1Insights = {
        topicalCohesion: 0.68,
        conceptualDensity: 0.81,
        analysisTimestamp: new Date(now.getTime() - 1000).toISOString(),
        windowStartTime: new Date(now.getTime() - 25000).toISOString(),
        windowEndTime: now.toISOString(),
        transcriptLength: 98,
        confidence: 0.82,
        insights: [
          {
            type: 'topical_cohesion',
            message: 'Discussion showing some minor topic drift',
            severity: 'warning',
            actionable: 'Consider gentle redirect: "How does this connect to photosynthesis?"'
          }
        ],
        metadata: {
          processingTimeMs: 720,
          modelVersion: 'databricks-gemma-3-12b-v1.2'
        }
      };

      // Mock database responses for each group
      mockDatabricksService.queryOne
        .mockResolvedValueOnce({ result_data: JSON.stringify(tier1Analysis1) }) // First group
        .mockResolvedValueOnce({ result_data: JSON.stringify(tier1Analysis2) }) // Second group
        .mockResolvedValueOnce(null); // No Tier 2 data

      // Execute method
      const result = await service.getCurrentInsights(mockSessionId);

      // Verify comprehensive results
      expect(result.sessionId).toBe(mockSessionId);
      expect(result.tier1Insights).toHaveLength(2);
      
      // Verify group-specific insights
      const group1Insights = result.tier1Insights.find(g => g.groupId === 'group-001');
      const group2Insights = result.tier1Insights.find(g => g.groupId === 'group-002');
      
      expect(group1Insights).toBeDefined();
      expect(group1Insights!.insights.topicalCohesion).toBe(0.85);
      expect(group1Insights!.insights.conceptualDensity).toBe(0.72);
      expect(group1Insights!.bufferInfo.transcriptCount).toBe(3);
      
      expect(group2Insights).toBeDefined();
      expect(group2Insights!.insights.topicalCohesion).toBe(0.68);
      expect(group2Insights!.insights.conceptualDensity).toBe(0.81);
      expect(group2Insights!.bufferInfo.transcriptCount).toBe(2);

      // Verify aggregated summary metrics
      expect(result.summary.averageTopicalCohesion).toBeCloseTo((0.85 + 0.68) / 2, 2);
      expect(result.summary.averageConceptualDensity).toBeCloseTo((0.72 + 0.81) / 2, 2);
      expect(result.summary.overallConfidence).toBeCloseTo((0.89 * 0.6 + 0.82 * 0.6) / 2, 2);
      expect(result.summary.alertCount).toBe(2); // Total insights from both groups
      expect(result.summary.criticalAlerts).toContain('Group group-002: Discussion showing some minor topic drift');

      // Verify key metrics
      expect(result.summary.keyMetrics.activeGroups).toBe(2);
      expect(result.summary.keyMetrics.totalTranscripts).toBe(5);

      // Verify compliance audit logging
      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith({
        actorId: 'system',
        actorType: 'system',
        eventType: 'ai_insights_access',
        eventCategory: 'data_access',
        resourceType: 'session_insights',
        resourceId: mockSessionId,
        schoolId: 'system',
        description: expect.stringContaining('Retrieve current AI insights'),
        complianceBasis: 'legitimate_interest',
        dataAccessed: 'buffer_metadata'
      });
    });

    it('should combine Tier 1 and Tier 2 insights with realistic deep analysis data', async () => {
      const now = new Date();
      
      // Setup Tier 1 buffer
      const tier1Buffer = {
        transcripts: [
          { content: 'Complex discussion about ecosystem interactions', timestamp: now, sequenceNumber: 1 }
        ],
        windowStart: new Date(now.getTime() - 30000),
        lastUpdate: new Date(now.getTime() - 5000),
        lastAnalysis: new Date(now.getTime() - 2000),
        groupId: 'group-001',
        sessionId: mockSessionId,
        sequenceCounter: 1
      };

      // Setup Tier 2 buffer
      const tier2Buffer = {
        transcripts: [
          { content: 'Extended collaborative analysis of scientific concepts', timestamp: now, sequenceNumber: 1 },
          { content: 'Building on each others ideas about environmental science', timestamp: now, sequenceNumber: 2 }
        ],
        windowStart: new Date(now.getTime() - 180000), // 3 minutes ago
        lastUpdate: new Date(now.getTime() - 10000),
        lastAnalysis: new Date(now.getTime() - 5000),
        groupId: 'session-level',
        sessionId: mockSessionId,
        sequenceCounter: 2
      };

      service['tier1Buffers'].set(`${mockSessionId}:group-001`, tier1Buffer);
      service['tier2Buffers'].set(`${mockSessionId}:session-level`, tier2Buffer);

      // Realistic Tier 1 analysis
      const tier1Analysis: Tier1Insights = {
        topicalCohesion: 0.92,
        conceptualDensity: 0.86,
        analysisTimestamp: new Date(now.getTime() - 2000).toISOString(),
        windowStartTime: new Date(now.getTime() - 30000).toISOString(),
        windowEndTime: now.toISOString(),
        transcriptLength: 45,
        confidence: 0.94,
        insights: [
          {
            type: 'conceptual_density',
            message: 'Excellent use of advanced scientific concepts',
            severity: 'success'
          }
        ]
      };

      // Realistic Tier 2 deep analysis
      const tier2Analysis: Tier2Insights = {
        argumentationQuality: {
          score: 0.78,
          claimEvidence: 0.82,
          logicalFlow: 0.75,
          counterarguments: 0.68,
          synthesis: 0.85
        },
        collectiveEmotionalArc: {
          trajectory: 'ascending',
          averageEngagement: 0.83,
          energyPeaks: [now.getTime() - 120000, now.getTime() - 60000],
          sentimentFlow: [
            { timestamp: new Date(now.getTime() - 180000).toISOString(), sentiment: 0.3, confidence: 0.7 },
            { timestamp: new Date(now.getTime() - 120000).toISOString(), sentiment: 0.6, confidence: 0.8 },
            { timestamp: new Date(now.getTime() - 60000).toISOString(), sentiment: 0.8, confidence: 0.9 }
          ]
        },
        collaborationPatterns: {
          turnTaking: 0.87,
          buildingOnIdeas: 0.92,
          conflictResolution: 0.75,
          inclusivity: 0.69
        },
        learningSignals: {
          conceptualGrowth: 0.84,
          questionQuality: 0.78,
          metacognition: 0.71,
          knowledgeApplication: 0.89
        },
        analysisTimestamp: new Date(now.getTime() - 5000).toISOString(),
        sessionStartTime: new Date(now.getTime() - 1800000).toISOString(), // 30 min ago
        analysisEndTime: now.toISOString(),
        totalTranscriptLength: 2453,
        groupsAnalyzed: ['group-001'],
        confidence: 0.88,
        recommendations: [
          {
            type: 'praise',
            priority: 'medium',
            message: 'Students are demonstrating excellent collaborative learning',
            suggestedAction: 'Acknowledge the quality of their collaborative analysis',
            targetGroups: ['group-001']
          },
          {
            type: 'intervention',
            priority: 'high',
            message: 'Consider supporting quieter students to increase inclusivity',
            suggestedAction: 'Use targeted questioning to engage all students',
            targetGroups: ['group-001']
          }
        ]
      };

      // Mock database responses
      mockDatabricksService.queryOne
        .mockResolvedValueOnce({ result_data: JSON.stringify(tier1Analysis) }) // Tier 1
        .mockResolvedValueOnce({ result_data: JSON.stringify(tier2Analysis) }); // Tier 2

      // Execute method
      const result = await service.getCurrentInsights(mockSessionId);

      // Verify combined insights
      expect(result.tier1Insights).toHaveLength(1);
      expect(result.tier2Insights).toBeDefined();
      expect(result.tier2Insights!.insights.argumentationQuality.score).toBe(0.78);
      expect(result.tier2Insights!.insights.collaborationPatterns.inclusivity).toBe(0.69);

      // Verify enhanced summary with Tier 2 data
      expect(result.summary.alertCount).toBe(3); // 1 from Tier 1 + 2 from Tier 2 recommendations
      expect(result.summary.criticalAlerts).toContain('Session: Consider supporting quieter students to increase inclusivity');

      // Verify confidence calculation includes both tiers
      const expectedConfidence = ((0.94 * 0.6) + (0.88 * 0.8)) / 2;
      expect(result.summary.overallConfidence).toBeCloseTo(expectedConfidence, 2);
    });

    it('should implement intelligent caching with TTL for performance', async () => {
      const mockInsights = {
        sessionId: mockSessionId,
        lastUpdated: new Date(),
        tier1Insights: [],
        summary: {
          overallConfidence: 0.75,
          averageTopicalCohesion: 0.8,
          averageConceptualDensity: 0.7,
          alertCount: 0,
          keyMetrics: { activeGroups: 0, totalTranscripts: 0, recentAnalyses: 0 },
          criticalAlerts: []
        },
        metadata: { dataAge: 0, cacheHit: false, processingTime: 0 }
      };

      // Populate cache
      service['insightsCache'].set(mockSessionId, {
        insights: mockInsights,
        timestamp: new Date() // Fresh cache
      });

      const startTime = Date.now();
      const result = await service.getCurrentInsights(mockSessionId, { maxAge: 10 });
      const duration = Date.now() - startTime;

      // Verify cache hit
      expect(result.metadata.cacheHit).toBe(true);
      expect(duration).toBeLessThan(50); // Very fast cache response
      expect(mockDatabricksService.queryOne).not.toHaveBeenCalled(); // No DB queries

      // Test cache expiry
      service['insightsCache'].set(mockSessionId, {
        insights: mockInsights,
        timestamp: new Date(Date.now() - 15 * 60000) // 15 minutes old
      });

      mockDatabricksService.queryOne.mockResolvedValue(null);

      const freshResult = await service.getCurrentInsights(mockSessionId, { maxAge: 10 });
      expect(freshResult.metadata.cacheHit).toBe(false); // Cache expired, fresh data
    });
  });

  describe('Graceful Degradation', () => {
    it('should handle partial database failures gracefully', async () => {
      const now = new Date();
      
      // Setup buffer
      const tier1Buffer = {
        transcripts: [{ content: 'Test content', timestamp: now, sequenceNumber: 1 }],
        windowStart: new Date(now.getTime() - 30000),
        lastUpdate: new Date(now.getTime() - 5000),
        groupId: 'group-001',
        sessionId: mockSessionId,
        sequenceCounter: 1
      };

      service['tier1Buffers'].set(`${mockSessionId}:group-001`, tier1Buffer);

      // Simulate database failures
      mockDatabricksService.queryOne
        .mockRejectedValueOnce(new Error('Tier 1 DB failure')) // First call fails
        .mockResolvedValueOnce(null); // Second call succeeds with no data

      // Should still complete and return meaningful results
      const result = await service.getCurrentInsights(mockSessionId);

      expect(result.sessionId).toBe(mockSessionId);
      expect(result.tier1Insights).toHaveLength(0); // Failed to load
      expect(result.tier2Insights).toBeUndefined(); // No data
      expect(result.summary.averageTopicalCohesion).toBe(0); // Defaults
      expect(result.summary.overallConfidence).toBe(0);
    });

    it('should handle empty buffers and return meaningful default insights', async () => {
      // No buffers setup - empty state
      mockDatabricksService.queryOne.mockResolvedValue(null);

      const result = await service.getCurrentInsights(mockSessionId);

      expect(result.sessionId).toBe(mockSessionId);
      expect(result.tier1Insights).toHaveLength(0);
      expect(result.tier2Insights).toBeUndefined();
      expect(result.summary.keyMetrics.activeGroups).toBe(0);
      expect(result.summary.alertCount).toBe(0);
      expect(result.summary.criticalAlerts).toHaveLength(0);
      expect(result.metadata.cacheHit).toBe(false);
    });

    it('should filter out stale buffer data based on maxAge', async () => {
      const now = new Date();
      
      // Setup one recent buffer and one stale buffer
      const recentBuffer = {
        transcripts: [{ content: 'Recent discussion', timestamp: now, sequenceNumber: 1 }],
        windowStart: new Date(now.getTime() - 30000),
        lastUpdate: new Date(now.getTime() - 2000), // 2 seconds ago
        groupId: 'group-recent',
        sessionId: mockSessionId,
        sequenceCounter: 1
      };

      const staleBuffer = {
        transcripts: [{ content: 'Old discussion', timestamp: now, sequenceNumber: 1 }],
        windowStart: new Date(now.getTime() - 900000), // 15 minutes ago
        lastUpdate: new Date(now.getTime() - 900000), // 15 minutes ago
        groupId: 'group-stale',
        sessionId: mockSessionId,
        sequenceCounter: 1
      };

      service['tier1Buffers'].set(`${mockSessionId}:group-recent`, recentBuffer);
      service['tier1Buffers'].set(`${mockSessionId}:group-stale`, staleBuffer);

      // Mock analysis for recent group only
      const recentAnalysis: Tier1Insights = {
        topicalCohesion: 0.8,
        conceptualDensity: 0.7,
        analysisTimestamp: new Date(now.getTime() - 2000).toISOString(),
        windowStartTime: new Date(now.getTime() - 30000).toISOString(),
        windowEndTime: now.toISOString(),
        transcriptLength: 18,
        confidence: 0.85,
        insights: []
      };

      mockDatabricksService.queryOne
        .mockResolvedValueOnce({ result_data: JSON.stringify(recentAnalysis) })
        .mockResolvedValueOnce(null); // No Tier 2

      // Use short maxAge to filter out stale data
      const result = await service.getCurrentInsights(mockSessionId, { maxAge: 5 });

      // Should only include recent buffer
      expect(result.tier1Insights).toHaveLength(1);
      expect(result.tier1Insights[0].groupId).toBe('group-recent');
      expect(result.summary.keyMetrics.activeGroups).toBe(1);
    });
  });

  describe('Error Handling and Compliance', () => {
    it('should validate input parameters', async () => {
      await expect(service.getCurrentInsights('')).rejects.toThrow('Invalid sessionId provided');
      await expect(service.getCurrentInsights(null as any)).rejects.toThrow('Invalid sessionId provided');
    });

    it('should handle audit logging failures gracefully', async () => {
      mockDatabricksService.recordAuditLog.mockRejectedValue(new Error('Audit system down'));
      mockDatabricksService.queryOne.mockResolvedValue(null);

      // Should still complete successfully
      const result = await service.getCurrentInsights(mockSessionId);
      expect(result.sessionId).toBe(mockSessionId);
    });

    it('should log errors with comprehensive audit trail', async () => {
      mockDatabricksService.queryOne.mockRejectedValue(new Error('Complete system failure'));

      await expect(service.getCurrentInsights(mockSessionId)).rejects.toThrow('Complete system failure');

      // Verify error audit logging
      expect(mockDatabricksService.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'ai_insights_access_error',
          description: expect.stringContaining('Log insights access error')
        })
      );
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large-scale session data efficiently', async () => {
      const now = new Date();

      // Create large dataset with multiple groups
      for (let i = 0; i < 20; i++) {
        const buffer = {
          transcripts: Array.from({ length: 25 }, (_, j) => ({
            content: `Student transcript ${i}-${j} with realistic educational content`,
            timestamp: new Date(now.getTime() - j * 1000),
            sequenceNumber: j + 1
          })),
          windowStart: new Date(now.getTime() - 30000),
          lastUpdate: new Date(now.getTime() - 1000),
          lastAnalysis: new Date(now.getTime() - 500),
          groupId: `group-${i.toString().padStart(3, '0')}`,
          sessionId: mockSessionId,
          sequenceCounter: 25
        };

        service['tier1Buffers'].set(`${mockSessionId}:group-${i.toString().padStart(3, '0')}`, buffer);
      }

      // Mock database to return null for all queries (test buffer processing only)
      mockDatabricksService.queryOne.mockResolvedValue(null);

      const startTime = Date.now();
      const result = await service.getCurrentInsights(mockSessionId);
      const duration = Date.now() - startTime;

      // Performance assertions
      expect(duration).toBeLessThan(500); // Should complete in reasonable time
      expect(result.tier1Insights).toHaveLength(0); // No DB data, but processed 20 buffers
      expect(result.summary.keyMetrics.activeGroups).toBe(0); // No insights loaded
      
      // Verify all buffers were considered (even without DB data)
      expect(mockDatabricksService.queryOne).toHaveBeenCalledTimes(21); // 20 groups + 1 tier2 call
    });

    it('should demonstrate memory efficiency with cleanup', async () => {
      // Fill cache with multiple sessions
      for (let i = 0; i < 10; i++) {
        const sessionId = `session-${i}`;
        service['insightsCache'].set(sessionId, {
          insights: {
            sessionId,
            lastUpdated: new Date(),
            tier1Insights: [],
            summary: {
              overallConfidence: 0.5,
              averageTopicalCohesion: 0.5,
              averageConceptualDensity: 0.5,
              alertCount: 0,
              keyMetrics: { activeGroups: 0, totalTranscripts: 0, recentAnalyses: 0 },
              criticalAlerts: []
            },
            metadata: { dataAge: 0, cacheHit: false, processingTime: 0 }
          },
          timestamp: new Date()
        });
      }

      expect(service['insightsCache'].size).toBe(10);

      mockDatabricksService.queryOne.mockResolvedValue(null);

      // Access one session
      await service.getCurrentInsights('session-5');

      // Cache should still contain data
      expect(service['insightsCache'].size).toBeGreaterThan(0);
    });
  });
});
