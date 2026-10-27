#!/usr/bin/env bash
# Apply all migrations + seed + SQL tests to a throwaway Postgres database.
# Usage: DATABASE_URL=postgres://... scripts/db-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
DB_NAME="hbs_test_$$"
psql "$DB_URL" -qc "create database $DB_NAME" >/dev/null
TEST_URL="${DB_URL%/*}/$DB_NAME"
trap 'psql "$DB_URL" -qc "drop database if exists $DB_NAME" >/dev/null' EXIT
run() { psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null; echo "ok  $1"; }
run supabase/tests/supabase_shim.sql
for f in supabase/migrations/*.sql; do run "$f"; done
run supabase/seed.sql
for f in supabase/tests/[0-9]*.sql; do
  [ -e "$f" ] || continue
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$f" && echo "ok  $f"
done
if [ -n "${KEEP_DB_DUMP:-}" ]; then pg_dump -s "$TEST_URL" > "$KEEP_DB_DUMP"; fi
