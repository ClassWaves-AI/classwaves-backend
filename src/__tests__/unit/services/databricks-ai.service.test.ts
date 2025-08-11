import { DatabricksAIService } from '../../../services/databricks-ai.service';
import { Tier1Options, Tier2Options } from '../../../types/ai-analysis.types';

// Mock fetch globally
global.fetch = jest.fn();

describe('DatabricksAIService', () => {
  let service: DatabricksAIService;
  const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    service = new DatabricksAIService();
    mockFetch.mockClear();
    
    // Mock environment variables
    process.env.DATABRICKS_HOST = 'https://test.databricks.com';
    process.env.DATABRICKS_TOKEN = 'test-token';
    process.env.AI_TIER1_ENDPOINT = '/serving-endpoints/tier1/invocations';
    process.env.AI_TIER2_ENDPOINT = '/serving-endpoints/tier2/invocations';
    process.env.AI_TIER1_TIMEOUT_MS = '2000';
    process.env.AI_TIER2_TIMEOUT_MS = '5000';
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
        json: async () => mockResponse
      } as Response);

      const result = await service.analyzeTier1(mockTranscripts, mockTier1Options);

      expect(result).toEqual(mockResponse);
      expect(result.topicalCohesion).toBe(0.85);
      expect(result.insights).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.databricks.com/serving-endpoints/tier1/invocations',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json'
          }),
          body: expect.stringContaining('Test discussion about photosynthesis')
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
          json: async () => ({
            topicalCohesion: 0.75,
            conceptualDensity: 0.80,
            analysisTimestamp: new Date().toISOString(),
            windowStartTime: new Date().toISOString(),
            windowEndTime: new Date().toISOString(),
            transcriptLength: 50,
            confidence: 0.85,
            insights: []
          })
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
      
      mockFetch.mockImplementation(() => 
        new Promise(() => {}) // Never resolves
      );

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
        insights: []
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse
      } as Response);

      const result = await service.analyzeTier2(mockTranscripts, mockTier2Options);

      expect(result).toEqual(mockResponse);
      expect(result.argumentationQuality.score).toBe(0.82);
      expect(result.collectiveEmotionalArc.trajectory).toBe('ascending');
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
      
      mockFetch.mockImplementation(() => 
        new Promise(() => {}) // Never resolves
      );

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
          json: async () => ({
            topicalCohesion: 0.80,
            conceptualDensity: 0.75,
            analysisTimestamp: new Date().toISOString(),
            windowStartTime: new Date().toISOString(),
            windowEndTime: new Date().toISOString(),
            transcriptLength: 10,
            confidence: 0.85,
            insights: []
          })
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
          json: async () => ({
            topicalCohesion: 0.85,
            conceptualDensity: 0.80,
            analysisTimestamp: new Date().toISOString(),
            windowStartTime: new Date().toISOString(),
            windowEndTime: new Date().toISOString(),
            transcriptLength: 10,
            confidence: 0.85,
            insights: []
          })
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
