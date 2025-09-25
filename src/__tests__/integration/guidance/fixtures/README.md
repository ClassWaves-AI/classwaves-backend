# Guidance Transcript Fixture Library

This library contains sanitized transcript fixtures used by the WaveListener v0.3 replay harness. Fixtures are deterministic inputs that allow us to validate Tier1/Tier2 insights, prompt generation, and context metrics without relying on live classroom audio.

All fixtures follow the standards in `docs/ai/WAVELISTENER-AI-INSIGHTS-ENGINE.md#16-transcript-replay-qa--fixture-harness` and the coding/test guidance from `docs/ai/CODING-STANDARD.md` and `docs/ai/TESTING-STANDARDS.md`.

## Schema
```json
{
  "metadata": {
    "id": "ecosystem_on_track",
    "title": "Ecosystem energy stays on-topic",
    "description": "Baseline on-track discussion used to confirm gating suppression.",
    "goal": "Students describe how energy transfers among producers, consumers, and decomposers.",
    "subject": "science",
    "gradeBand": "6-8",
    "domainTerms": ["energy transfer", "producers", "consumers", "decomposers"],
    "driftProfile": "on_track",
    "driftNotes": "Alignment remains above Tier1 gating threshold.",
    "tags": ["tier1", "baseline"]
  },
  "featureFlags": {
    "cwGuidanceEpisodesEnabled": true
  },
  "playback": {
    "msBetweenLines": 4500
  },
  "expectations": {
    "tier1": {
      "expectedPromptCount": 0,
      "gating": "on_track"
    },
    "tier2": {
      "expectedInsightCount": 0
    },
    "metrics": {
      "guidance_context_episode_count": { "type": "min", "value": 1 }
    }
  },
  "transcript": [
    {
      "timestamp": 0,
      "text": "Teacher: Let's recap how energy moves through an ecosystem.",
      "speakerLabel": "teacher",
      "sequence": 1,
      "sttConfidence": 0.97
    }
  ]
}
```

### Field notes
- `metadata.id` — File name stem and unique identifier for the fixture.
- `metadata.driftProfile` — Scenario shorthand (`on_track`, `light_drift`, `heavy_drift`, `recovery`, `low_confidence`, `mixed`).
- `featureFlags` — Overrides applied during replay (defaults to production flags when omitted).
- `playback` — Optional pacing hints used by the harness to simulate streaming (milliseconds between transcript lines, chunk sizing).
- `expectations` — Optional assertions consumed by the replay harness and metrics regression tooling.
  - `metrics` expectations support `type: exact | approx | min | max`.
- `transcript` — Ordered array of anonymized lines matching the `GuidanceTranscriptLine` port (`text`, `timestamp`, optional `speakerLabel`, `sequence`, `sttConfidence`).

All transcript content is synthetic and scrubbed of PII. Avoid verbatim phrases longer than five tokens from live classrooms.

## Available fixtures

| ID | Scenario | Drift profile | Notes |
| --- | --- | --- | --- |
| `ecosystem_on_track` | Baseline energy flow seminar | `on_track` | Confirms Tier1 suppression when alignment is high. |
| `ecosystem_light_drift` | Small talk drifts briefly | `light_drift` | Tests Tier1 redirection prompt generation. |
| `ecosystem_heavy_drift_tier2` | Topic leaves goal entirely | `heavy_drift` | Exercises Tier2 recommendations and Tier1 gating. |
| `math_low_confidence_audio` | Whisper confidence drop | `low_confidence` | Ensures low input quality suppresses prompts. |
| `history_recovery_loop` | Drift then recovery | `recovery` | Validates `why` metadata and recovery summary. |
| `seminar_cross_talk_fallback` | Episodes flag off | `mixed` | Validates fallback path when `cw.guidance.episodes.enabled` is disabled. |

## Adding fixtures
1. Create a new `<id>.json` file following the schema above.
2. Keep timestamps monotonic and represent milliseconds from fixture start.
3. Sanitize speech content and favor generic speaker labels (e.g., `Student 1`).
4. Update expectations only for deterministic assertions; leave empty when behaviour is exploratory.
5. Run `npm test -- --runTestsByPath src/__tests__/unit/utils/guidance-fixture-loader.test.ts` to validate shape.
6. Document the fixture purpose here and in `classwaves-backend/docs/TESTING-GUIDANCE.md`.

## Usage
Fixtures are loaded via `loadGuidanceFixture(id)` in `fixture-loader.ts`. The replay harness (Ticket T2) consumes the parsed structure to simulate streaming through Tier1/Tier2 pipelines and to capture metrics snapshots (Ticket T5).

