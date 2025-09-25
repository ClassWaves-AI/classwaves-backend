import { ContextEpisodesService } from '../../../services/context-episodes.service';
import type { GuidanceTranscriptLine } from '../../../services/ports/guidance-context.port';

describe('ContextEpisodesService', () => {
  const service = new ContextEpisodesService();

  const buildLine = (text: string, timestamp: number, confidence = 0.82): GuidanceTranscriptLine => ({
    text,
    timestamp,
    sttConfidence: confidence,
  });

  it('segments episodes when silence and lexical drift occur', () => {
    const base = Date.now();
    const lines: GuidanceTranscriptLine[] = [
      buildLine('We defined photosynthesis as the way plants turn light into energy', base - 230000),
      buildLine('Energy gets stored inside the chloroplast and fuels the plant', base - 228000),
      buildLine('Remember that the goal is to compare light and dark reactions', base - 226000),
      // silence gap (35s)
      buildLine('So the soccer game last night was intense and physical', base - 190000),
      buildLine('We should plan the next practice drills for midfielders', base - 188000),
    ];

    const episodes = service.buildEpisodes(lines, 'compare light and dark reactions', ['chloroplast', 'photosynthesis'], 6);

    expect(episodes.length).toBeGreaterThanOrEqual(2);
    const sortedByAlignment = [...episodes].sort((a, b) => b.alignmentScore - a.alignmentScore);
    const mostAligned = sortedByAlignment[0];
    const mostCurrent = episodes[episodes.length - 1];
    expect(mostAligned.alignmentScore).toBeGreaterThan(mostCurrent.alignmentScore);
    expect(mostAligned.lexicalCohesion).toBeGreaterThan(0.2);
    expect(mostCurrent.alignmentScore).toBeLessThanOrEqual(0.1);
  });

  it('selects aligned and current windows with drift metrics and quality scores', () => {
    const now = Date.now();
    const lines: GuidanceTranscriptLine[] = [
      buildLine('We mapped the chloroplast structure and light reactions already', now - 240000),
      buildLine('Light energy powers ATP which is the main goal of today', now - 210000),
      buildLine('Compare this to the Calvin cycle outputs to stay aligned', now - 185000),
      buildLine('Anyway the cafeteria menu has pizza and tacos tomorrow', now - 60000, 0.62),
      buildLine('People keep talking about the soccer match strategy now', now - 30000, 0.55),
    ];

    const episodes = service.buildEpisodes(lines, 'light reactions ATP goal', ['chloroplast', 'calvin cycle'], 6);
    const budgets = { maxChars: 360, maxLines: 4, windowMs: 6 * 60_000 };
    const selection = service.selectWindows(episodes, 'light reactions ATP goal', now, budgets);

    expect(selection.aligned.length).toBeGreaterThan(0);
    expect(selection.current.length).toBeGreaterThan(0);
    expect(selection.drift.alignmentDelta).toBeGreaterThan(0);
    expect(selection.drift.persistentMs).toBeGreaterThanOrEqual(0);
    expect(selection.inputQuality.sttConfidence).toBeGreaterThan(0.6);
    expect(selection.inputQuality.coverage).toBeGreaterThan(0.5);
    expect(selection.inputQuality.episodeCount).toBe(episodes.length);
  });

  it('scores alignment using goal overlap and domain terms', () => {
    const scoreHigh = service.scoreAlignment(
      'Students compared light reactions and chloroplast structure with detail',
      'compare light reactions',
      ['chloroplast', 'structure']
    );
    const scoreLow = service.scoreAlignment('They discussed weekend sports plans and snacks', 'compare light reactions', ['chloroplast']);

    expect(scoreHigh).toBeGreaterThan(scoreLow);
    expect(scoreHigh).toBeGreaterThan(0.3);
    expect(scoreLow).toBeLessThan(0.2);
  });

  it('returns empty selections when no episodes are available', () => {
    const budgets = { maxChars: 240, maxLines: 3, windowMs: 6 * 60_000 };
    const selection = service.selectWindows([], 'goal', Date.now(), budgets);

    expect(selection.aligned).toHaveLength(0);
    expect(selection.current).toHaveLength(0);
    expect(selection.inputQuality.episodeCount).toBe(0);
    expect(selection.drift.alignmentDelta).toBe(0);
  });
});
