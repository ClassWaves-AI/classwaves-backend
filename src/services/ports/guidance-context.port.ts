export interface GuidanceTranscriptLine {
  text: string;
  timestamp: number;
  speakerLabel?: string;
  sequence?: number;
  sttConfidence?: number;
}

export interface GuidanceEpisode {
  id: string;
  start: number;
  end: number;
  durationMs: number;
  lines: GuidanceTranscriptLine[];
  lexicalCohesion: number;
  alignmentScore: number;
  averageConfidence: number;
  charCount: number;
  tokenCount: number;
}

export interface GuidanceWindowBudgets {
  maxChars: number;
  maxLines: number;
  windowMs: number;
}

export interface GuidanceDriftMetrics {
  alignmentDelta: number;
  persistentMs: number;
  priorAlignment: number;
  currentAlignment: number;
  lastAlignedAt: number | null;
}

export interface GuidanceInputQuality {
  sttConfidence: number;
  coverage: number;
  alignmentDelta: number;
  episodeCount: number;
}

export interface GuidanceWindowSelection {
  aligned: GuidanceTranscriptLine[];
  current: GuidanceTranscriptLine[];
  drift: GuidanceDriftMetrics;
  inputQuality: GuidanceInputQuality;
}

export interface GuidanceContextPort {
  buildEpisodes(
    lines: GuidanceTranscriptLine[],
    goal: string | undefined,
    domainTerms: string[] | undefined,
    windowMinutes: number | undefined
  ): GuidanceEpisode[];
  selectWindows(
    episodes: GuidanceEpisode[],
    goal: string | undefined,
    now: number,
    budgets: GuidanceWindowBudgets
  ): GuidanceWindowSelection;
  scoreAlignment(text: string, goal: string | undefined, domainTerms: string[] | undefined): number;
}
