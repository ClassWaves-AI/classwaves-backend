import {
  GuidanceContextPort,
  GuidanceDriftMetrics,
  GuidanceEpisode,
  GuidanceInputQuality,
  GuidanceTranscriptLine,
  GuidanceWindowBudgets,
  GuidanceWindowSelection,
} from './ports/guidance-context.port';

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from', 'have', 'in', 'into', 'is', 'it', 'its',
  'of', 'on', 'or', 'that', 'the', 'their', 'they', 'this', 'to', 'was', 'were', 'with', 'you', 'your', 'i', 'me',
  'my', 'we', 'our', 'ours', 'them', 'those', 'these', 'there', 'here', 'just', 'like', 'really', 'very', 'then',
  'than', 'so', 'up', 'down', 'out', 'over', 'maybe', 'kind', 'kinda', 'sorta', 'still', 'get', 'got', 'gonna',
  'going', 'back', 'yes', 'no', 'uh', 'um', 'yeah', 'right', 'okay', 'ok', 'hmm', 'mm'
]);

interface NormalizedLine extends GuidanceTranscriptLine {
  text: string;
  timestamp: number;
  tokens: string[];
  charCount: number;
  sttConfidence: number;
  alignment: number;
}

interface EpisodeBuilder {
  id: string;
  lines: NormalizedLine[];
  alignmentSum: number;
  confidenceSum: number;
  charCount: number;
  tokenCount: number;
  cohesionSum: number;
  cohesionPairs: number;
  start: number;
  end: number;
}

export class ContextEpisodesService implements GuidanceContextPort {
  private readonly config = {
    defaultWindowMinutes: this.clamp(
      Number.parseFloat(process.env.AI_GUIDANCE_EPISODE_MAX_MINUTES ?? '6'),
      4,
      8
    ),
    silenceBreakMs: 22000,
    lexicalCohesionBreak: 0.3,
    lexicalHardBreak: 0.18,
    alignmentSoftBreak: 0.18,
    alignmentHardBreak: 0.32,
    driftReturnThreshold: 0.06,
    minLineLength: 8,
  };

  buildEpisodes(
    lines: GuidanceTranscriptLine[],
    goal: string | undefined,
    domainTerms: string[] | undefined,
    windowMinutes: number | undefined
  ): GuidanceEpisode[] {
    if (!Array.isArray(lines) || lines.length === 0) {
      return [];
    }

    const goalTokens = this.buildGoalTokens(goal);
    const domainTermsNormalized = this.normalizeDomainTerms(domainTerms);

    const normalized = lines
      .map((line, idx) => this.normalizeLine(line, idx, goalTokens, domainTermsNormalized))
      .filter((line): line is NormalizedLine => Boolean(line))
      .sort((a, b) => a.timestamp - b.timestamp);

    if (normalized.length === 0) {
      return [];
    }

    const windowMinutesNormalized = this.clamp(
      Number.isFinite(windowMinutes) ? Number(windowMinutes) : this.config.defaultWindowMinutes,
      1,
      10
    );
    const windowMs = windowMinutesNormalized * 60_000;
    const latestTimestamp = normalized[normalized.length - 1].timestamp;
    const cutoff = latestTimestamp - windowMs;
    const windowed = normalized.filter((line) => line.timestamp >= cutoff);

    if (windowed.length === 0) {
      return [];
    }

    const episodes: GuidanceEpisode[] = [];
    let builder: EpisodeBuilder | null = null;
    let previous: NormalizedLine | null = null;
    let episodeIndex = 0;

    for (const line of windowed) {
      if (!builder) {
        builder = this.startEpisode(++episodeIndex, line);
        previous = line;
        continue;
      }

      const gapMs = line.timestamp - (previous?.timestamp ?? line.timestamp);
      const lexicalSimilarity = previous ? this.lexicalSimilarity(previous.tokens, line.tokens) : 1;
      const currentAlignmentAvg = builder.alignmentSum / builder.lines.length;
      const alignmentDelta = Math.abs(line.alignment - currentAlignmentAvg);
      const shouldSplit =
        gapMs > this.config.silenceBreakMs ||
        lexicalSimilarity < this.config.lexicalHardBreak ||
        (lexicalSimilarity < this.config.lexicalCohesionBreak && alignmentDelta > this.config.alignmentSoftBreak) ||
        alignmentDelta > this.config.alignmentHardBreak;

      if (shouldSplit) {
        episodes.push(this.finalizeEpisode(builder));
        builder = this.startEpisode(++episodeIndex, line);
      } else {
        this.appendToEpisode(builder, line, lexicalSimilarity);
      }

      previous = line;
    }

    if (builder) {
      episodes.push(this.finalizeEpisode(builder));
    }

    return episodes;
  }

