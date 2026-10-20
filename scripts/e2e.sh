#!/usr/bin/env bash
# Starts a fresh stack with fast timings, then runs the end-to-end checks.
set -euo pipefail
cd "$(dirname "$0")/.."

export POLL_INTERVAL_SECONDS=3 SCHEDULER_TICK_SECONDS=1 POLL_JITTER_RATIO=0
export LLM_TIMEOUT_MS=2000 LLM_MAX_ATTEMPTS=2

docker compose down -v --remove-orphans >/dev/null 2>&1 || true
docker compose up -d --build

echo "Waiting for the API..."
for _ in $(seq 1 60); do
  curl -fs http://localhost:8080/api/competitors >/dev/null 2>&1 && break
  sleep 2
done

node scripts/e2e.mts
