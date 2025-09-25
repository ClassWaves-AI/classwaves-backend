import * as client from 'prom-client';
import { GuidanceNamespaceService } from '../../../services/websocket/guidance-namespace.service';
import { teacherPromptService } from '../../../services/teacher-prompt.service';
import { aiAnalysisBufferService } from '../../../services/ai-analysis-buffer.service';
import { guidanceInsightsService } from '../../../services/guidance-insights.service';
import { transcriptService } from '../../../services/transcript.service';
import { getCompositionRoot } from '../../../app/composition-root';

jest.mock('../../../services/teacher-prompt.service', () => ({
  teacherPromptService: {
    getActivePrompts: jest.fn(),
  },
}));

jest.mock('../../../services/ai-analysis-buffer.service', () => ({
  aiAnalysisBufferService: {
    getCurrentInsights: jest.fn(),
  },
}));

jest.mock('../../../services/guidance-insights.service', () => ({
  guidanceInsightsService: {
    getForSession: jest.fn(),
  },
}));

jest.mock('../../../services/transcript.service', () => ({
  transcriptService: {
    read: jest.fn(),
  },
}));

jest.mock('../../../app/composition-root', () => ({
  getCompositionRoot: jest.fn(),
}));

describe('GuidanceNamespaceService snapshot fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    client.register.resetMetrics();
    process.env.GUIDANCE_SNAPSHOT_INCLUDE_TRANSCRIPTS = '1';
    process.env.GUIDANCE_SNAPSHOT_TIER1_FALLBACK = '1';
    process.env.TRANSCRIPT_SNAPSHOT_MAX_LINES = '2';
  });

  afterEach(() => {
    delete process.env.GUIDANCE_SNAPSHOT_INCLUDE_TRANSCRIPTS;
    delete process.env.GUIDANCE_SNAPSHOT_TIER1_FALLBACK;
    delete process.env.TRANSCRIPT_SNAPSHOT_MAX_LINES;
  });

  it('merges persisted insights and transcripts when buffer is empty and session paused', async () => {
    (teacherPromptService.getActivePrompts as jest.Mock).mockResolvedValue([]);
    (aiAnalysisBufferService.getCurrentInsights as jest.Mock).mockResolvedValue({
      tier1Insights: [],
      tier2ByGroup: {},
      metadata: {},
    });
    (guidanceInsightsService.getForSession as jest.Mock).mockResolvedValue({
      tier1: [
        {
          groupId: 'group-1',
          text: 'Persisted insight',
          timestamp: '2025-09-25T10:00:00.000Z',
        },
      ],
      tier2: {
        groups: [
          {
            groupId: 'group-1',
            deep_analysis: {
              learning_objectives_alignment: 0.7,
              collaboration_effectiveness: 0.8,
              critical_thinking_indicators: [],
              knowledge_construction_patterns: [],
              teacher_intervention_recommendations: [],
            },
          },
        ],
        session_summary: {
          overall_effectiveness: 0.75,
          key_learning_moments: [],
          suggested_follow_up_activities: [],
        },
        timestamp: '2025-09-25T10:00:00.000Z',
      },
    });
    (transcriptService.read as jest.Mock).mockResolvedValue([
      { id: 'seg-1', text: 'Line one', startTs: 0, endTs: 1 },
      { id: 'seg-2', text: 'Line two', startTs: 1, endTs: 2 },
      { id: 'seg-3', text: 'Line three', startTs: 2, endTs: 3 },
    ]);

    const sessionRepoMock = { getBasic: jest.fn().mockResolvedValue({ status: 'paused' }) };
    (getCompositionRoot as jest.Mock).mockReturnValue({
      getSessionRepository: () => sessionRepoMock,
    });

    const namespaceMock = {
      name: '/guidance',
      use: jest.fn(),
      on: jest.fn(),
      emit: jest.fn(),
      to: jest.fn(() => ({ emit: jest.fn() })),
      server: { of: jest.fn() },
    } as any;

    const service: any = Object.create(GuidanceNamespaceService.prototype);
    service.namespace = namespaceMock;
    service.connectedUsers = new Map();
    service.sessionSubscriberCounts = new Map();
    service.redisErrorLogTimestamps = new Map();

    const emit = jest.fn();
    const socketMock = {
      data: { userId: 'teacher-1', role: 'teacher' },
      emit,
    } as any;

    await (service as any).handleGetCurrentState(socketMock, { sessionId: 'session-1' });

    expect(emit).toHaveBeenCalledTimes(1);
    const payload = emit.mock.calls[0][1];
    expect(payload.sessionId).toBe('session-1');
    expect(payload.tier1).toHaveLength(1);
    expect(payload.tier1[0]).toMatchObject({ groupId: 'group-1', text: 'Persisted insight' });
    expect(Object.keys(payload.tier2ByGroup)).toContain('group-1');
    expect(payload.transcriptsByGroup?.['group-1']).toHaveLength(2);
    expect(payload.transcriptsByGroup['group-1'][1]).toMatchObject({ text: 'Line three' });

    const snapshotMetric = client.register.getSingleMetric('guidance_snapshot_reads_total') as client.Counter<string> | undefined;
    expect(snapshotMetric).toBeDefined();
    const metric = await snapshotMetric!.get();
    const metricValues = metric.values;
    expect(metricValues.some((v) => v.labels.source === 'persisted' && v.labels.status === 'ok')).toBe(true);
  });
});
