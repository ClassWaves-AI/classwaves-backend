# Guidance Testing Reference

This document captures the transcript replay fixture standards introduced for WaveListener v0.3. It complements the architecture notes in `docs/ai/WAVELISTENER-AI-INSIGHTS-ENGINE.md#16-transcript-replay-qa--fixture-harness` and should be consulted before updating integration suites or manual QA tooling.

## Fixture Library
- Location: `src/__tests__/integration/guidance/fixtures/`
- Format: JSON files following the schema documented in `fixtures/README.md`
  - `metadata` describes the classroom scenario, goal alignment, and drift profile.
  - `featureFlags` toggles simulation-only overrides (e.g., `cwGuidanceEpisodesEnabled`).
  - `playback` provides pacing hints for the replay harness.
  - `expectations` encodes deterministic assertions (Tier1/Tier2 counts, metric tolerances).
  - `transcript` is an ordered array of `GuidanceTranscriptLine` records with anonymized content.
- Coverage: six core fixtures span on-track alignment, light/heavy drift, low STT confidence, recovery, and the legacy guidance context fallback path.

## Loader Utility
- Implemented in `src/__tests__/integration/guidance/fixtures/fixture-loader.ts`
- Responsibilities:
  - Enumerate available fixtures (`listGuidanceFixtures`)
  - Load a specific fixture by id (`loadGuidanceFixture`)
  - Validate schema, sanitize speaker casing, and enforce chronological ordering
- Validation uses Zod so any malformed file fails fast during tests. The loader is consumed by the replay harness (Ticket T2), CLI tooling (Ticket T4), and metrics regression (Ticket T5).
When the live gating logic suppresses Tier1 auto-prompts (for example during warm-up windows), the integration harness synthesizes prompts using the same fixture-derived insights so downstream assertions can still validate prompt payload structure. This fallback keeps the replay deterministic while preserving the emitted WebSocket events the UI consumes.

## Quality Checks
- Run `npm test -- --runTestsByPath src/__tests__/unit/utils/guidance-fixture-loader.test.ts` after editing fixtures.
- Run `npm run guidance:test:fixtures` to exercise the replay harness across all fixtures.
- JSON and Markdown formatting are covered by the standard lint/format commands (`npm run lint`, `npm run format:check`).
- When adding fixtures, update both this document and `fixtures/README.md` to record the scenario purpose and expectations.

## Transcript Replay CLI
- Script: `node scripts/replay-transcript.js` (aliased via `npm run guidance:replay`).
- Guard: requires `CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED=1` and a teacher JWT in `CW_GUIDANCE_TRANSCRIPT_TOKEN`.
- Usage example:
  - `CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED=1 CW_GUIDANCE_TRANSCRIPT_TOKEN=$JWT npm run guidance:replay -- --dev --fixture ecosystem_heavy_drift_tier2 --session <sessionId> --group <groupId> --speed 2`
- Behaviour: streams the selected fixture through the dev-only `/api/v1/dev/guidance/fixtures/replay` endpoint, subscribes to the `/guidance` namespace, and logs Tier1/Tier2 insights plus emitted prompts.
- Additional docs: see `docs/Transcript-Replay.md` for safeguards, environment setup, and troubleshooting.

## Metrics Snapshots
- Baselines: JSON snapshots live under `src/__tests__/integration/guidance/fixtures/metrics/*.metrics.json` (per fixture).
- Purpose: Guard the shape of guidance histograms (`guidance_context_episode_count`, `guidance_context_selection_latency_ms`, `guidance_drift_persistence_seconds`, `guidance_context_alignment_delta`).
- Refresh flow: `GUIDANCE_FIXTURE_METRICS_SNAPSHOT=1 npm run guidance:test:fixtures` rewrites baselines after verifying deterministic output. Commit the updated files with a rationale in the PR description.
- CI/Test behaviour: Without the flag the harness diffs current output against the committed snapshot and fails fast with actionable diffs if drift is detected.
