#!/usr/bin/env bash
# Utilities to manage the local Postgres instance for backend development.
# Provides npm script entry points for bringing the service up, waiting for
# health, running schema/seeds, resetting state, and opening a psql shell.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BACKEND_DIR}/.." && pwd)"
SERVICE_NAME="postgres"
CONTAINER_NAME="classwaves-postgres"
DEFAULT_DATABASE_URL="postgres://classwaves:classwaves@localhost:5433/classwaves_dev"
DATABASE_URL="${DATABASE_URL:-${DEFAULT_DATABASE_URL}}"
STATIC_SCHEMA_FILE="${BACKEND_DIR}/src/db/local/schema.sql"
STATIC_SEED_FILE="${BACKEND_DIR}/src/db/local/seeds/dev.sql"
GENERATED_DIR="${BACKEND_DIR}/src/db/local/generated"
GENERATED_SCHEMA_FILE="${GENERATED_DIR}/schema.sql"
GENERATED_SEED_FILE="${GENERATED_DIR}/seeds/dev.sql"
MANIFEST_HASH_FILE="${GENERATED_DIR}/schema-manifest.hash"
SCHEMA_FILE="${STATIC_SCHEMA_FILE}"
SEED_FILE="${STATIC_SEED_FILE}"
WAIT_TIMEOUT_SECONDS="${DB_LOCAL_WAIT_TIMEOUT:-90}"

info() { echo "[db-local] $*"; }
warn() { echo "[db-local] WARN: $*" >&2; }
err() { echo "[db-local] ERROR: $*" >&2; }

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "Command '$1' is required but not available."
    exit 1
  fi
}

compose() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    if docker compose version >/dev/null 2>&1; then
      docker compose "$@"
    elif command -v docker-compose >/dev/null 2>&1; then
      docker-compose "$@"
    else
      err "Docker Compose is not installed. Install Docker Desktop or docker-compose."
      exit 1
    fi
  else
    err "Docker is not running. Start Docker Desktop first."
    exit 1
  fi
}

container_health() {
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${CONTAINER_NAME}" 2>/dev/null || echo "unknown"
}

wait_for_health() {
  info "Waiting for Postgres container health status..."
  local elapsed=0
  while true; do
    local status
    status="$(container_health)"
    case "$status" in
      healthy)
        info "Postgres is healthy."
        return 0
        ;;
      starting)
        ;;
      unknown)
        warn "Postgres container not found yet; retrying."
        ;;
      *)
        warn "Postgres container status: $status"
        ;;
    esac
    sleep 2
    elapsed=$((elapsed + 2))
    if [ "$elapsed" -ge "$WAIT_TIMEOUT_SECONDS" ]; then
      err "Postgres did not become healthy within ${WAIT_TIMEOUT_SECONDS}s."
      exit 1
    fi
  done
}

psql_exec() {
  local args=("exec" "-T" "${SERVICE_NAME}" "psql" "-v" "ON_ERROR_STOP=1" "-U" "classwaves" "-d" "classwaves_dev")
  compose "${args[@]}" "$@"
}

apply_sql_file() {
  local file="$1"
  local label="$2"
  if [ ! -f "$file" ]; then
    warn "${label} file not found at ${file}. Skipping."
    return 0
  fi
  info "Applying ${label} (${file})"
  cat "$file" | psql_exec
}

is_truthy() {
  local value="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "$value" in
    1|true|yes|on) return 0 ;;
  esac
  return 1
}

manifest_enabled() {
  local candidates=(
    "${CW_DBX_MANIFEST_ENABLED:-}"
    "${DBX_MANIFEST_ENABLED:-}"
    "${cw_dbx_manifest_enabled:-}"
  )
  for candidate in "${candidates[@]}"; do
    if [ -n "$candidate" ] && is_truthy "$candidate"; then
      return 0
    fi
  done
  return 1
}

ensure_manifest_generated() {
  if ! manifest_enabled; then
    SCHEMA_FILE="${STATIC_SCHEMA_FILE}"
    SEED_FILE="${STATIC_SEED_FILE}"
    return 0
  fi

  require_command npx
  info "Generating schema via manifest pipeline"
  (cd "${BACKEND_DIR}" && npx ts-node scripts/dbx-manifest/generate.ts)

  SCHEMA_FILE="${GENERATED_SCHEMA_FILE}"
  SEED_FILE="${GENERATED_SEED_FILE}"

  if [ -f "${MANIFEST_HASH_FILE}" ]; then
    local hash
    hash="$(head -n 1 "${MANIFEST_HASH_FILE}" 2>/dev/null | tr -d '\r')"
    if [ -n "$hash" ]; then
      info "Using manifest hash ${hash}"
    fi
  fi
}

cmd_up() {
  info "Starting ${SERVICE_NAME} container via docker compose"
  (cd "${REPO_ROOT}" && compose up -d "${SERVICE_NAME}")
}

cmd_wait() {
  wait_for_health
}

cmd_init() {
  trap 'warn "db_local_init_error"; exit 1' ERR
  cmd_up
  ensure_manifest_generated
  wait_for_health
  info "db_local_init_start"
  apply_sql_file "$SCHEMA_FILE" "schema"
  apply_sql_file "$SEED_FILE" "seed"
  info "Local Postgres initialization completed."
  info "db_local_init_end"
  trap - ERR
}

cmd_reset() {
  cmd_up
  wait_for_health
  info "db_local_reset_start"
  info "Dropping known schemas before reapplying schema + seeds"
  cat <<'SQL' | psql_exec >/dev/null
DROP SCHEMA IF EXISTS ai_insights CASCADE;
DROP SCHEMA IF EXISTS analytics CASCADE;
DROP SCHEMA IF EXISTS sessions CASCADE;
DROP SCHEMA IF EXISTS users CASCADE;
SQL
  cmd_init
  info "db_local_reset_end"
}

cmd_shell() {
  cmd_up
  wait_for_health
  info "Opening interactive psql shell (Ctrl+D to exit)."
  compose exec "${SERVICE_NAME}" psql -U classwaves -d classwaves_dev
}

usage() {
  cat <<'USAGE'
Usage: scripts/db-local.sh <command>

Commands:
  up       Ensure the Postgres container is running
  wait     Wait until the Postgres container reports healthy
  init     Apply schema and seed files against the Postgres instance
  reset    Drop known schemas then re-run init
  shell    Open an interactive psql shell inside the container

Environment variables:
  DATABASE_URL            Override connection string used inside npm scripts (defaults to local dev URL)
  DB_LOCAL_WAIT_TIMEOUT   Override health wait timeout in seconds (default 90)
USAGE
}

main() {
  local cmd="${1:-}"
  if [ -z "$cmd" ]; then
    usage
    exit 1
  fi

  case "$cmd" in
    up)
      cmd_up
      ;;
    wait)
      cmd_wait
      ;;
    init)
      cmd_init
      ;;
    reset)
      cmd_reset
      ;;
    shell)
      cmd_shell
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      err "Unknown command: $cmd"
      usage
      exit 1
      ;;
  esac
}

main "$@"
