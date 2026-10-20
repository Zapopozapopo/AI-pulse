#!/usr/bin/env bash
# Integration tests for the repositories against a real PostgreSQL, in a separate *_test database.
# Non-destructive setup: creates the test database if missing and applies migrations (deploy).
# The tests themselves refuse to run against a database whose name doesn't end in "_test".
# Needs Postgres from `docker compose up -d postgres`. Usage: npm run test:int -w @competitor-pulse/api
set -euo pipefail
cd "$(dirname "$0")/.."
ADMIN_URL="${TEST_ADMIN_DATABASE_URL:-postgresql://pulse:pulse@localhost:5432/competitor_pulse}"
export DATABASE_URL="${TEST_DATABASE_URL:-postgresql://pulse:pulse@localhost:5432/competitor_pulse_test?schema=public}"
DB_NAME="$(node -e 'console.log(new URL(process.env.DATABASE_URL).pathname.slice(1))')"

echo "CREATE DATABASE \"$DB_NAME\";" | npx prisma db execute --url "$ADMIN_URL" --stdin >/dev/null 2>&1 || true
npx prisma migrate deploy >/dev/null
npx jest --testRegex '.*\.int-spec\.ts$' --runInBand "$@"
