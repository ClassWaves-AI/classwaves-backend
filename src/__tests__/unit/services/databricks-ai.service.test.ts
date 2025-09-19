import { DatabricksAIService } from '../../../services/databricks-ai.service';
import { Tier1Options, Tier2Options } from '../../../types/ai-analysis.types';

// Mock fetch globally
global.fetch = jest.fn();

describe('DatabricksAIService', () => {
  let service: DatabricksAIService;
  const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

  const wrapDatabricksResponse = (payload: unknown) => ({
    choices: [
      {
        message: {
          content: JSON.stringify(payload),
        },
      },
    ],
  });

beforeEach(() => {
  mockFetch.mockClear();
  // Mock environment variables BEFORE constructing service
  process.env.DATABRICKS_HOST = 'https://test.databricks.com';
  process.env.DATABRICKS_TOKEN = 'test-token';
  process.env.AI_TIER1_ENDPOINT = '/serving-endpoints/tier1/invocations';
  process.env.AI_TIER2_ENDPOINT = '/serving-endpoints/tier2/invocations';
  process.env.AI_TIER1_TIMEOUT_MS = '2000';
  process.env.AI_TIER2_TIMEOUT_MS = '5000';
  service = new DatabricksAIService();
});

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('analyzeTier1', () => {
    const mockTier1Options: Tier1Options = {
      groupId: 'group1',
      sessionId: 'session1',
      focusAreas: ['topical_cohesion', 'conceptual_density'],
      windowSize: 30
    };

    const mockTranscripts = [
      'Test discussion about photosynthesis',
      'Students are collaborating well'
    ];

    it('should successfully analyze Tier 1 insights', async () => {
      const mockResponse = {
        topicalCohesion: 0.85,
        conceptualDensity: 0.78,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 50,
        confidence: 0.89,
        insights: [
          {
            type: 'topical_cohesion' as const,
            message: 'Good topic focus',
            severity: 'success' as const
          }
        ]
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => wrapDatabricksResponse(mockResponse),
      } as Response);

      const result = await service.analyzeTier1(mockTranscripts, mockTier1Options);

      expect(result).toMatchObject({
        topicalCohesion: 0.85,
        conceptualDensity: 0.78,
        confidence: 0.89,
      });
      expect(result.insights).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.databricks.com/serving-endpoints/tier1/invocations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json'
          }),
          body: expect.any(String)
        })
      );
    });

    it('should retry on failure with exponential backoff', async () => {
      jest.useFakeTimers();
      
      // First two calls fail, third succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => wrapDatabricksResponse({
            topicalCohesion: 0.75,
            conceptualDensity: 0.80,
            analysisTimestamp: new Date().toISOString(),
            windowStartTime: new Date().toISOString(),
            windowEndTime: new Date().toISOString(),
            transcriptLength: 50,
            confidence: 0.85,
            insights: [],
          }),
        } as Response);

      const resultPromise = service.analyzeTier1(mockTranscripts, mockTier1Options);
      
      // Fast-forward through retry delays
      await jest.runAllTimersAsync();
      
      const result = await resultPromise;
      
      expect(result.topicalCohesion).toBe(0.75);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      
      jest.useRealTimers();
    });

    it('should handle timeout errors', async () => {
      jest.useFakeTimers();
      
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const resultPromise = service.analyzeTier1(mockTranscripts, mockTier1Options);
      
      // Fast-forward past timeout
      jest.advanceTimersByTime(3000);
      
      await expect(resultPromise).rejects.toThrow('Request timeout');
      
      jest.useRealTimers();
    });

    it('should handle API error responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'AI model unavailable'
      } as Response);

      await expect(service.analyzeTier1(mockTranscripts, mockTier1Options))
        .rejects.toThrow('Databricks AI API error: 500 Internal Server Error');
    });

    it('normalizes provider context descriptors when present', async () => {
      const mockResponse = {
        topicalCohesion: 0.7,
        conceptualDensity: 0.6,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 42,
        confidence: 0.75,
        insights: [],
        context: {
          reason: 'Recent discussion drifted.',
          currentTopic: 'Soccer practice',
          supportingLines: [
            { speakerLabel: 'Student A', text: 'We talked about soccer.', timestamp: Date.now() },
          ],
          confidence: 0.8,
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => wrapDatabricksResponse(mockResponse),
      } as Response);

      const result = await service.analyzeTier1(mockTranscripts, mockTier1Options);
      expect(result.context).toBeDefined();
      expect(result.context?.currentTopic).toBe('Soccer practice');
      expect(result.context?.quotes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            speakerLabel: 'Participant 1',
            text: 'We talked about soccer.'
          })
        ])
      );
      expect(result.context?.supportingLines).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            speaker: 'Participant 1',
            quote: 'We talked about soccer.'
          })
        ])
      );
      expect(result.context?.confidence).toBe(0.8);
    });

    it('clamps derived scores and omits empty context payloads', async () => {
      const mockResponse = {
        topicalCohesion: 1.4,
        conceptualDensity: -0.25,
        offTopicHeat: 'not-a-number',
        discussionMomentum: undefined,
        confusionRisk: 1.7,
        energyLevel: -0.35,
        analysisTimestamp: new Date().toISOString(),
        windowStartTime: new Date().toISOString(),
        windowEndTime: new Date().toISOString(),
        transcriptLength: 120,
        confidence: 0.42,
        insights: [],
        context: {
          reason: '',
          quotes: [],
        },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => wrapDatabricksResponse(mockResponse),
      } as Response);

      const result = await service.analyzeTier1(mockTranscripts, mockTier1Options);

      expect(result.topicalCohesion).toBe(1); // clamped upper bound
      expect(result.conceptualDensity).toBe(0); // clamped lower bound
      expect(result.offTopicHeat).toBeCloseTo(1); // inferred from min score
      expect(result.confusionRisk).toBe(1); // clamped from >1
      expect(result.energyLevel).toBe(0); // clamped from negative
      expect(result.context).toBeUndefined(); // empty payload omitted
    });

    it('throws an analysis error when Databricks returns malformed JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"topicalCohesion":0.8,"conceptualDensity"', // truncated payload
              },
            },
          ],
        }),
      } as Response);

      await expect(service.analyzeTier1(mockTranscripts, mockTier1Options))
        .rejects.toThrow(/Failed to parse Tier 1 response/);
    });

    it('should validate input parameters', async () => {
      await expect(service.analyzeTier1([], mockTier1Options))
        .rejects.toThrow('No transcripts provided');

      await expect(service.analyzeTier1(mockTranscripts, null as any))
        .rejects.toThrow('Options are required');
    });
  });

  describe('analyzeTier2', () => {
    const mockTier2Options: Tier2Options = {
      sessionId: 'session1',
      groupIds: ['group1', 'group2'],
      analysisDepth: 'comprehensive',
      includeComparative: true
    };

    const mockTranscripts = [
      'Deep mathematical discussion',
      'Students showing understanding'
    ];

    it('should successfully analyze Tier 2 insights', async () => {
      const mockResponse = {
        argumentationQuality: {
          score: 0.82,
          claimEvidence: 0.85,
          logicalFlow: 0.80,
          counterarguments: 0.75,
          synthesis: 0.88
        },
        collectiveEmotionalArc: {
          trajectory: 'ascending' as const,
          averageEngagement: 0.85,
          energyPeaks: [1000, 2500],
          sentimentFlow: []
        },
        collaborationPatterns: {
          turnTaking: 0.85,
          buildingOnIdeas: 0.90,
          conflictResolution: 0.75,
          inclusivity: 0.80
        },
        learningSignals: {
          conceptualGrowth: 0.88,
          questionQuality: 0.75,
          metacognition: 0.70,
          knowledgeApplication: 0.85
        },
        analysisTimestamp: new Date().toISOString(),
        sessionStartTime: new Date().toISOString(),
        totalDurationMinutes: 15,
        confidence: 0.91,
        insights: [],
        recommendations: [],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => wrapDatabricksResponse(mockResponse),
      } as Response);

      const result = await service.analyzeTier2(mockTranscripts, mockTier2Options);

      expect(result).toMatchObject({
        argumentationQuality: expect.objectContaining({ score: 0.82 }),
        collectiveEmotionalArc: expect.objectContaining({ trajectory: 'ascending' }),
        confidence: 0.91,
      });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.databricks.com/serving-endpoints/tier2/invocations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json'
          })
        })
      );
    });

    it('should handle different timeout for Tier 2', async () => {
      jest.useFakeTimers();
      
      mockFetch.mockImplementation(() => new Promise(() => {}));

      const resultPromise = service.analyzeTier2(mockTranscripts, mockTier2Options);
      
      // Tier 2 has longer timeout (5000ms vs 2000ms for Tier 1)
      jest.advanceTimersByTime(6000);
      
      await expect(resultPromise).rejects.toThrow('Request timeout');
      
      jest.useRealTimers();
    });
  });

  describe('configuration validation', () => {
    it('should validate required environment variables', () => {
      delete process.env.DATABRICKS_HOST;
      
      expect(() => new DatabricksAIService()).toThrow('DATABRICKS_HOST is required');
    });

    it('should validate endpoint configuration', () => {
      delete process.env.AI_TIER1_ENDPOINT;
      
      expect(() => new DatabricksAIService()).toThrow('AI_TIER1_ENDPOINT is required');
    });

    it('should use default timeouts when not specified', () => {
      delete process.env.AI_TIER1_TIMEOUT_MS;
      delete process.env.AI_TIER2_TIMEOUT_MS;
      
      const serviceWithDefaults = new DatabricksAIService();
      expect(serviceWithDefaults).toBeDefined();
    });
  });

  describe('error handling and recovery', () => {
    it('should differentiate between retryable and non-retryable errors', async () => {
      const mockTranscripts = ['Test'];
      const mockOptions: Tier1Options = {
        groupId: 'group1',
        sessionId: 'session1',
        focusAreas: ['topical_cohesion']
      };

      // 400 error should not retry
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid input'
      } as Response);

      await expect(service.analyzeTier1(mockTranscripts, mockOptions))
        .rejects.toThrow('Databricks AI API error: 400 Bad Request');
      
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retry for 400
    });

    it('should retry on 5xx errors', async () => {
      jest.useFakeTimers();
      
      const mockTranscripts = ['Test'];
      const mockOptions: Tier1Options = {
        groupId: 'group1',
        sessionId: 'session1',
        focusAreas: ['topical_cohesion']
      };

      // 500 error should retry
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server error'
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => wrapDatabricksResponse({
            topicalCohesion: 0.80,
            conceptualDensity: 0.75,
            analysisTimestamp: new Date().toISOString(),
            windowStartTime: new Date().toISOString(),
            windowEndTime: new Date().toISOString(),
            transcriptLength: 10,
            confidence: 0.85,
            insights: [],
          }),
        } as Response);

      const resultPromise = service.analyzeTier1(mockTranscripts, mockOptions);
      await jest.runAllTimersAsync();
      
      const result = await resultPromise;
      expect(result.topicalCohesion).toBe(0.80);
      expect(mockFetch).toHaveBeenCalledTimes(2); // Retried once
      
      jest.useRealTimers();
    });

    it('should include jitter in retry delays', async () => {
      jest.useFakeTimers();
      jest.spyOn(Math, 'random').mockReturnValue(0.5); // Mock random for consistent jitter
      
      const mockTranscripts = ['Test'];
      const mockOptions: Tier1Options = {
        groupId: 'group1',
        sessionId: 'session1',
        focusAreas: ['topical_cohesion']
      };

      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => wrapDatabricksResponse({
            topicalCohesion: 0.85,
            conceptualDensity: 0.80,
            analysisTimestamp: new Date().toISOString(),
            windowStartTime: new Date().toISOString(),
            windowEndTime: new Date().toISOString(),
            transcriptLength: 10,
            confidence: 0.85,
            insights: [],
          }),
        } as Response);

      const resultPromise = service.analyzeTier1(mockTranscripts, mockOptions);
      
      // Verify jitter is applied (base delay 1000ms + 50% jitter = 1500ms)
      jest.advanceTimersByTime(1500);
      
      const result = await resultPromise;
      expect(result.topicalCohesion).toBe(0.85);
      
      jest.useRealTimers();
      (Math.random as jest.Mock).mockRestore();
    });
  });
});
