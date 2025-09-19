# Environment Variables Configuration

This document outlines all environment variables used by the ClassWaves backend after the Phase 4 OpenAI Whisper migration.

## Required Variables

### Database & Databricks
```bash
# Databricks connection for analytics (non-STT features)
DATABASE_URL=databricks+connector://token:your-databricks-token@your-databricks-host:443/classwaves
DATABRICKS_HOST=your-workspace.cloud.databricks.com
DATABRICKS_TOKEN=dapi-your-access-token
DATABRICKS_CLUSTER_ID=your-cluster-id
DATABRICKS_WAREHOUSE_ID=your-warehouse-id
```

### Authentication & Security
```bash
# Session and JWT secrets
SESSION_SECRET=your-super-secure-session-secret-minimum-32-characters
JWT_SECRET=your-jwt-secret-for-token-signing

# Google OAuth for teacher authentication
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
```

### Redis Configuration
```bash
# Session storage and caching
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=classwaves-redis-pass
```

## Phase 4: OpenAI Whisper STT Configuration

**Primary STT Provider** (replaces Databricks waveWhisperer)

```bash
# Core STT settings
STT_PROVIDER=openai
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_WHISPER_TIMEOUT_MS=15000
OPENAI_WHISPER_CONCURRENCY=20
```

### Audio Processing & Budget Controls
```bash
# Window size for audio aggregation (seconds)
STT_WINDOW_SECONDS=15

# Daily budget limits per school
STT_BUDGET_MINUTES_PER_DAY=480

# Alert thresholds (percentages)
STT_BUDGET_ALERT_PCTS=75,90,100
```

## Application Configuration

```bash
# Basic server settings
NODE_ENV=development
PORT=3000

# CORS configuration
ALLOWED_ORIGINS=http://localhost:3001,http://127.0.0.1:3001

# Feature flags
ENABLE_RATE_LIMITING=true
ENABLE_DB_METRICS_PERSIST=false
RETENTION_DEFAULT_DAYS=2555 # Optional: default retention window (~7 years)
```

## Testing & Development

```bash
# E2E testing
E2E_TEST_SECRET=dummy-secret-for-e2e-tests

# Monitoring
LOG_LEVEL=info

## Databricks Resilience & Health
```bash
# Connection and query timeouts (milliseconds)
DATABRICKS_CONNECT_TIMEOUT_MS=8000
DATABRICKS_TIMEOUT_MS=8000

# Retry policy (transient errors only) with backoff + jitter
DATABRICKS_MAX_RETRIES=3
DATABRICKS_BACKOFF_BASE_MS=200
DATABRICKS_BACKOFF_MAX_MS=2000
DATABRICKS_JITTER_RATIO=0.2

# Circuit breaker thresholds
DATABRICKS_BREAKER_FAILURE_THRESHOLD=5
DATABRICKS_BREAKER_RESET_TIMEOUT_MS=60000
DATABRICKS_BREAKER_MIN_REQUESTS=10

# Health endpoint probe timeout (ms)
DB_HEALTH_TIMEOUT_MS=1200
```

## Audio Upload Limits
```bash
# Max upload size for /api/v1/audio/window (bytes)
AUDIO_UPLOAD_MAX_BYTES=5000000
```

## E2E / Dev Test Utilities
```bash
# Enables dev token route for E2E login shortcuts (non-production only)
E2E_TEST_SECRET=test
```
```

## Migration Notes

### ✅ **Active Configuration (Phase 4)**
- **STT Provider**: OpenAI Whisper via HTTP API
- **Audio Processing**: In-memory only, zero-disk persistence
- **Budget Controls**: Per-school daily limits with alerting
- **Windowing**: Configurable 10-20s windows for cost optimization

### ❌ **Deprecated Configuration**

The following variables are **no longer used** after the OpenAI Whisper migration:

```bash
# DEPRECATED - Removed in Phase 4
# DATABRICKS_WAVEWHISPERER_URL=https://your-workspace.cloud.databricks.com/serving-endpoints/wavewhisperer
```

**Migration completed**: ✅ 2024 - All STT functionality migrated from Databricks waveWhisperer to OpenAI Whisper

### **Databricks Services Still Active**
- ✅ **Analytics & AI Insights**: Databricks continues to power non-STT features
- ✅ **Data Warehouse**: Session data, user management, reporting
- ✅ **Compliance**: FERPA/COPPA audit logs and monitoring

## Configuration Examples

### Development
```bash
STT_PROVIDER=openai
OPENAI_API_KEY=sk-dev-key
STT_WINDOW_SECONDS=10
STT_BUDGET_MINUTES_PER_DAY=60
```

### Production
```bash
STT_PROVIDER=openai
OPENAI_API_KEY=sk-prod-key
STT_WINDOW_SECONDS=15
STT_BUDGET_MINUTES_PER_DAY=480
OPENAI_WHISPER_CONCURRENCY=25
```

### Testing
```bash
NODE_ENV=test
STT_PROVIDER=openai
# OPENAI_API_KEY not required in test mode (mocked)
STT_WINDOW_SECONDS=5
```

## Security Notes

- **OpenAI API Key**: Store securely, never commit to version control
- **Budget Monitoring**: Monitor `STT_BUDGET_MINUTES_PER_DAY` to control costs
- **Databricks Token**: Still required for analytics and data warehouse features
- **Redis**: Use strong password and secure connection in production

## Troubleshooting

### STT Issues
- Verify `OPENAI_API_KEY` is valid and has sufficient quota
- Check `STT_WINDOW_SECONDS` isn't too small (minimum 5s recommended)
- Monitor budget alerts if transcriptions stop working

### Performance Tuning
- Increase `OPENAI_WHISPER_CONCURRENCY` for high-load scenarios
- Adjust `STT_WINDOW_SECONDS` based on 429 rate limiting
- Use `ENABLE_DB_METRICS_PERSIST=true` for detailed monitoring