  selectWindows(
    episodes: GuidanceEpisode[],
    goal: string | undefined,
    now: number,
    budgets: GuidanceWindowBudgets
  ): GuidanceWindowSelection {
    if (!Array.isArray(episodes) || episodes.length === 0) {
      return {
        aligned: [],
        current: [],
        drift: this.emptyDriftMetrics(),
        inputQuality: this.emptyInputQuality(),
      };
    }

    const sorted = episodes.slice().sort((a, b) => a.start - b.start);
    const currentEpisode = sorted[sorted.length - 1];
    const priorEpisodes = sorted.slice(0, -1);

    const alignedCandidate = this.findBestAlignedEpisode(priorEpisodes);
    const priorAlignment = alignedCandidate?.alignmentScore ?? currentEpisode.alignmentScore;
    const alignmentDelta = this.clamp(priorAlignment - currentEpisode.alignmentScore, -1, 1);

    const driftStartIndex = this.findDriftStartIndex(sorted, priorAlignment, currentEpisode.alignmentScore);
    const driftEpisodes = sorted.slice(driftStartIndex);
    const driftPersistentMs = Math.max(0, now - driftEpisodes[0].start);

    const alignedLinesSource = alignedCandidate?.lines ?? priorEpisodes.flatMap((ep) => ep.lines);
    const aligned = this.trimLinesToBudget(alignedLinesSource, budgets);

    const currentLinesSource = driftEpisodes.flatMap((ep) => ep.lines);
    const current = this.trimLinesToBudget(currentLinesSource, budgets);

    const drift: GuidanceDriftMetrics = {
      alignmentDelta,
      persistentMs: driftPersistentMs,
      priorAlignment,
      currentAlignment: currentEpisode.alignmentScore,
      lastAlignedAt: alignedCandidate ? alignedCandidate.end : null,
    };

    const inputQuality = this.calculateInputQuality(sorted, alignmentDelta, budgets);

    return { aligned, current, drift, inputQuality };
  }

  scoreAlignment(text: string, goal: string | undefined, domainTerms: string[] | undefined): number {
    if (!text || typeof text !== 'string') {
      return 0;
    }
    const tokens = this.tokenize(text);
    if (tokens.length === 0) {
      return 0;
    }
    const goalTokens = this.buildGoalTokens(goal);
    const domainTermsNormalized = this.normalizeDomainTerms(domainTerms);
    return this.scoreAlignmentFromTokens(tokens, text.toLowerCase(), goalTokens, domainTermsNormalized);
  }

  private startEpisode(index: number, line: NormalizedLine): EpisodeBuilder {
    return {
      id: `episode-${index}`,
      lines: [line],
      alignmentSum: line.alignment,
      confidenceSum: line.sttConfidence,
      charCount: line.charCount,
      tokenCount: line.tokens.length,
      cohesionSum: 0,
      cohesionPairs: 0,
      start: line.timestamp,
      end: line.timestamp,
    };
  }

  private appendToEpisode(builder: EpisodeBuilder, line: NormalizedLine, lexicalSimilarity: number): void {
    builder.lines.push(line);
    builder.alignmentSum += line.alignment;
    builder.confidenceSum += line.sttConfidence;
    builder.charCount += line.charCount;
    builder.tokenCount += line.tokens.length;
    builder.end = line.timestamp;
    if (builder.lines.length > 1) {
      builder.cohesionSum += lexicalSimilarity;
      builder.cohesionPairs += 1;
    }
  }

  private finalizeEpisode(builder: EpisodeBuilder): GuidanceEpisode {
    const durationMs = Math.max(1000, builder.end - builder.start || 0);
    const lexicalCohesion = builder.cohesionPairs > 0 ? builder.cohesionSum / builder.cohesionPairs : 1;
    const alignmentScore = builder.alignmentSum / builder.lines.length;
    const averageConfidence = builder.confidenceSum / builder.lines.length;

    return {
      id: builder.id,
      start: builder.start,
      end: builder.end,
      durationMs,
      lines: builder.lines.map((line) => ({
        text: line.text,
        timestamp: line.timestamp,
        speakerLabel: line.speakerLabel,
        sequence: line.sequence,
        sttConfidence: line.sttConfidence,
      })),
      lexicalCohesion: this.clamp(lexicalCohesion, 0, 1),
      alignmentScore: this.clamp(alignmentScore, 0, 1),
      averageConfidence: this.clamp(averageConfidence, 0, 1),
      charCount: builder.charCount,
      tokenCount: builder.tokenCount,
    };
  }

