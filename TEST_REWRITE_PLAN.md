# Test Rewrite Plan (Alignment with Current APIs and Database Schema)

This document enumerates the tests that should be rewritten to reflect current service APIs, controller behavior, and the live database schema documented in `docs/DATABASE_SCHEMA_COMPLETE.md`.

All examples reference real, implemented code and exact table/column names from the schema. No assumptions.

---

## Scope

- Rewrite tests that still reflect deprecated APIs, mocks, or wrong types
- Keep tests already updated to current APIs
- Ensure all rewritten tests run against a real Databricks/Redis/WebSocket setup per README "Testing Philosophy: Real Database Integration"

---

## Ground Truth References

- Database schema: `docs/DATABASE_SCHEMA_COMPLETE.md`
  - sessions.classroom_sessions (columns include: id, title, status, planned_duration_minutes, actual_duration_minutes, max_students, target_group_size, auto_group_enabled, teacher_id, school_id, ...)
  - sessions.student_groups (id, session_id, name, group_number, status, max_size, current_size, auto_managed, leader_id, is_ready, topical_cohesion, conceptual_density, ...)
  - analytics.session_events (id, session_id, teacher_id, event_type, event_time, payload, created_at)
  - analytics.session_metrics (session_id, participation_rate, ready_groups_at_start, ready_groups_at_5m, ...)
  - sessions.transcriptions (session_id, group_id, content, start_time, end_time, ...)

- Core services/APIs
  - Databricks AI Service: `src/services/databricks-ai.service.ts`
    - `analyzeTier1(transcripts: string[], options: { groupId: string; sessionId: string; focusAreas: ("topical_cohesion"|"conceptual_density")[] })`
    - `analyzeTier2(transcripts: string[], options: { sessionId: string; analysisDepth: "standard"|"comprehensive" })`
  - AIAnalysisBufferService: `src/services/ai-analysis-buffer.service.ts`
    - `bufferTranscription(groupId: string, sessionId: string, transcription: string)`
    - `getBufferedTranscripts(tier: 'tier1'|'tier2', groupId: string, sessionId: string): Promise<string[]>`
    - `markBufferAnalyzed(tier: 'tier1'|'tier2', groupId: string, sessionId: string)`
    - `getBufferStats(): { tier1: BufferStats; tier2: BufferStats }`
  - TeacherPromptService: `src/services/teacher-prompt.service.ts`
    - `generatePrompts(insights: Tier1Insights|Tier2Insights, context: PromptGenerationContext, options?)`
    - `PromptGenerationContext` requires: `{ sessionId, groupId, teacherId, sessionPhase, subject, learningObjectives, groupSize, sessionDuration }`
  - Session Controller: `src/controllers/session.controller.ts`
    - `startSession(req, res)` with retry/timeouts and audit logging

---

## Tests to Rewrite (Priority Order)

### 1) Integration: Analytics Tracking E2E
- File: `src/__tests__/integration/analytics-tracking.e2e.test.ts`
- Issues:
  - Used deprecated Tier1 fields (`participationBalance`, `keyTermsUsed`, `groupDynamics`, etc.)
  - Passed `null` for PromptGenerationContext; `currentTime` not in context
- Rewrite Plan:
  - Use valid `Tier1Insights` per `src/types/ai-analysis.types.ts` (fields: topicalCohesion, conceptualDensity, analysisTimestamp, windowStartTime, windowEndTime, transcriptLength, confidence, insights[])
  - Call `teacherPromptService.generatePrompts(validInsights, validContext, { includeEffectivenessScore: true })`
  - For DB validation, assert against real tables:
    - Insert/select from `classwaves.sessions.classroom_sessions` with columns like `id`, `teacher_id`, `school_id`, `status`, `planned_duration_minutes`
    - Verify analytics writes to `classwaves.analytics.session_metrics` if applicable

### 2) E2E: Realtime Analytics (WebSocket)
- File: `src/__tests__/e2e/realtime-analytics.e2e.test.ts`
- Issues:
  - Outdated connection promises, incorrect resolver typings
- Rewrite Plan:
  - Use `client.on('connect', () => resolve(undefined))`
  - Emit and validate events that map to `analytics.session_events` columns: `event_type` in {configured|started|leader_ready|member_join|member_leave|ended}, `payload` JSON with `groupId` where relevant
  - If persisting metrics, assert via `analytics.session_metrics` rows

### 3) Integration: AI Analysis Pipeline
- File: `src/__tests__/integration/ai-analysis-pipeline.integration.test.ts`
- Issues:
  - Accessing internal health service metrics; wrong metadata field names (`processingTimeMs` vs `processingTime`)
