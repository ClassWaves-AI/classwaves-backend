# ClassWaves Backend

<div align="center">

![ClassWaves](https://img.shields.io/badge/ClassWaves-Backend-blue)
![Node.js](https://img.shields.io/badge/node.js-18%2B-brightgreen)
![TypeScript](https://img.shields.io/badge/typescript-5.3-blue)
![Express](https://img.shields.io/badge/express-4.18-green)
![Databricks](https://img.shields.io/badge/databricks-unity%20catalog-orange)
![License](https://img.shields.io/badge/license-Proprietary-red)

**Educational platform backend service for real-time classroom collaboration with AI-powered insights**

[Features](#features) • [Quick Start](#quick-start) • [API Documentation](#api-documentation) • [Database](#database-architecture) • [Testing](#testing)

</div>

## Docs-First (Authoritative Standards)

- Start at `docs/INDEX.md` → `docs/ai/INDEX.md` for platform-wide standards and architecture.
- Repository guidelines and agent expectations: `AGENTS.md` (root).
- Most relevant docs for this repo:
  - Coding: `docs/ai/CODING-STANDARD.md`
  - Security: `docs/ai/SECURITY.md`
  - Testing: `docs/ai/TESTING-STANDARDS.md`
  - Platform Architecture: `docs/ai/PLATFORM-ARCHITECTURE.md`
  - API Documentation: `docs/ai/API-DOCUMENTATION.md`
  - Tools & Automation: `docs/ai/TOOLS-AUTOMATION.md`

Following these is mandatory; keep changes aligned and record decisions as ADRs in `docs/adr/` when non-trivial.

## Table of Contents

- [Features](#features)
- [Architecture Overview](#architecture-overview)
- [Database Architecture](#database-architecture)
- [Quick Start](#quick-start)
- [API Documentation](#api-documentation)
- [WebSocket Events](#websocket-events)
- [REST-First Session Control](#rest-first-session-control)
- [Admin Controls](#admin-controls)
- [Testing](#testing)
- [Security & Compliance](#security--compliance)
- [Monitoring & Health](#monitoring--health)
- [Development](#development)
- [Deployment](#deployment)
- [Repository Integration](#repository-integration)
- [Contributing](#contributing)
 - [Logging & Trace IDs](#logging--trace-ids)

## Features

🎯 **Core Capabilities**
- **Real-time Collaboration**: WebSocket-powered classroom sessions
- **AI-Powered Analytics**: Two-tier AI analysis system with Databricks
- **Speech-to-Text**: OpenAI Whisper integration for live transcription
- **Group-Centric Design**: Focus on group interactions, not individual tracking
- **FERPA/COPPA Compliant**: Built-in educational privacy protections

🏗️ **Technical Features**
- **Unity Catalog Database**: 27 tables across 10 schemas
- **Google Workspace Auth**: Seamless school integration
- **Rate Limiting & Security**: Enterprise-grade protection
- **Real-time Monitoring**: Health checks and performance metrics
- **Comprehensive Testing**: Unit, integration, and E2E tests

## Architecture Overview

### Technology Stack
- **Framework:** Express.js with TypeScript
- **Database:** Databricks Unity Catalog (Delta Lake)
- **Authentication:** Google OAuth 2.0 with JWT
- **STT Provider:** OpenAI Whisper API with windowed batching
- **Real-time:** Socket.IO with Redis adapter
- **AI Integration:** OpenAI Whisper + Databricks Llama models
- **Caching:** Redis for sessions and rate limiting
- **Testing:** Jest, Supertest, and Playwright integration

### Service Dependencies
```mermaid
graph TB
    subgraph "ClassWaves Backend"
        Express[Express.js Server]
        WS[WebSocket Service]
        Auth[Auth Service]
        DB[Databricks Service]
        Cache[Redis Cache]
        AI[AI Analysis Service]
    end
    
    subgraph "External Services"
        Google[Google OAuth]
        Databricks[Databricks Unity Catalog]
        OpenAI[OpenAI Whisper]
        Redis[Redis Server]
    end
    
    Express --> Auth
    Express --> DB
    Express --> WS
    Auth --> Google
    DB --> Databricks
    AI --> OpenAI
    AI --> Databricks
    WS --> Cache
    Cache --> Redis
```


## Database Architecture

### Unity Catalog Structure
- **Catalog:** `classwaves`
- **Total Schemas:** 10
- **Total Tables:** 27
- **Compliance:** Full FERPA/COPPA support

#### Schema Overview
| Schema | Purpose | Tables | Key Features |
|--------|---------|--------|-------------|
| `users` | User Management | schools, teachers, students | Google Workspace integration |
| `sessions` | Session Management | sessions, groups, recordings | Real-time collaboration |
| `analytics` | Performance Data | session_analytics, group_metrics | AI-powered insights |
| `compliance` | Privacy & Audit | audit_log, consent_tracking | FERPA/COPPA compliance |
| `ai_insights` | AI Analysis | tier1_insights, tier2_insights | Two-tier AI system |
| `operational` | System Operations | system_events, health_metrics | Monitoring & alerting |
| `admin` | Administration | admin_actions, system_config | Super admin controls |
| `communication` | Messaging | notifications, alerts | Teacher guidance |
| `audio` | Audio Processing | transcriptions, audio_metadata | Speech-to-text |
| `notifications` | Real-time Updates | delivery_queue, preferences | WebSocket integration |

### Database Management Scripts
```bash
# Create complete database structure
npm run db:create-catalog

# Verify database integrity
npm run db:verify

# Run comprehensive audit
npm run db:audit

# Display current structure
npm run db:show

# Check connection and state
npm run db:health-check
```

## Phase 4: OpenAI Whisper STT Integration

**Migration Status**: ✅ **Complete** - Databricks waveWhisperer fully replaced

### Key Features
- **Zero-disk audio processing**: All audio handled in-memory only
- **Windowed batching**: Configurable 10-20s windows for cost optimization  
- **Budget controls**: Per-school daily limits with automatic alerting
- **Classroom scale**: Tested for 25+ concurrent groups
- **FERPA compliant**: No persistent audio storage, immediate buffer cleanup

### STT Architecture
```
WebSocket Audio Chunks → In-Memory Aggregator → OpenAI Whisper API → Live Transcription
```

**Benefits over Databricks waveWhisperer**:
- Lower latency and cost
- Better reliability and scaling
- Industry-standard OpenAI integration
- Comprehensive budget monitoring

## Feature Flags

The backend uses environment flags to guard rollout and route events during the Audio → Insights pipeline. Defaults are safe for local development.

- WS_UNIFIED_STT: Enable STT handling under the namespaced `/sessions` WebSocket.
  - `1` (default): Accept `audio:chunk` in `/sessions`, process in-memory, emit `transcription:group:new`.
  - `0`: Disable namespaced STT; audio chunks are ignored by `/sessions` (legacy path stays gated off unless explicitly enabled).

- ANALYTICS_USE_NAMESPACED: Route analytics events via namespaced Sessions service.
  - `1` (default): Use `getNamespacedWebSocketService().getSessionsService().emitToSession(...)` for `analytics:finalized` and `analytics:failed`.

- GUIDANCE_CANONICAL: Guidance is canonical for Tier1/Tier2 insights.
  - Guidance namespace now emits the only insight events (`ai:tier1:insight`, `ai:tier2:insight`).
  - Session-level tier events are removed. Set `GUIDANCE_CANONICAL=1` (default recommendation) for clarity.

// Removed: ENABLE_TRANSCRIPTION_QUEUE (legacy disk queue removed to preserve zero‑disk STT path)

- WS_LEGACY_ENABLE: Legacy audio handlers were removed; this flag no longer affects audio paths. It may still guard other non-audio legacy behaviors.
  - Default remains `0`.
  - Recommendation: prefer namespaced `/sessions` for all audio and insights.

- WS_ORDERED_EMITS: Serialize WebSocket emits per room to preserve event ordering.
  - `1` (default in non-test): Events to the same room are emitted in-order using lightweight promise chaining.
  - `0`: Disable ordering for maximum throughput; safe when consumers are fully idempotent.
  - Note: Tests automatically run with ordered emits disabled to preserve synchronous test semantics.

- AUDIO_QUEUE_ENABLED: Use a minimal in-memory worker queue for end-of-session audio drain.
  - `1`: `flushGroups([...])` enqueues per-group flush tasks to smooth spikes during session end.
  - `0` (default): Drains sequentially without queueing (recommended for local/dev).
  - Note: Hot-path ingestion remains synchronous; queue only affects best-effort drain before analytics.

## Logging & Trace IDs

- Every HTTP request receives a `X-Trace-Id` header (prefers incoming `x-request-id` when provided). The ID is also available as `res.locals.traceId` and `(req as any).traceId` for correlation across code paths. Standard `ApiResponse` helpers automatically include `requestId` when present.
- Structured JSON logs include: `level`, `msg`, `timestamp`, `requestId`, `userId`, `sessionId`, `groupId`, `route`, `statusCode`, and `durationMs` (for HTTP). Configure verbosity via `LOG_LEVEL` (`debug|info|warn|error|silent`).
- WebSockets log `ws:connect` and `ws:disconnect` with `namespace`, `userId`, `socketId`, and `traceId` for cross-channel correlation.
- Sensitive data is redacted (e.g., `Authorization`, `cookie`, `token`, `password`, `email`). To trace a flow, grep by trace ID in your logs:
  - ripgrep: `rg -n "\\"requestId\\":\\"<traceId>\\""` in your log files
  - log aggregator: filter by `requestId = <traceId>`

See runbooks for incident workflows: `docs/ai/observability/RUNBOOKS.md`.

## Quick Start

### Prerequisites
- **Node.js**: 18+ (recommended: 20+)
- **Databricks**: Unity Catalog workspace access
- **Google Cloud**: OAuth 2.0 project setup
- **Redis**: For session storage and caching
- **OpenAI**: API key for Whisper transcription

### Environment Setup

Create a `.env` file with the following configuration:

```bash
# === Server Configuration ===
NODE_ENV=development
PORT=3001

# === Databricks Configuration ===
DATABRICKS_HOST=https://dbc-d5db37cb-5441.cloud.databricks.com
DATABRICKS_TOKEN=your-token-here
DATABRICKS_WAREHOUSE_ID=077a4c2149eade40

# === OpenAI Whisper Configuration ===
OPENAI_API_KEY=your-openai-key
OPENAI_WHISPER_TIMEOUT_MS=15000
OPENAI_WHISPER_CONCURRENCY=20
STT_WINDOW_SECONDS=15
STT_PROVIDER=openai # Options: 'openai' | 'off'
STT_BUDGET_MINUTES_PER_DAY=0 # 0 = unlimited
STT_BUDGET_ALERT_PCTS=50,75,90,100

# === Google OAuth Configuration ===
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret

GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback

# === Security Configuration ===
SESSION_SECRET=your-session-secret
JWT_SECRET=your-jwt-secret

# === Integration URLs ===
FRONTEND_URL=http://localhost:3000
STUDENT_APP_URL=http://localhost:3002

# === Redis Configuration ===
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
# Optional: Use in-memory Redis mock (for local dev/tests only)
# When set to '1', the backend uses a lightweight in-memory mock that
# implements the subset of Redis APIs used by the app. Do not enable in prod.
# REDIS_USE_MOCK=1

# Sizing and timeouts
REDIS_POOL_SIZE=5
REDIS_TIMEOUT=3000

# === WebSocket Backpressure Hints ===
# Emit a soft hint after N consecutive drops and then cool down to avoid spamming
# WS_BACKPRESSURE_HINT_THRESHOLD=3
# WS_BACKPRESSURE_HINT_COOLDOWN_MS=5000

# === Per-socket Audio Backpressure ===
# Upper bounds for per-socket audio traffic. Exceeding these causes soft drops
# with client-side hints to reduce send rate.
# WS_MAX_AUDIO_EVENTS_PER_SEC=20           # Max audio:chunk events per socket per second
# WS_MAX_AUDIO_BYTES_PER_SEC=1048576       # Max bytes/sec per socket (default 1MB)
# WS_MAX_AUDIO_CHUNK_BYTES=2097152         # Hard cap per chunk (default 2MB)

# === Multi-level Quotas ===
# Per-school and per-session bytes/sec quotas (in addition to per-socket bucket)
# WS_SCHOOL_AUDIO_LIMIT=5242880   # 5MB/s
# WS_SESSION_AUDIO_LIMIT=2097152  # 2MB/s

# === Session Lifecycle / Audio Drain ===
# Timeout for draining in-memory audio windows when ending a session (ms)
# AUDIO_DRAIN_TIMEOUT_MS=750
# Optional: enqueue group window flushes during drain to smooth spikes
# AUDIO_QUEUE_ENABLED=1

# === WebSocket Emit Ordering ===
# Serialize emits per room to preserve event ordering (disable for max throughput)
# WS_ORDERED_EMITS=1

# === Dev Observability ===
# Token used to gate /api/v1/debug/websocket/active-connections in production.
# In development (NODE_ENV !== 'production'), this endpoint is open.
# DEV_OBSERVABILITY_TOKEN=

# === Cache & Rate Limiting (Enabled by Default) ===
# Prefix Redis keys with cw:{env}: to ensure isolation and clarity
CW_CACHE_PREFIX_ENABLED=1            # set 0 to disable
# During migration, write to legacy keys as well for safety
CW_CACHE_DUAL_WRITE=1               # set 0 to disable
# Tag epochs for O(1) invalidation (versioned keys)
CW_CACHE_EPOCHS_ENABLED=1           # set 0 to disable
# Cross-instance NX locks to prevent stampedes on hot keys
CW_CACHE_NX_LOCKS=1                 # set 0 to disable
# Compress large cache payloads (applies to specific cache types)
CW_CACHE_COMPRESS_THRESHOLD=4096    # bytes; adjust if needed

# Rate limiter key prefixes (cw:{env}:rl:*); set 0 to revert
CW_RL_PREFIX_ENABLED=1

# See `docs/REDIS_KEY_MIGRATION.md` for key migration details and rollout strategy.

# === Guidance Emission Mode ===
# When set to '1', guidance namespace becomes canonical for AI insights
# (session-level emits are suppressed). Default is dual-emit.
# GUIDANCE_CANONICAL=0

## Observability Dashboards & Alerts

- Guidance Insights Delivery
  - Panels:
    - `guidance_tier1_insight_delivered_total{school}` (rate) and `guidance_tier2_insight_delivered_total{school}` (rate)
    - `guidance_emits_failed_total{type}` (rate) — breakdown of tier1, tier2, recommendations, alerts
  - Alerts:
    - High emits_failed rate over 5m (per school) suggests missing subscribers or connection issues

- Prompt Generation & Delivery
  - Panels:
    - `guidance_prompt_generation_latency_ms{tier}` (p50/p90) and `guidance_prompt_delivery_latency_ms{tier}` (p50/p90)
    - `guidance_prompt_generation_total{tier,status}` and `guidance_prompt_delivery_total{tier,status,school}` success ratios
  - Alerts:
    - Generation or delivery success ratio drops below 95% over 15m

- STT & Backpressure
  - Panels:
    - `stt_time_to_first_transcript_ms{school}` (p50/p90)
    - `ws_audio_bytes_total{school}` (rate)
    - `ws_backpressure_hints_total{school}` (rate)
  - Alerts:
    - Sustained backpressure hints or spikes in `AUDIO_PROCESSING_FAILED` errors

Operational Notes
- Recommended `AUDIO_DRAIN_TIMEOUT_MS=750` for a 15s STT window; raise to 1000–1500ms for slower environments.
- Prefer `GUIDANCE_CANONICAL=1` in production to standardize event delivery.
```

### Installation & Setup

```bash
# Clone and install dependencies
git clone <repository-url>
cd classwaves-backend
npm install

# Set up database
npm run db:create-catalog
npm run db:verify

# Start development server
npm run dev
```

### Make an Impact Fast
- Run verification locally: `npm test && npm run lint && npm run type-check` (target ≥80% coverage; see Testing section).
- Explore ports and adapters (Hexagonal):
  - Ports: `src/services/ports/*`
  - Domain services: `src/services/**/*`
  - HTTP adapters: `src/routes/*` + `src/controllers/*` with Zod validation in `src/utils/validation.schemas.ts`
  - WebSocket: `src/services/websocket/namespaced-websocket.service.ts` and events in `src/types/websocket.types.ts`
- Add/adjust an API route: wire Zod schema → controller → service. Add unit tests under `src/__tests__/unit` and integration under `src/__tests__/integration`.
- Validate DB contracts: `npm run db:verify` (Databricks), cache policy: `npm run cache:policy:print`.

### Full-Stack Dev Helpers
- Start all services for E2E quickly from the repo root:
  - `./start-classwaves.sh` (and `./stop-classwaves.sh`)
  - Quick CLI helper: `node scripts/cw.js backend <script>` (e.g., `node scripts/cw.js backend test`). See root `README.md` for details.

### Env & Ports
- Default port: `3000` (HTTP + WebSocket).
- Copy `.env.example` → `.env` (or `.env.local`) and fill required values. Critical keys to start:
  - Redis: `REDIS_URL` (and optional `REDIS_PASSWORD`)
  - Databricks: `DATABRICKS_HOST`, `DATABRICKS_TOKEN`
  - STT/AI: `STT_PROVIDER` (e.g., `openai`), `AI_TIER1_ENDPOINT`, `AI_TIER2_ENDPOINT`, `AI_SUMMARIZER_ENDPOINT`
  - Security: JWT/Google OAuth settings (see existing README sections and `.env.example`)
- Cache/Rate-limit prefixes and epochs default to ON; see `.env.example` for `CW_CACHE_*` and `CW_RL_*` toggles.

### Troubleshooting
- Port already in use: `lsof -ti :3000 | xargs -r kill -9`.
- Redis connection errors: verify `REDIS_URL` and that Redis is running locally.
- Databricks auth/403: check `DATABRICKS_TOKEN` scope and endpoint paths.
- WebSocket drops/backpressure: review `WS_MAX_AUDIO_*` limits in `.env.example` and server logs.
- Jest hangs: set `METRICS_DEFAULT_DISABLED=1` in test env to avoid open handles.

### Verification
```bash
# Check server health
curl http://localhost:3001/api/v1/health

# Verify database connection
npm run db:health-check

# Run test suite
npm test
```

## API Documentation

### Authentication Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/api/v1/auth/google` | Initiate Google OAuth flow | No |
| `GET` | `/api/v1/auth/google/callback` | OAuth callback handler | No |
| `POST` | `/api/v1/auth/refresh` | Refresh JWT token | Yes |
| `POST` | `/api/v1/auth/logout` | Logout user | Yes |

### Session Management
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/api/v1/sessions` | List teacher's sessions | Teacher |
| `POST` | `/api/v1/sessions` | Create new session | Teacher |
| `GET` | `/api/v1/sessions/:id` | Get session details | Teacher |
| `PUT` | `/api/v1/sessions/:id` | Update session | Teacher |
| `POST` | `/api/v1/sessions/:id/start` | Start session | Teacher |
| `POST` | `/api/v1/sessions/:id/end` | End session | Teacher |
| `GET` | `/api/v1/sessions/:id/analytics` | Session analytics | Teacher |

#### Session Summaries (Feature-flagged)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/api/v1/sessions/:id/summaries` | Session summary and group metadata (202 if pending) | Teacher |
| `GET` | `/api/v1/sessions/:id/groups/:groupId/summary` | Specific group summary (202 if pending) | Teacher |

Notes:
- Controlled by `FEATURE_GROUP_SESSION_SUMMARIES=1`.
- Emits WebSocket event `summaries:ready` on the sessions namespace when summaries are persisted.

### AI Analysis System
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `POST` | `/api/v1/ai/analyze-discussion` | **Tier 1 group analysis (Frontend-Compatible)** | Teacher |
| `POST` | `/api/v1/ai/generate-insights` | **Tier 2 deep analysis (Frontend-Compatible)** | Teacher |
| `GET` | `/api/v1/ai/insights/:sessionId` | **Retrieve session insights (Frontend-Compatible)** | Teacher |
| `GET` | `/api/v1/ai/tier1/status` | Tier 1 system status | Teacher |
| `GET` | `/api/v1/ai/tier2/status` | Tier 2 system status | Teacher |

#### Route Standardization (December 2024)
**Frontend-Compatible Routes**: The above endpoints are standardized for seamless frontend integration. 

**Backward Compatibility**: Legacy routes are maintained for existing integrations:
- `POST /api/v1/ai/sessions/:sessionId/analyze-discussion`
- `POST /api/v1/ai/sessions/:sessionId/generate-insights` 
- `GET /api/v1/ai/sessions/:sessionId/insights`

**Migration Benefits**:
- ✅ Zero breaking changes for existing code
- ✅ Simplified frontend API client patterns
- ✅ Consistent route structure across all AI endpoints
- ✅ Enhanced error logging and debugging capabilities

### Analytics & Monitoring
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/api/v1/analytics/session/:id` | Session analytics | Teacher |
| `GET` | `/api/v1/analytics/system` | System analytics | Admin |
| `GET` | `/api/v1/health` | Basic health check | No |
| `GET` | `/api/v1/health/guidance` | Detailed system health | Teacher |
| `GET` | `/api/v1/health/components` | Component health | Admin |

### Admin Controls (Super Admin Only)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/api/v1/admin/schools` | List all schools | Super Admin |
| `POST` | `/api/v1/admin/schools` | Create school | Super Admin |
| `PUT` | `/api/v1/admin/schools/:id` | Update school | Super Admin |
| `GET` | `/api/v1/admin/analytics` | Platform analytics | Super Admin |

## WebSocket Events

### Real-time Communication
The backend uses Socket.IO for real-time communication with the frontend and student applications.

All server-emitted events include a non-breaking `schemaVersion` field (currently `"1.0"`). Where available, clients should also propagate and log `traceId` for correlation across HTTP and WebSocket.

#### Server-to-Client Events
```typescript
// Group-based events
'group:joined': { groupId: string; sessionId: string; groupInfo: any }
'group:status_changed': { groupId: string; status: string; isReady?: boolean }

// Transcription events
'transcription:group:new': {
  id: string;
  groupId: string;
  text: string;
  timestamp: string;
  confidence: number;
}

// Guidance namespace (canonical)
'ai:tier1:insight': { groupId: string; sessionId: string; insights: any; timestamp: string }
'ai:tier2:insight': { sessionId: string; insights: any; timestamp: string }

// Teacher guidance
'teacher:alert': { /* alert payload */ }
'teacher:recommendations': { /* recommendations payload */ }
```

#### Client-to-Server Events
```typescript
// Session management
'session:join': { sessionId: string }
'session:leave': { sessionId: string }

// Group management
'group:join': { groupId: string; sessionId: string }
'group:status_update': { groupId: string; status: string }

// Audio streaming
'audio:chunk': { groupId: string; audioData: Buffer }
'audio:start': { groupId: string; format: string }
'audio:stop': { groupId: string }
```

## REST-First Session Control

- Source of truth: All session lifecycle changes (start, pause, end) go through REST endpoints.
- WebSocket is notify-only: Controllers emit `session:status_changed` so connected clients stay in sync.
- Deprecated input: Client event `session:update_status` no longer performs any database mutation and returns `UNSUPPORTED_OPERATION`.
- Trace & versioning:
  - All server-emitted WS payloads include `schemaVersion` (currently "1.0").
  - Controllers/WS attach a `traceId` (from `X-Trace-Id` middleware or WS auth) to key events like `session:status_changed`, `transcription:group:new`, and `group:status_changed`.
- Relevant code:
  - `src/controllers/session.controller.ts` lifecycle handlers (broadcasts + traceId)
  - `src/services/websocket/sessions-namespace.service.ts` (REST-first enforcement + schemaVersion + traceId)

## Hexagonal & DI

- Ports live under `src/services/ports`; adapters in `src/adapters/**`.
- Composition root: `src/app/composition-root.ts` wires default adapters (Databricks, Redis, etc.).
- Repositories (partial list):
  - SessionRepository: ownership/basic (`getOwnedSessionBasic`, `getBasic`, `updateStatus`)
  - SessionDetailRepository: minimal-field detail for cacheable fetch
  - GroupRepository: `countReady`, `countTotal`, `getGroupsBasic`, `getMembersBySession`
  - SessionStatsRepository: end-session summary metrics
- Controllers use repositories (e.g., `startSession`, `pauseSession`, `endSession`, `getGroupsStatus`) and keep caching at the edge.
- Validation: Zod only at the edges (routes/controllers/WS adapters). Domain services are Zod-free (guarded by unit test).

## Admin Controls

### Super Admin Features
- **School Management**: Create, update, and monitor schools
- **User Administration**: Manage teacher accounts and permissions
- **System Analytics**: Platform-wide usage and performance metrics
- **Compliance Monitoring**: FERPA/COPPA audit trails and reporting
- **Subscription Management**: Handle billing and limits

### Admin Dashboard Access
Super admin users can access:
- Complete audit logs (`compliance.audit_log`)
- System performance metrics
- School-level analytics
- User activity monitoring
- Data retention policy management

### Security Controls
- Role-based access control (teacher, admin, super_admin)
- Comprehensive audit logging
- Rate limiting per user and endpoint
- IP allowlisting for admin functions
- Session management and token validation

## Testing

### Testing Philosophy: Real Database Integration

ClassWaves follows a **real database integration testing** approach for MVP validation, prioritizing **production confidence** over test isolation.

### Environment-Specific Testing

#### Backend Server Setup for Tests

```bash
# For integration/E2E tests (RECOMMENDED)
NODE_ENV=test E2E_TEST_SECRET=test npm run dev

# For regular development work
NODE_ENV=development npm run dev

# For production deployment
NODE_ENV=production npm run start
```

#### Environment Comparison

| Environment | Database | Authentication | Redis | Use Case |
|-------------|----------|----------------|-------|----------|
| **`test`** | ✅ Real Databricks | Relaxed (test tokens) | ✅ Real Redis | Integration & E2E testing |
| **`development`** | ✅ Real Databricks | Full OAuth flow | ✅ Real Redis | Regular development |
| **`production`** | ✅ Real Databricks | Full OAuth + security | ✅ Real Redis | Live deployment |

#### Why Real Database Testing?

**MVP Validation Benefits**:
- 🎯 **Schema Validation**: Catches real database schema mismatches
- 🎯 **Network Reality**: Tests actual latency, timeouts, and connection issues  
- 🎯 **Retry Logic**: Validates resilience infrastructure with real service failures
- 🎯 **Performance Truth**: Load testing with actual database constraints
- 🎯 **Configuration Issues**: Discovers real-world connection and auth problems

**Authentication in Test Environment**:
- Uses mocked `authenticate` middleware for automated test execution
- Maintains real service connections (Databricks, Redis, WebSocket)
- Allows test token generation without full Google OAuth flow
- Enables CI/CD automation while preserving integration fidelity

### Test Suite Structure
```
src/__tests__/
├── integration/          # Real database integration tests
│   ├── auth.test.ts         # Authentication flows
│   ├── session-start-resilience.test.ts  # Retry infrastructure validation
│   ├── ai-analysis-load.test.ts          # Load testing with real services
│   ├── guidance-system-concurrent.test.ts # Concurrent system testing
│   ├── analytics-tracking.e2e.test.ts    # End-to-end analytics flow
│   └── routes/              # API route testing with real DB
├── unit/                # Isolated unit tests (mocked dependencies)
│   ├── services/        # Service layer logic tests
│   ├── controllers/     # Controller business logic  
│   └── middleware/      # Middleware function tests
├── e2e/                 # Complete user workflow tests
│   └── e2e-guidance-complete-workflow.test.ts
├── fixtures/            # Test data and schemas
│   └── test-data.ts
└── mocks/              # Service mocks (for unit tests only)
    ├── databricks.mock.ts
    └── redis.mock.ts
```

### Running Tests

#### Network-gated tests (integration/E2E)

Some integration and E2E tests spin up HTTP servers or bind sockets (e.g., Socket.IO). In CI or restricted sandboxes, binding can fail with errors like `listen EPERM: operation not permitted 0.0.0.0`.

To avoid hangs by default, network-bound suites are skipped unless explicitly enabled via an env flag.

- Default (safe in sandboxes):
```
npm test              # runs unit tests only
npm run test:unit     # explicit unit tests
```

- Enable network-bound tests locally (when ports can bind):
```
ENABLE_NETWORK_TESTS=1 npm test                # run all tests
ENABLE_NETWORK_TESTS=1 npm run test:integration
```

How it works:
- `jest.config.js` reads `ENABLE_NETWORK_TESTS` to ignore `src/__tests__/integration` and `src/__tests__/e2e` when not set.
- `src/__tests__/test-utils/app-setup.ts` guards `app.listen(0)` behind the same flag.
- Any unit test that binds sockets is also gated under this flag.

#### Integration & E2E Tests (Real Services)
```bash
# Start backend in test mode first
NODE_ENV=test E2E_TEST_SECRET=test npm run dev

# In separate terminal, run integration tests
npm run test:integration

# Run specific resilience tests
npm run test:integration -- --testNamePattern="Session Start Resilience"

# Run E2E workflow tests  
npm run test:e2e

# Run analytics deduplication concurrent-lock test (uses in-memory Redis mock)
ENABLE_NETWORK_TESTS=1 npm test -- src/__tests__/integration/analytics-computation.concurrent.lock.integration.test.ts

#### Integration Helpers
- Readiness seeding (session start gating):
  - Helper: `src/__tests__/integration/utils/group-readiness.ts` → `markAllGroupsReady(sessionId)`.
  - Session factory: `src/__tests__/integration/utils/session-factory.ts` provides
    - `startSessionWithSupertest(app, token, sessionId)`
    - `startSessionWithAxios(baseUrl, token, sessionId)`
  - These ensure groups are marked ready in tests that expect 200 on `POST /sessions/:id/start`, keeping production gating strict.
```

#### Unit Tests (Mocked Dependencies)
```bash
# Unit tests don't require backend server
npm run test:unit

# Watch mode for TDD
npm run test:unit -- --watch
```

#### Complete Test Suite
```bash
# Run all test types
npm test

# Generate coverage report
npm run test:coverage

# Continuous integration mode
npm run test:ci
```

### Test Categories & Approach

#### 🔗 **Integration Tests** → Real Database Connections
- **Purpose**: Validate platform works with actual infrastructure
- **Dependencies**: Real Databricks, Redis, WebSocket services
- **Authentication**: Mocked middleware, real service calls
- **Examples**: 
  - `session-start-resilience.test.ts` - Tests retry infrastructure
  - `ai-analysis-load.test.ts` - Load tests with real AI services
  - `guidance-system-concurrent.test.ts` - Concurrent system validation

#### 🔧 **Unit Tests** → Mocked Dependencies  
- **Purpose**: Test business logic in isolation
- **Dependencies**: Mocked services via `__tests__/mocks/`
- **Authentication**: Mocked completely
- **Examples**:
  - Service method logic validation
  - Controller request/response handling
  - Middleware function behavior

#### 🎭 **E2E Tests** → Full User Workflows
- **Purpose**: Complete user journey validation  
- **Dependencies**: Real services + WebSocket connections
- **Authentication**: Test user sessions with real tokens
- **Examples**:
  - Teacher creates session → Students join → AI analysis → Guidance delivery

### Test Requirements & Standards

- ✅ **Real Data Testing**: Integration tests use actual Databricks connections
- ✅ **Schema Compliance**: Tests validate against real database schemas  
- ✅ **Performance Validation**: Load testing with actual service constraints
- ✅ **Retry Infrastructure**: Tests resilience with real timeout scenarios
- ✅ **Security Testing**: Authentication and authorization flows
- ✅ **FERPA Compliance**: Audit logging and data protection validation

## Security & Compliance

### FERPA Compliance
- **Educational Records Protection**: All student data encrypted at rest and in transit
- **Access Controls**: Role-based permissions with audit trails
- **Data Minimization**: Only collect necessary educational data
- **Retention Policies**: Configurable data retention periods
- **Parental Rights**: COPPA-compliant consent management

### Security Features
```typescript
// Security middleware stack
app.use(helmet({
  contentSecurityPolicy: true,
  hsts: true,
  noSniff: true,
  frameguard: { action: 'deny' }
}));

// Rate limiting
app.use('/api/', rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // requests per window
  standardHeaders: true
}));

// Input validation with Zod
app.use(validateInput(sessionSchema));
```

#### Protected Routes and Rate Limiting
- Protected route groups:
  - `/api/v1/admin/**` — requires authenticated `super_admin` by default; some routes allow `admin` via explicit middleware.
  - `/api/v1/auth/me`, `/api/v1/auth/csrf-token` — require authentication.
  - `/api/v1/health/errors/clear` — requires authentication and admin (`admin` or `super_admin`).
- Rate limiting:
  - Global limiter on `/api/**` with exemptions for `/api/v1/health`, `/api/v1/ready`, `/metrics`, and audio uploads.
  - Stricter limiter on `/api/v1/auth/**` for authentication endpoints.
  - Utility `createUserRateLimiter(prefix, points, duration)` for sensitive actions.
  - All 429 responses use standardized ApiResponse envelopes.

#### Logging and PII Redaction
- Structured logger in `src/utils/logger.ts` redacts tokens, cookies, emails, and network identifiers.
- Error responses include a `requestId` when available to aid support without exposing PII.

#### Test Token Endpoints (Non‑Production Only)
- `/api/v1/auth/generate-test-token` — requires `E2E_TEST_SECRET`.
- `/api/v1/auth/test-token` — requires `E2E_TEST_SECRET`.

### Audit Trail
All sensitive operations are logged to `compliance.audit_log`:
- User authentication events
- Data access operations
- Administrative actions
- System configuration changes
- AI analysis requests

## Monitoring & Health

### Health Check Endpoints
```bash
# Basic health (public)
GET /api/v1/health
# Returns: { status: "healthy", timestamp: "...", uptime: 12345 }

# Detailed health (authenticated)
GET /api/v1/health/guidance
# Returns: Complete system health including AI services

# Component health (admin only)
GET /api/v1/health/components
# Returns: Individual service status and metrics
```

### Metrics & Observability
- **Prometheus Metrics**: Custom metrics at `/metrics`
- **Performance Monitoring**: Response times, throughput, error rates
- **AI System Monitoring**: Whisper latency, analysis success rates
- **Database Health**: Connection pool status, query performance
- **WebSocket Metrics**: Connection counts, message throughput

#### Correlation ID
- Every HTTP response includes `X-Trace-Id`.
- Clients may send `X-Trace-Id` to correlate logs; server will echo it or generate one.
- WebSocket handshake propagates `traceId` (via `auth.traceId` or `X-Trace-Id` header) and acknowledges with `ws:connected { traceId }`.

#### HTTP Metrics
- `http_requests_total{method,route,status}`: Counter of requests.
- `http_request_duration_seconds{method,route,status}`: Histogram with SLO buckets (50ms–6.4s).

#### WebSocket Metrics
- `ws_connections_total{namespace}`: Connection counter by namespace.
- `ws_disconnects_total{namespace,reason}`: Disconnect counter.
- `ws_messages_emitted_total{namespace,event}`: Emitted message counter.

### Key Metrics
```typescript
// Custom Prometheus metrics
whisper_latency_ms: Histogram
whisper_status_count: Counter
stt_window_bytes: Gauge
ws_backpressure_drops_total: Counter
session_duration_seconds: Histogram
```

## Development

### Project Structure
```
classwaves-backend/
├── src/
│   ├── config/              # Configuration management
│   ├── controllers/         # Request handlers (9 controllers)
│   │   ├── auth.controller.ts
│   │   ├── session.controller.ts
│   │   ├── ai-analysis.controller.ts
│   │   ├── admin.controller.ts
│   │   └── ...
│   ├── middleware/          # Express middleware
│   │   ├── auth.middleware.ts
│   │   ├── validation.middleware.ts
│   │   └── error.middleware.ts
│   ├── routes/              # API route definitions (9 route files)
│   ├── services/            # Business logic layer (15+ services)
│   │   ├── databricks.service.ts
│   │   ├── websocket/                 # Namespaced WebSocket services (sessions, guidance)
│   │   ├── ai-analysis.service.ts
│   │   └── ...
│   ├── scripts/             # Database and utility scripts (50+ scripts)
│   ├── types/              # TypeScript type definitions
│   └── utils/              # Utility functions
├── docs/                   # Documentation
├── examples/               # Example implementations
└── keys/                   # SSL certificates and keys
```

### Development Workflow
1. **Branch Strategy**: Feature branches from `mvp` branch
2. **Code Standards**: TypeScript strict mode, ESLint, Prettier
3. **Testing**: Write tests for all new features
4. **Documentation**: Update API docs and README
5. **Security**: Follow OWASP guidelines
6. **Performance**: Monitor metrics and optimize queries

### Available Scripts
```bash
# Development
npm run dev              # Start development server with hot reload
npm run build           # Build for production
npm run start           # Start production server

# Database Management
npm run db:create-catalog    # Initialize complete database
npm run db:verify           # Verify database structure
npm run db:audit           # Run comprehensive audit
npm run db:show            # Display schema structure

# Code Quality
npm run lint              # ESLint code checking
npm run format           # Prettier code formatting
npm run type-check       # TypeScript type checking

# Testing
npm test                 # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # Generate coverage report
```

## Deployment

### Environment Requirements
- **Node.js**: 18+ (production: 20+)
- **Memory**: Minimum 2GB RAM (recommended: 4GB+)
- **CPU**: 2+ cores for WebSocket handling
- **Storage**: SSD recommended for logging
- **Network**: Low latency to Databricks and Redis

### Production Configuration
```bash
# Production environment variables
NODE_ENV=production
PORT=3001

# Enable all security features
ENABLE_RATE_LIMITING=true
ENABLE_CORS_STRICT=true
ENABLE_AUDIT_LOGGING=true

# Production Redis cluster
REDIS_CLUSTER_NODES=redis1:6379,redis2:6379,redis3:6379

# SSL certificates
SSL_CERT_PATH=/path/to/certificate.pem
SSL_KEY_PATH=/path/to/private.key
```

### Docker Deployment
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build
EXPOSE 3001
CMD ["npm", "start"]
```

### Health Checks
```bash
# Docker health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s \
  CMD curl -f http://localhost:3001/api/v1/health || exit 1
```

## Repository Integration

### Multi-Repository Architecture
The ClassWaves platform consists of four independent repositories:

```mermaid
graph TB
    subgraph "ClassWaves Platform"
        Backend[classwaves-backend<br/>Port 3000]
        Frontend[classwaves-frontend<br/>Port 3001]
        Student[classwaves-student<br/>Port 3002]
        Shared[classwaves-shared<br/>NPM Package]
    end
    
    Frontend --> Backend
    Student --> Backend
    Frontend --> Shared
    Backend --> Shared
    Student --> Shared
```

### Integration Points
- **Frontend → Backend**: REST API + WebSocket connections
- **Student → Backend**: WebSocket for real-time updates
- **Shared Package**: TypeScript types and validation schemas
- **Database**: Single Databricks Unity Catalog for all data

### Platform Startup Sequence
```bash
# 1. Start backend services
cd classwaves-backend && npm run dev

# 2. Start frontend dashboard  
cd classwaves-frontend && npm run dev

# 3. Start student application
cd classwaves-student && npm run dev

# 4. Verify full platform
curl http://localhost:3001/api/v1/health  # Backend
curl http://localhost:3000/api/health     # Frontend
curl http://localhost:3002/api/health     # Student
```

### Shared Dependencies
All repositories depend on `@classwaves/shared` for:
- TypeScript type definitions
- Zod validation schemas
- Constants and enums
- Utility functions
- WebSocket event definitions

## Contributing

### Development Setup
1. **Clone Repository**: `git clone <repo-url>`
2. **Install Dependencies**: `npm install`
3. **Environment Setup**: Copy `.env.example` to `.env`
4. **Database Setup**: `npm run db:create-catalog`
5. **Start Development**: `npm run dev`

#### Local Postgres Quickstart (dev only)
The backend now supports a local Postgres provider for faster offline iteration. Default provider remains Databricks; opt in per session when needed.

1. **Start Postgres**: `npm run db:local:up`
2. **Wait for health**: `npm run db:local:wait` (retries until the container reports healthy)
3. **Initialize schema/seeds**: `npm run db:local:init` (idempotent; re-run after updating schema files). When `CW_DBX_MANIFEST_ENABLED=1`, this command regenerates the manifest-driven schema under `src/db/local/generated/` before applying it.
4. **Optional reset**: `npm run db:local:reset` drops known schemas and reapplies schema + seeds (also manifests-aware when the flag is enabled)
5. **Open psql shell**: `npm run db:local:shell` (uses Docker exec; Ctrl+D to exit)
6. **Run backend against Postgres**: `npm run dev:local` (sets `DB_PROVIDER=postgres` while reusing the standard dev startup script)

Notes:
- The local connection string defaults to `postgres://classwaves:classwaves@localhost:5433/classwaves_dev`. Override the host port by editing `docker-compose.yml` or exporting `DATABASE_URL` before running the scripts.
- On Windows, run these commands from WSL with Docker Desktop running; ensure the WSL distribution has access to Docker.
- `db:local:init` applies SQL from `src/db/local/schema.sql` and `src/db/local/seeds/dev.sql`. When the manifest flag is enabled it uses the generated outputs in `src/db/local/generated/` which are produced by `npm run db:manifest:generate`.
- Verify connectivity manually with `psql $DATABASE_URL -c 'select 1';` (or use `npm run db:local:shell`).
- The Postgres adapter implements the shared DB port (`src/adapters/db/postgres.adapter.ts`), rewrites `?` placeholders to `$n`, and emits Prometheus metrics (`classwaves_db_query_attempts_total`, `classwaves_db_query_failures_total`, `classwaves_db_query_duration_ms`) with `provider`/`operation` labels when `DB_PROVIDER=postgres`.
- **Dev auth fallback**: In non-production, when Google OAuth env vars are absent or `cw.auth.dev_fallback_enabled=1`, `/api/v1/auth/google` issues tokens for the seeded dev teacher/school. The flow sets `degradedMode=true`, records `classwaves_auth_dev_fallback_total{environment,trigger}`, and stores a secure session so the frontend can proceed without Google credentials.

### Code Standards
- **TypeScript**: Strict mode enabled
- **ESLint**: Airbnb configuration with custom rules
- **Prettier**: Automatic code formatting
- **Zod**: Runtime validation for all inputs
- **Tests**: Required for all new features

### Pull Request Process
1. Create feature branch from `mvp`
2. Implement feature with comprehensive tests
3. Update documentation and API specs
4. Run full test suite (`npm test`)
5. Create pull request with detailed description
6. Code review and approval required
7. Merge to `mvp` branch

### Security Guidelines
- Never commit secrets or API keys
- Use environment variables for configuration
- Validate all inputs with Zod schemas
- Follow OWASP security guidelines
- Implement proper error handling
- Add audit logging for sensitive operations

---

## License

**Proprietary** - ClassWaves Educational Platform

© 2025 ClassWaves. All rights reserved. This software is proprietary and confidential.

---

## Support & Contact

- **Documentation**: See `/docs` directory for detailed guides
- **Issues**: Use GitHub Issues for bug reports and feature requests
- **Security**: Report security issues privately to security@classwaves.com

For questions about setup or development, please refer to the comprehensive documentation in the `/docs` directory or contact the development team.
## Audit Log Worker (Async, Batched)

- Overview: Moves compliance audit logging off hot paths using Redis Streams and a background worker that batches inserts to Databricks.
- Ports/Adapters: `src/services/audit-log.port.ts`, `src/adapters/audit-log.redis.ts`, sanitizer `src/adapters/audit-sanitizer.ts`.
- Worker: `src/workers/audit-log.worker.ts` with sampling (`src/workers/audit-sampler.ts`) and rollups (`src/workers/audit-rollups.ts`). Metrics in `src/workers/audit-metrics.ts`.
- DI: Default instance via `src/utils/audit.port.instance.ts`.

Environment variables:
- `AUDIT_LOG_STREAM_KEY` (default `audit:log`)
- `AUDIT_LOG_MAX_BACKLOG` (default `50000`)
- `AUDIT_LOG_ENQUEUE_TIMEOUT_MS` (default `50`)
- `AUDIT_LOG_CONSUMER_GROUP` (default `auditlog`)
- `AUDIT_LOG_CONSUMER_NAME` (default `${HOSTNAME}-audit-worker`)
- `AUDIT_LOG_BATCH_SIZE` (default `200`)
- `AUDIT_LOG_BLOCK_MS` (default `2000`)
- `AUDIT_NOISY_SAMPLE_RATE` (default `0.05`)
- `AUDIT_NOISY_HARD_CAP_PER_MIN` (default `100`)
- `AUDIT_LOG_DLQ_KEY` (default `audit:log:dlq`)
- `AUDIT_LOG_DB_COOLDOWN_MS` (default `10000`)
- `AUDIT_HASH_USER_AGENT` (default `1`)

Lifecycle:
- Worker creates a consumer group and reads batches via XREADGROUP.
- Category-aware sampling reduces noisy events; hard cap per minute per session.
- Dropped/sampled events aggregated into minute rollups and flushed as synthetic rows (suffix `_rollup`).
- DB cooldown on failures prevents backlog growth; critical events are routed to DLQ.
- Observability logs queue depth, processed/dropped/rollup counts.

Scripts:
- `npm run dev:audit` – run worker with ts-node
- `npm run audit` – run worker from build output
- `npm run audit:dlq:replay` – drain DLQ back to stream or DB (configurable)

Plan: See `checkpoints/WIP/Features/Audit-fixes/async-batched-audit-logging.plan.xml` for design and verification steps.

DLQ replay:
- Key: `AUDIT_LOG_DLQ_KEY` (default `audit:log:dlq`).
- Mode: `AUDIT_DLQ_REPLAY_MODE` = `stream` (default) re-enqueues to `AUDIT_LOG_STREAM_KEY`, or `db` writes rows directly to `compliance.audit_log`.
- Usage: `npm run audit:dlq:replay`. Safe to re-run; deletes DLQ entries after successful replay.
#### Sessions List Query Parameters

- `view`: Adjusts the projection and defaults for specific UI views.
  - `view=dashboard` → Returns the 3 most recent sessions using an ultra-lean projection from `sessions.classroom_sessions` only. Fields include:
    - `id, status, teacher_id, school_id, title, description, scheduled_start, actual_start, created_at, target_group_size`
    - `total_groups AS group_count, total_students AS student_count`
    - `participation_rate, engagement_score, access_code`
  - Limit is hard-capped to 3 for this view (any provided `limit` is ignored).
  - Caching keys include the `view` dimension: `sessions:teacher:<id>:view:<view|default>:limit:<n>`.

- Default (no `view`): Uses the standard minimal list projection and respects the provided `limit` (defaults to 20).
#### Consent and Retention
- Student email and leader notifications enforce consent checks (COPPA/FERPA) via `EmailService` and `EmailComplianceService`. Non‑compliant recipients are skipped and logged without PII.
- Student session join (WebSocket) blocks under‑13 without consent with error code `COPPA_CONSENT_REQUIRED`.
- Retention utilities (`src/services/retention.service.ts`) provide a simple deletion date calculator. Default retention window can be configured via `RETENTION_DEFAULT_DAYS` (defaults to ~7 years / 2555 days).