  private findBestAlignedEpisode(episodes: GuidanceEpisode[]): GuidanceEpisode | undefined {
    return episodes
      .filter((episode) => episode.lines.length > 0)
      .reduce<GuidanceEpisode | undefined>((best, episode) => {
        if (!best) return episode;
        if (episode.alignmentScore > best.alignmentScore) {
          return episode;
        }
        if (episode.alignmentScore === best.alignmentScore && episode.end > best.end) {
          return episode;
        }
        return best;
      }, undefined);
  }

  private findDriftStartIndex(episodes: GuidanceEpisode[], priorAlignment: number, currentAlignment: number): number {
    const threshold = Math.max(this.config.driftReturnThreshold, priorAlignment - currentAlignment);
    for (let i = episodes.length - 1; i >= 0; i--) {
      const episode = episodes[i];
      const delta = priorAlignment - episode.alignmentScore;
      if (delta < threshold * 0.5) {
        return Math.min(i + 1, episodes.length - 1);
      }
    }
    return Math.max(episodes.length - 1, 0);
  }

  private trimLinesToBudget(lines: GuidanceTranscriptLine[], budgets: GuidanceWindowBudgets): GuidanceTranscriptLine[] {
    if (!Array.isArray(lines) || lines.length === 0) {
      return [];
    }

    const sanitized = lines
      .filter((line) => typeof line?.text === 'string' && line.text.trim().length >= this.config.minLineLength)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (sanitized.length === 0) {
      return [];
    }

    const selected: GuidanceTranscriptLine[] = [];
    let usedChars = 0;

    for (let i = sanitized.length - 1; i >= 0; i--) {
      const candidate = sanitized[i];
      const text = candidate.text.trim();
      if (!text) continue;
      const remainingChars = budgets.maxChars - usedChars;
      if (remainingChars <= 0) {
        break;
      }

      let finalText = text;
      if (text.length > budgets.maxChars && selected.length === 0) {
        finalText = text.slice(text.length - budgets.maxChars);
      } else if (text.length > remainingChars) {
        if (selected.length > 0) {
          continue;
        }
        finalText = text.slice(text.length - remainingChars);
      }

      selected.unshift({
        text: finalText,
        timestamp: candidate.timestamp,
        speakerLabel: candidate.speakerLabel,
        sequence: candidate.sequence,
        sttConfidence: candidate.sttConfidence,
      });
      usedChars += finalText.length;

      if (selected.length >= budgets.maxLines) {
        break;
      }
    }

    return selected;
  }

  private calculateInputQuality(
    episodes: GuidanceEpisode[],
    alignmentDelta: number,
    budgets: GuidanceWindowBudgets
  ): GuidanceInputQuality {
    if (episodes.length === 0) {
      return this.emptyInputQuality();
    }

    const totalLines = episodes.reduce((acc, episode) => acc + episode.lines.length, 0);
    const confidence =
      totalLines > 0
        ? episodes.reduce((acc, episode) => acc + episode.averageConfidence * episode.lines.length, 0) / totalLines
        : 0;

    const span = episodes[episodes.length - 1].end - episodes[0].start;
    const coverage = budgets.windowMs > 0 ? this.clamp(span / budgets.windowMs, 0, 1) : 0;

    return {
      sttConfidence: this.clamp(confidence, 0, 1),
      coverage,
      alignmentDelta: this.clamp(Math.abs(alignmentDelta), 0, 1),
      episodeCount: episodes.length,
    };
  }

