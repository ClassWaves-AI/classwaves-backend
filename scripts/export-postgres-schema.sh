#!/usr/bin/env bash
set -euo pipefail

# Export local Postgres schema (schemas/tables/columns) to docs/LOCAL_POSTGRES_SCHEMA.md
# Prefers Docker container `classwaves-postgres`; falls back to psql via $DATABASE_URL

OUTPUT_FILE="$(dirname "$0")/../docs/LOCAL_POSTGRES_SCHEMA.md"
MANIFEST_HASH_FILE="$(dirname "$0")/../src/db/local/generated/schema-manifest.hash"
DB_USER="${PGUSER:-classwaves}"
DB_NAME="${PGDATABASE:-classwaves_dev}"
DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5433}"

MANIFEST_HASH=""
if [ -f "$MANIFEST_HASH_FILE" ]; then
  MANIFEST_HASH="$(head -n 1 "$MANIFEST_HASH_FILE" 2>/dev/null | tr -d '\r')"
fi

HEADER_TS="generated $(date -u +%FT%TZ)"
if [ -n "$MANIFEST_HASH" ]; then
  HEADER_TS="$HEADER_TS; manifest_hash=${MANIFEST_HASH}"
fi

echo "# Local Postgres Schema (${HEADER_TS})" > "$OUTPUT_FILE"
echo >> "$OUTPUT_FILE"

SQL="\
SELECT table_schema ||'.'|| table_name AS full_table,
       column_name,
       data_type,
       is_nullable
FROM information_schema.columns
WHERE table_schema NOT IN ('pg_catalog','information_schema')
ORDER BY table_schema, table_name, ordinal_position;"

run_psql() {
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -At -F $'\t' -c "$SQL"
}

if command -v docker >/dev/null 2>&1 && docker inspect classwaves-postgres >/dev/null 2>&1; then
  echo "Using Docker container classwaves-postgres for schema export..."
  docker exec -e PSQLRC="/dev/null" classwaves-postgres psql -U "$DB_USER" -d "$DB_NAME" -At -F $'\t' -c "$SQL" \
  | awk 'BEGIN{print "| Table | Column | Type | Nullable |\n|-------|--------|------|----------|"} {printf("| %s | %s | %s | %s |\n", $1,$2,$3,$4)}' >> "$OUTPUT_FILE"
else
  echo "Using local psql for schema export..."
  run_psql | awk 'BEGIN{print "| Table | Column | Type | Nullable |\n|-------|--------|------|----------|"} {printf("| %s | %s | %s | %s |\n", $1,$2,$3,$4)}' >> "$OUTPUT_FILE"
fi

echo "✅ Wrote schema to $OUTPUT_FILE"
