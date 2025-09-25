import type { Tier1Insights, Tier1Options, Tier2Insights, Tier2Options } from '../../types/ai-analysis.types';
import type { GroupSummary, SessionSummary } from '../../types/ai-summaries.types';

type Tier1Factory = (transcripts: string[], options: Tier1Options) => Promise<Tier1Insights> | Tier1Insights;
type Tier2Factory = (transcripts: string[], options: Tier2Options) => Promise<Tier2Insights> | Tier2Insights;
type GroupSummaryFactory = (transcripts: string[], options: { sessionId: string; groupId: string }) => Promise<GroupSummary> | GroupSummary;
type SessionSummaryFactory = (groupSummaries: GroupSummary[], options: { sessionId: string }) => Promise<SessionSummary> | SessionSummary;

const defaultTier1Factory: Tier1Factory = async (transcripts) => {
  const now = new Date();
  const start = new Date(now.getTime() - 30_000);
  return {
    analysisTimestamp: now.toISOString(),
    windowStartTime: start.toISOString(),
    windowEndTime: now.toISOString(),
    transcriptLength: transcripts.join(' ').length,
    topicalCohesion: 0.7,
    conceptualDensity: 0.65,
    confidence: 0.8,
    insights: [],
    metadata: { processingTimeMs: 900, modelVersion: 'fixture-mock', rawScores: {} },
  };
};

const defaultTier2Factory: Tier2Factory = async (transcripts, options) => {
  const now = new Date();
  const analysisTimestamp = now.toISOString();
  const groupId = options.groupId ?? options.groupIds?.[0] ?? 'mock-group';
  return {
    argumentationQuality: { score: 0.5, claimEvidence: 0.48, logicalFlow: 0.46, counterarguments: 0.42, synthesis: 0.44 },
    collectiveEmotionalArc: { trajectory: 'stable', averageEngagement: 0.5, energyPeaks: [], sentimentFlow: [] },
    collaborationPatterns: { turnTaking: 0.5, buildingOnIdeas: 0.48, conflictResolution: 0.46, inclusivity: 0.5 },
    learningSignals: { conceptualGrowth: 0.5, questionQuality: 0.44, metacognition: 0.4, knowledgeApplication: 0.46 },
    analysisTimestamp,
    sessionStartTime: new Date(now.getTime() - 120_000).toISOString(),
    analysisEndTime: analysisTimestamp,
    totalTranscriptLength: transcripts.join(' ').length,
    groupsAnalyzed: [groupId],
    confidence: 0.72,
    recommendations: [],
    metadata: { processingTimeMs: 2100, modelVersion: 'fixture-mock', analysisModules: ['collaboration'] },
  };
};

const defaultGroupSummaryFactory: GroupSummaryFactory = async () => ({
  overview: 'Synthetic group summary.',
  highlights: [],
});

const defaultSessionSummaryFactory: SessionSummaryFactory = async () => ({
  themes: ['collaboration'],
  highlights: [],
});

let tier1Factory: Tier1Factory = defaultTier1Factory;
let tier2Factory: Tier2Factory = defaultTier2Factory;
let groupSummaryFactory: GroupSummaryFactory = defaultGroupSummaryFactory;
let sessionSummaryFactory: SessionSummaryFactory = defaultSessionSummaryFactory;

const analyzeTier1 = jest.fn(async (transcripts: string[], options: Tier1Options) => tier1Factory(transcripts, options));
const analyzeTier2 = jest.fn(async (transcripts: string[], options: Tier2Options) => tier2Factory(transcripts, options));
const summarizeGroup = jest.fn(async (transcripts: string[], options: { sessionId: string; groupId: string }) =>
  groupSummaryFactory(transcripts, options)
);
const summarizeSession = jest.fn(async (groupSummaries: GroupSummary[], options: { sessionId: string }) =>
  sessionSummaryFactory(groupSummaries, options)
);

export const databricksAIService = {
  analyzeTier1,
  analyzeTier2,
  summarizeGroup,
  summarizeSession,
};

export function __setTier1Factory(factory: Tier1Factory): void {
  tier1Factory = factory;
}

export function __setTier2Factory(factory: Tier2Factory): void {
  tier2Factory = factory;
}

export function __setGroupSummaryFactory(factory: GroupSummaryFactory): void {
  groupSummaryFactory = factory;
}

export function __setSessionSummaryFactory(factory: SessionSummaryFactory): void {
  sessionSummaryFactory = factory;
}

export function __reset(): void {
  analyzeTier1.mockClear();
  analyzeTier2.mockClear();
  summarizeGroup.mockClear();
  summarizeSession.mockClear();
  tier1Factory = defaultTier1Factory;
  tier2Factory = defaultTier2Factory;
  groupSummaryFactory = defaultGroupSummaryFactory;
  sessionSummaryFactory = defaultSessionSummaryFactory;
}

