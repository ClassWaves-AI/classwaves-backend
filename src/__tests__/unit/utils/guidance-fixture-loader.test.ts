import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  listGuidanceFixtures,
  loadGuidanceFixture,
  parseFixtureFromFile,
} from '../../../guidance/fixture-library';

describe('guidance fixture loader', () => {
  it('lists and loads curated fixtures', () => {
    const summaries = listGuidanceFixtures();
    // Expect at least the curated 6
    expect(summaries.length).toBeGreaterThanOrEqual(6);
    // Expect known IDs present
    const ids = summaries.map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining([
      'ecosystem_on_track',
      'ecosystem_light_drift',
      'ecosystem_heavy_drift_tier2',
      'math_low_confidence_audio',
      'history_recovery_loop',
      'seminar_cross_talk_fallback',
    ]));

    const one = loadGuidanceFixture('ecosystem_on_track');
    expect(one.metadata.id).toBe('ecosystem_on_track');
    expect(one.transcript.length).toBeGreaterThan(0);
  });

  it('rejects out-of-order timestamps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-fixture-'));
    const badPath = path.join(dir, 'bad.json');
    fs.writeFileSync(
      badPath,
      JSON.stringify(
        {
          metadata: {
            id: 'bad',
            title: 'Bad ordering',
            description: 'out of order timestamps',
            subject: 'science',
            driftProfile: 'light_drift',
            tags: [],
          },
          featureFlags: {},
          playback: {},
          expectations: {},
          transcript: [
            { text: 'A', timestamp: 1000, sequence: 1, sttConfidence: 0.9 },
            { text: 'B', timestamp: 500, sequence: 2, sttConfidence: 0.9 },
          ],
        },
        null,
        2
      )
    );

    expect(() => parseFixtureFromFile(badPath)).toThrow(/out-of-order timestamps/);
  });
});

