# ClassWaves Backend

Educational platform backend service for real-time classroom collaboration with AI-powered insights.

## Architecture Overview

- **Framework:** Express.js with TypeScript
- **Database:** Databricks Unity Catalog (Delta Lake)
- **Authentication:** Google OAuth 2.0 with JWT
- **Real-time:** WebRTC (planned) for audio/video
- **AI Integration:** In-memory audio processing (planned)

## Unity Catalog Database Structure

- **Catalog:** `classwaves`
- **Schemas:** 10 (users, sessions, analytics, compliance, ai_insights, operational, admin, communication, audio, notifications)
- **Tables:** 27 total with full FERPA/COPPA compliance
- **Documentation:** See [DATABASE_SCHEMA.md](./docs/DATABASE_SCHEMA.md) for complete details

## Quick Start

### Prerequisites
- Node.js 18+
- Databricks account with Unity Catalog access
- Google Cloud project for OAuth

### Environment Setup

Create a `.env` file:

```bash
# Server
NODE_ENV=development
PORT=3001

# Databricks (analytics only)
DATABRICKS_HOST=https://dbc-d5db37cb-5441.cloud.databricks.com
DATABRICKS_TOKEN=your-token-here
DATABRICKS_WAREHOUSE_ID=077a4c2149eade40

# OpenAI Whisper (STT)
OPENAI_API_KEY=your-openai-key
OPENAI_WHISPER_TIMEOUT_MS=15000
OPENAI_WHISPER_CONCURRENCY=20
STT_WINDOW_SECONDS=15
STT_PROVIDER=openai # or 'off' to disable STT submission
STT_BUDGET_MINUTES_PER_DAY=0 # optional: daily per-school budget in minutes (0 to disable)
STT_BUDGET_ALERT_PCTS=50,75,90,100 # optional: alert thresholds in % of daily budget

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/auth/google/callback

# Security
SESSION_SECRET=your-session-secret
JWT_SECRET=your-jwt-secret

# Frontend
FRONTEND_URL=http://localhost:3000
```

### Installation

```bash
npm install
```

### Database Setup

Initialize the Unity Catalog structure:

```bash
# Create all schemas and tables
npm run db:create-catalog

# Verify structure
npm run db:verify

# Audit tables
npm run db:audit
```

### Development

```bash
# Start development server with hot reload
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Type check
npm run type-check
```

## API Endpoints

### Authentication
- `POST /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/google/callback` - OAuth callback
- `POST /api/auth/refresh` - Refresh JWT token
- `POST /api/auth/logout` - Logout user

### Sessions
- `GET /api/sessions` - List sessions for teacher
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id` - Get session details
- `PUT /api/sessions/:id` - Update session
- `POST /api/sessions/:id/start` - Start session
- `POST /api/sessions/:id/end` - End session

### Health
- `GET /api/health` - Service health check

## Project Structure

```
src/
├── config/          # Configuration files
├── controllers/     # Request handlers
├── middleware/      # Express middleware
├── routes/          # API routes
├── services/        # Business logic
├── scripts/         # Database and utility scripts
├── types/           # TypeScript type definitions
└── server.ts        # Application entry point

docs/
├── API.md                      # API documentation
├── DATABASE_SCHEMA.md          # Complete schema docs
├── DOCUMENTATION_UPDATE_PLAN.md # Doc strategy
└── ...
```

## Database Scripts

Located in `src/scripts/`:

- `create-unity-catalog-structure.ts` - Create all schemas and tables
- `audit-catalog-structure.ts` - Comprehensive audit tool
- `verify-catalog.ts` - Quick verification
- `show-catalog-structure.ts` - Display current structure
- `check-databricks-state.ts` - Check connection and state

## Security Features

- **Authentication:** Google OAuth 2.0 with JWT tokens
- **Authorization:** Role-based access (teacher, admin, super_admin)
- **Data Protection:** FERPA and COPPA compliance built-in
- **Audit Logging:** All data access logged for compliance
- **Rate Limiting:** API endpoint protection
- **CORS:** Configured for frontend integration
- **Helmet:** Security headers enabled

## Compliance

### FERPA (Family Educational Rights and Privacy Act)
- Student data access controls
- Parental consent tracking
- Audit trail for all data access
- Configurable retention policies

### COPPA (Children's Online Privacy Protection Act)
- Special protections for students under 13
- Limited data collection
- No behavioral targeting
- Parental access controls

## Development Workflow

1. **Feature Development**
   - Create feature branch
   - Implement with tests
   - Update documentation
   - Create pull request

2. **Database Changes**
   - Update schema in Unity Catalog
   - Run audit script
   - Update TypeScript types
   - Update documentation

3. **API Changes**
   - Update controllers and routes
   - Add validation with Zod
   - Update API documentation
   - Test with Postman/Thunder Client

## Monitoring

- **Health Checks:** `/api/health` endpoint
- **Metrics:** `/metrics` Prometheus endpoint including `whisper_latency_ms`, `whisper_status_count`, `whisper_retry_count`, `whisper_429_count`, `stt_window_bytes`, `stt_window_seconds`, and `ws_backpressure_drops_total`
- **System Events:** Logged to `operational.system_events`
- **Audit Trail:** All actions in `compliance.audit_log`

## Contributing

1. Follow TypeScript best practices
2. Write tests for new features
3. Update documentation
4. Run linters before committing
5. Keep functions small and focused

## License

Proprietary - ClassWaves Educational Platform