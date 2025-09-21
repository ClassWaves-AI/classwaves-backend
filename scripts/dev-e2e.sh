#!/usr/bin/env bash
# Backend E2E server bootstrap with optional local Postgres wiring.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

USE_LOCAL_DB="${USE_LOCAL_DB:-0}"

if [[ "$USE_LOCAL_DB" == "1" ]]; then
  if [[ "${DB_LOCAL_USE_EXISTING:-0}" == "1" ]]; then
    echo "🗄  Using existing local Postgres instance (DB_LOCAL_USE_EXISTING=1)."
  else
    echo "🗄  Preparing local Postgres for E2E"
    (cd "$BACKEND_DIR" && npm run db:local:reset >/dev/null)
  fi
  export DB_PROVIDER="postgres"
  export DATABASE_URL="${DATABASE_URL:-postgres://classwaves:classwaves@localhost:5433/classwaves_dev}"
  export DB_SSL="${DB_SSL:-0}"
  export CW_DB_USE_LOCAL_POSTGRES="1"
  export CW_AUTH_DEV_FALLBACK_ENABLED="1"
fi

export E2E_TEST_SECRET="${E2E_TEST_SECRET:-test}"
export NODE_ENV="test"
export JWT_SECRET="${JWT_SECRET:-test-jwt-secret-for-e2e-only-do-not-use-in-prod}"
export JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET:-test-refresh-secret-for-e2e-only-do-not-use-in-prod}"
export SESSION_ENCRYPTION_SECRET="${SESSION_ENCRYPTION_SECRET:-test-session-encryption-secret-for-e2e-only}"
export STT_INLINE_WORKER="${STT_INLINE_WORKER:-1}"
export STT_FORCE_MOCK="${STT_FORCE_MOCK:-1}"
export API_DEBUG="${API_DEBUG:-1}"
export WS_AUDIO_FLUSH_CADENCE_MS="${WS_AUDIO_FLUSH_CADENCE_MS:-10000}"
export WS_STALL_CHECK_INTERVAL_MS="${WS_STALL_CHECK_INTERVAL_MS:-10000}"
export WS_STALL_NOTIFY_COOLDOWN_MS="${WS_STALL_NOTIFY_COOLDOWN_MS:-30000}"
export AUDIO_WINDOW_MIN_INTERVAL_MS="${AUDIO_WINDOW_MIN_INTERVAL_MS:-800}"

cd "$BACKEND_DIR"
exec ts-node src/server.ts
