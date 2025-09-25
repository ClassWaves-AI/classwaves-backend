# Transcript Replay CLI

When to use: Manual QA and exploratory verification of WaveListener v0.3 guidance using deterministic transcript fixtures. Complements the automated harness documented in `docs/ai/WAVELISTENER-AI-INSIGHTS-ENGINE.md#16-transcript-replay-qa--fixture-harness`.

## Prerequisites
- Backend running in dev or staging (never production).
- Feature flag: `CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED=1`.
- Teacher JWT: export `CW_GUIDANCE_TRANSCRIPT_TOKEN` with a valid access token for the target environment.
- Session + group ready to receive guidance events.

## Admin UI alternative
- Prefer a visual flow? With `CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED=1` on the backend, visit `/admin/guidance-replay` (see [ADR 2025-09-23-ui-for-transcript-tests](../../docs/adr/UI%20for%20Transcript%20Tests/2025-09-23-ui-for-transcript-tests.md)).
- The Admin UI surfaces the same fixtures catalogue, run controls, metrics diffing, and guarded baseline updates described below; the CLI remains available for headless usage and automation. Baseline writes remain opt-in via `NEXT_PUBLIC_GUIDANCE_FIXTURES_ALLOW_BASELINE_UPDATES=1` on the frontend.

## Command
```bash
npm run guidance:replay -- --dev --fixture ecosystem_heavy_drift_tier2 --session <sessionId> --group <groupId> --speed 1.5 --metrics
```

Flags:
- `--dev` — required safety acknowledgement.
- `--fixture <id>` — matches JSON file under `src/__tests__/integration/guidance/fixtures/`.
- `--session <uuid>` — active classroom session to target.
- `--group <uuid>` — group within the session (defaults to session id when omitted).
- `--speed <multiplier>` — playback speed (defaults to 1×). Combine with `--delay <ms>` to override the base cadence.
- `--loop <n>` — repeat the replay multiple times for endurance checks.
- `--metrics` — print Prometheus snapshot returned by the dev endpoint.

## Behaviour
1. Connects to `/guidance` namespace via `socket.io` using the provided teacher token.
2. Subscribes to `guidance:subscribe` and `session:guidance:subscribe` for the target session.
3. Calls the dev-only endpoint `POST /api/v1/dev/guidance/fixtures/replay`.
4. Streams transcript lines with optional per-line delay, then triggers Tier1/Tier2 analysis.
5. Logs Tier1/Tier2 WS payloads and emitted prompts (includes `why` metrics). Optional metrics snapshot reflects `guidance_context_episode_count`, `guidance_context_selection_latency_ms`, `guidance_drift_persistence_seconds`, and related histograms.

## Safety & Troubleshooting
- Route is disabled unless `CW_GUIDANCE_TRANSCRIPT_FIXTURES_ENABLED=1` and `NODE_ENV !== 'production'` (enforced server-side).
- If no prompts appear, confirm the session’s teacher owns the target group and `GUIDANCE_AUTO_PROMPTS` is enabled (fixture flags toggle automatically per metadata).
- `HTTP 401`: verify `CW_GUIDANCE_TRANSCRIPT_TOKEN` is a fresh teacher JWT and the backend recognises the session.
- `FIXTURE_NOT_FOUND`: ensure the repo is synced; fixtures live under `src/__tests__/integration/guidance/fixtures`.
- To update cadence defaults, edit the fixture’s `playback.msBetweenLines` or pass CLI overrides.

## Related Automation & UI
- Deterministic integration suite: `npm run guidance:test:fixtures`.
- Metrics regression tooling: see Ticket T5 implementation notes and `docs/ai/TESTING-STANDARDS.md`.
- Admin UI replay console: `/admin/guidance-replay` (dev/staging only, gated by `NEXT_PUBLIC_GUIDANCE_FIXTURES_UI_ENABLED=1`).
- Fixture schema reference: `src/__tests__/integration/guidance/fixtures/README.md`.