- Rewrite Plan:
  - Drive `databricksAIService.analyzeTier1/2` with:
    - Tier1: `{ groupId, sessionId, focusAreas: ['topical_cohesion','conceptual_density'] }`
    - Tier2: `{ sessionId, analysisDepth: 'comprehensive' }`
  - Validate result shapes per `src/types/ai-analysis.types.ts` and use `metadata.processingTimeMs`
  - If needed, assert buffer interactions via `AIAnalysisBufferService`

### 4) Integration: Guidance System Concurrent
- File: `src/__tests__/integration/load/guidance-system-concurrent.test.ts`
- Issues:
  - Direct access to private `metrics`; outdated Tier1/Tier2 calls
- Rewrite Plan:
  - Remove private metric mutations
  - Use `AIAnalysisBufferService` methods listed above
  - For concurrency, coordinate with Redis locks as implemented in `analytics-computation-lock.service.ts`

### 5) Routes: Sessions API
- File: `src/__tests__/integration/routes/session.routes.test.ts`
- Status:
  - Converted to real DB usage; other route suites are `describe.skip`
- Rewrite Plan:
  - Unskip progressively and use real DB inserts aligned to schema:
    - Insert into `sessions.classroom_sessions` using columns from schema (e.g., `id`, `teacher_id`, `status`='created', `planned_duration_minutes`, `max_students`, `target_group_size`, `auto_group_enabled`)
    - For `student_groups`, ensure required columns: `status`, `max_size`, `current_size`, `auto_managed`, `is_ready` (bool), `leader_id` (nullable)
  - Validate GET/POST/PUT/DELETE behavior with real rows

---

## Canonical Test Data Shapes (Align to Schema)

### sessions.classroom_sessions (insert example)
```sql
INSERT INTO classwaves.sessions.classroom_sessions (
  id, title, status, planned_duration_minutes, max_students, target_group_size,
  auto_group_enabled, teacher_id, school_id, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

### sessions.student_groups (insert example)
```sql
INSERT INTO classwaves.sessions.student_groups (
  id, session_id, name, group_number, status, max_size, current_size,
  auto_managed, is_ready, created_at, updated_at
) VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?, ?, ?)
```

### analytics.session_events (insert example)
```sql
INSERT INTO classwaves.analytics.session_events (
  id, session_id, teacher_id, event_type, event_time, payload, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
```

---

## Service Call Patterns (Use Exactly)

- Tier1
```ts
const tier1 = await databricksAIService.analyzeTier1(transcripts, {
  groupId,
  sessionId,
  focusAreas: ['topical_cohesion','conceptual_density']
});
```

- Tier2
```ts
const tier2 = await databricksAIService.analyzeTier2(transcripts, {
  sessionId,
  analysisDepth: 'comprehensive'
});
```

- Buffer Service
```ts
await aiAnalysisBufferService.bufferTranscription(groupId, sessionId, 'text');
const t1 = await aiAnalysisBufferService.getBufferedTranscripts('tier1', groupId, sessionId);
await aiAnalysisBufferService.markBufferAnalyzed('tier1', groupId, sessionId);
```

- Prompt Generation
```ts
const prompts = await teacherPromptService.generatePrompts(tier1, {
  sessionId,
  groupId,
  teacherId,
  sessionPhase: 'development',
  subject: 'science',
  learningObjectives: ['objective'],
  groupSize: 4,
  sessionDuration: 30
}, {
  includeEffectivenessScore: true,
  maxPrompts: 3,
  priorityFilter: 'all'
});
```

---

## Rewrite Execution Order

1. analytics-tracking.e2e.test.ts (align insights + context + DB asserts)
2. realtime-analytics.e2e.test.ts (WebSocket connect/emit + analytics.session_events)
3. ai-analysis-pipeline.integration.test.ts (metadata fields, remove private metrics)
4. guidance-system-concurrent.test.ts (concurrency, buffer service, remove private access)
5. routes/session.routes.test.ts (unskip other routes, real inserts per schema)

---

## Done Tests (No Rewrite Needed)

- `src/__tests__/unit/analytics-computation.service.test.ts` (aligned to new overview/result shapes)
- `src/__tests__/unit/services/ai-analysis-buffer.service.test.ts` (rewritten to current API)
- `src/__tests__/unit/services/teacher-prompt.service.test.ts` (rewritten to current API)

---

## Notes

- Always start backend for integration tests: `NODE_ENV=test E2E_TEST_SECRET=test npm run dev`
- Ensure Redis is running and accessible; buffer service relies on it
- Avoid accessing private properties (like `['metrics']`) in services; validate via public outputs or persisted records
