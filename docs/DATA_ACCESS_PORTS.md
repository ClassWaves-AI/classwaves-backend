# Data Access Ports and Adapters

This backend follows Hexagonal Architecture. Domain/services depend on ports (interfaces) declared under `src/services/ports`, and adapters implement those ports under `src/adapters/**`.

## Ports Overview
- `analytics.repository.port.ts`: analytics read/write methods
  - `getTeacherPromptMetrics(teacherId, timeframe)`
  - `verifySessionOwnership(sessionId, teacherId, schoolId)`
  - `getPlannedVsActual(sessionId)`
  - `getReadinessEvents(sessionId)`
  - `getActualGroupCounts(sessionId)`
  - `getMembershipAnalytics(sessionId)`
  - `getSessionGroupsAnalytics(sessionId)`
  - `getSessionFinalSummary(sessionId)`
  - `getLegacyMembershipRows(sessionId)`
  - `upsertSessionMetrics(sessionId, data)`
  - `updateSessionMetrics(sessionId, fields)`
  - `insertTier1Analysis(data)` / `insertTier2Analysis(data)`
  - `getTier1Results(sessionId, { groupIds?, includeHistory?, hoursBack?, order? })`
  - `getTier2Results(sessionId, { includeHistory?, hoursBack?, order? })`
- `group.repository.port.ts`: group listings, members and counts
- `session.repository.port.ts`: session lifecycle and queries
- `session-detail.repository.port.ts`: detailed session information
- `session-stats.repository.port.ts`: aggregated stats
- `participant.repository.port.ts`: participant membership
- `roster.repository.port.ts`: student roster queries
- `admin.repository.port.ts`: school/teacher admin queries
- `budget.repository.port.ts`: budget/limits
- `health.repository.port.ts`: server time, table counts
- `monitoring.repository.port.ts`: SQL execution, table inspection

## Adapters
- Databricks implementations live in `src/adapters/repositories/*`
- Other adapters (e.g., email, AI analysis) under `src/adapters/*`

## Projection Rules (No SELECT *)
- Always select explicit columns; never use `SELECT *` or alias-star like `t.*`
- For counts: prefer `COUNT(*) AS some_alias` with explicit LIMIT where appropriate
- Tests must validate SQL shapes for new methods

## Adding a New Repository Method
1. Define it on the relevant port interface under `src/services/ports/...`
2. Implement on the adapter with explicit projection and parameterized conditions
3. Add unit tests under `src/__tests__/unit/repositories/` to assert SQL shape
   - Example pattern: mirror `group.repository.projections.sql.test.ts`
4. If exposed via routes, keep Zod at the edge in the router/middleware layer
5. Wire via composition root to ensure controllers use ports (never raw services)

## Compliance Guardrails
- Controllers must not import or call `databricksService` directly (architecture test enforces this)
- Domain/services remain framework-free; validation at the edge only