  private normalizeLine(
    line: GuidanceTranscriptLine,
    index: number,
    goalTokens: Set<string>,
    domainTerms: { tokens: Set<string>; phrases: string[] }
  ): NormalizedLine | null {
    if (!line || typeof line.text !== 'string') {
      return null;
    }
    const trimmed = line.text.trim();
    if (!trimmed) {
      return null;
    }

    const timestamp = Number.isFinite(line.timestamp) ? Number(line.timestamp) : Date.now();
    const tokens = this.tokenize(trimmed);
    if (tokens.length === 0) {
      return null;
    }

    const confidence = typeof line.sttConfidence === 'number' && Number.isFinite(line.sttConfidence)
      ? this.clamp(line.sttConfidence, 0, 1)
      : 0.75;

    const alignment = this.scoreAlignmentFromTokens(tokens, trimmed.toLowerCase(), goalTokens, domainTerms);

    return {
      text: trimmed,
      timestamp,
      speakerLabel: line.speakerLabel,
      sequence: Number.isFinite(line.sequence) ? line.sequence : index,
      sttConfidence: confidence,
      tokens,
      charCount: trimmed.length,
      alignment,
    };
  }

  private tokenize(input: string): string[] {
    if (!input) return [];
    return input
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
  }

  private lexicalSimilarity(a: string[], b: string[]): number {
    if (a.length === 0 || b.length === 0) {
      return 0;
    }
    const setA = new Set(a);
    const setB = new Set(b);
    let intersection = 0;
    for (const token of setA) {
      if (setB.has(token)) {
        intersection += 1;
      }
    }
    const union = setA.size + setB.size - intersection;
    if (union === 0) {
      return 0;
    }
    return intersection / union;
  }

  private scoreAlignmentFromTokens(
    tokens: string[],
    lowercaseText: string,
    goalTokens: Set<string>,
    domainTerms: { tokens: Set<string>; phrases: string[] }
  ): number {
    if (tokens.length === 0) {
      return 0;
    }

    const tokenSet = new Set(tokens);
    let goalHits = 0;
    let domainHits = 0;
    for (const token of tokenSet) {
      if (goalTokens.has(token)) {
        goalHits += 1;
      }
      if (domainTerms.tokens.has(token)) {
        domainHits += 1;
      }
    }

    const goalCoverage = goalTokens.size > 0 ? goalHits / goalTokens.size : 0;
    const domainCoverage = domainTerms.tokens.size > 0 ? domainHits / domainTerms.tokens.size : 0;

    let phraseMatches = 0;
    for (const phrase of domainTerms.phrases) {
      if (lowercaseText.includes(phrase)) {
        phraseMatches += 1;
      }
    }
    const phraseScore = domainTerms.phrases.length > 0 ? phraseMatches / domainTerms.phrases.length : 0;

    const tokenGoalDensity = goalTokens.size > 0 ? this.countMatches(tokens, goalTokens) / tokens.length : 0;
    const tokenDomainDensity = domainTerms.tokens.size > 0 ? this.countMatches(tokens, domainTerms.tokens) / tokens.length : 0;

    const alignment =
      goalCoverage * 0.45 +
      tokenGoalDensity * 0.25 +
      domainCoverage * 0.15 +
      tokenDomainDensity * 0.1 +
      phraseScore * 0.05;

    return this.clamp(alignment, 0, 1);
  }

  private countMatches(tokens: string[], set: Set<string>): number {
    let count = 0;
    for (const token of tokens) {
      if (set.has(token)) {
        count += 1;
      }
    }
    return count;
  }

  private buildGoalTokens(goal: string | undefined): Set<string> {
    if (!goal) {
      return new Set();
    }
    return new Set(this.tokenize(goal));
  }

  private normalizeDomainTerms(domainTerms: string[] | undefined): { tokens: Set<string>; phrases: string[] } {
    if (!Array.isArray(domainTerms) || domainTerms.length === 0) {
      return { tokens: new Set(), phrases: [] };
    }
    const tokens = new Set<string>();
    const phrases: string[] = [];
    for (const term of domainTerms) {
      if (!term || typeof term !== 'string') continue;
      const trimmed = term.trim();
      if (!trimmed) continue;
      const lowered = trimmed.toLowerCase();
      phrases.push(lowered);
      for (const token of this.tokenize(lowered)) {
        tokens.add(token);
      }
    }
    return { tokens, phrases };
  }

  private emptyDriftMetrics(): GuidanceDriftMetrics {
    return {
      alignmentDelta: 0,
      persistentMs: 0,
      priorAlignment: 0,
      currentAlignment: 0,
      lastAlignedAt: null,
    };
  }

  private emptyInputQuality(): GuidanceInputQuality {
    return {
      sttConfidence: 0,
      coverage: 0,
      alignmentDelta: 0,
      episodeCount: 0,
    };
  }

  private clamp(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }
}

export const contextEpisodesService = new ContextEpisodesService();
