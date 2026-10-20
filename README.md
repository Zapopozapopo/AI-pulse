# CompetitorPulse

Tracks competitor product listings over time and uses an LLM to explain, in plain English, what changed between two consecutive snapshots.

- **Backend:** NestJS + TypeScript, PostgreSQL (Prisma + migrations), BullMQ on Redis
- **Frontend:** React + TypeScript (Vite, React Router, TanStack Query)
- **LLM:** the provided **mock LLM server**, called through an OpenAI-compatible client (details [below](#llm))
- **Ops:** Dockerfiles for every service and one-command startup with `docker compose`

Design write-up and diagrams: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Step-by-step manual test with direct database and Redis checks: [docs/MANUAL_TEST.md](docs/MANUAL_TEST.md).

## Quick start

Requirements: Docker with Compose v2. Node.js 22.18 or newer is only needed for local development and the e2e script.

```bash
docker compose up --build
```

| What | URL |
| --- | --- |
| Web UI | http://localhost:8080 |
| REST API | http://localhost:8080/api/competitors (also served directly on :3000) |
| Queue dashboard (Bull Board) | http://localhost:8080/api/admin/queues |
| Health (DB + Redis) | http://localhost:3000/health |
| Mock LLM control | http://localhost:4001/control/stats |
| Listing source stub | http://localhost:4002/control/state |

To try it, track `acme-crm`, `north-analytics` or `ferry-pay` in the UI. The demo stack polls every 20 s, so a new snapshot appears every ~20 s. Each fixture changes 3 times, and after that the timeline shows "No change" entries.

All ports are published on `127.0.0.1` only. Compose starts these services: `postgres`, `redis`, `migrate` (a one-shot `prisma migrate deploy`), `api`, `worker`, `listing-source`, `mock-llm` and `web` (nginx). The API and worker images start only after migrations succeed and their dependencies report healthy.

## API

The required contract plus a few extras:

```
GET    /api/competitors                       -> [{ id, createdAt, lastPolledAt, nextPollAt, lastError }]
POST   /api/competitors      { "id": "..." }  -> 201 Created | 400 invalid slug | 409 already tracked
DELETE /api/competitors/:id                   -> 204 No Content (idempotent)
GET    /api/competitors/:id/snapshots         -> Snapshot[] newest first, complete history | 404 not tracked
       optional ?limit=1..500 &before=<snapshotId> for keyset paging (X-Next-Cursor header; 400 bad cursor)
POST   /api/snapshots/:id/summary/retry       -> 202 (re-queues a failed summary) | 404 | 422 not failed
```

Each `Snapshot` has the required fields `fetchedAt, title, tagline, price, description, changed, summary`. It also has these extras:

- `id`
- `summaryStatus`: `none | pending | completed | failed`
- `changedFields`
- `isBaseline`

`summary` is `null` unless `summaryStatus` is `completed`, as the contract requires.

Competitor ids are trimmed and lowercased on every endpoint (`ACME-CRM` and `acme-crm` are the same competitor). Malformed ids, snapshot ids and cursors get a 400, never a 500. Unknown query parameters are ignored.

## How it works (short version)

```
scheduler tick (every 5s) ──claims due competitors (SQL, SKIP LOCKED)──► poll queue
poll job: fetch ─► checkpoint in job ─► normalize ─► sha256 ─► compare with stored hash ─► INSERT snapshot (always)
                                                     └─ changed? ─► summarize queue (after commit)
summarize job: competitor still tracked? ─► cache lookup ─► LLM call (timeout) ─► UPDATE summary   [retries + backoff + rate limit]
reconcile (every 60s): re-enqueue summaries stuck in "pending"
```

- **Persistence first.** The snapshot is committed before an LLM call is even queued. A slow or failing LLM can only leave a summary `pending` or `failed`. It cannot lose or corrupt the snapshot.
- **Cheap change detection.** Each competitor row stores the hash of its latest snapshot, so an unchanged poll costs one indexed read and one insert. No LLM call and no "previous snapshot" query. The hash is taken over a whitespace-normalized copy, but the snapshot stores the raw fetched text.
- **LLM cost control:**
  - The LLM is called only when the content changes.
  - Normalization is whitespace-only, so scraper noise doesn't trigger billed calls.
  - Summaries are cached per competitor and `(previous hash → new hash)` transition, so a page flip-flopping between A/B variants is billed once.
  - Timeouts, 408, 429 and 5xx are retried. Any other HTTP error (400, 401, 403, 404, …) is permanent and fails at once instead of burning retries.
  - A queue-level rate limit and bounded concurrency apply.
  - No LLM calls for removed competitors. Their pending summaries stay `pending` and resume when the competitor is re-tracked.
- **Safe to scale out.**
  - The DB is the source of truth for scheduling.
  - The tick is a BullMQ job scheduler that fires once per interval across all replicas.
  - Claims use `FOR UPDATE SKIP LOCKED`. If the jobs can't be enqueued, the claim is handed back so no cycle is skipped.
  - Jobs are deduplicated per competitor and per snapshot.
  - Every handler is idempotent, because delivery is at-least-once.
  - A poll job checkpoints its fetched listing in the job before writing. If the write fails, the retry reuses that listing instead of fetching again, so a retry never skips a version of the (non-idempotent) source.

## LLM

This project uses the **provided mock LLM server** (`infra/mock-llm/mock-llm-server.py`), which compose runs as a container. It needs no API key and costs nothing. It does not generate real summaries: the "summary" it returns echoes the start of the prompt. Our prompt starts with a field-level diff, so the echo still reads like a summary, for example `Changed fields for acme-crm: - price: "$29/mo" -> "$39/mo"`.

The backend uses a provider-agnostic `LlmProvider` port (`apps/api/src/llm`). Its only adapter calls any **OpenAI Chat Completions–compatible** endpoint over `fetch`. To switch to a real model, change three environment variables: `LLM_BASE_URL` (e.g. `https://api.openai.com/v1` or an Ollama `/v1` URL), `LLM_API_KEY` and `LLM_MODEL`.

The prompt is in `apps/api/src/llm/prompt.ts`. It uses temperature 0, a small `max_tokens`, and a deterministic diff first. The competitor text is treated as untrusted data, because a scraped page could contain prompt-injection text. Every piece of it sits inside fenced `<changes>`, `<previous>` and `<current>` blocks, JSON-encoded with `<`, `>` and `&` escaped, so it can't close a fence early.

## Configuration

All settings are environment variables and are validated at startup with zod (`apps/api/src/config/app-config.ts`). The ones you are most likely to change:

| Variable | Compose default | Meaning |
| --- | --- | --- |
| `POLL_INTERVAL_SECONDS` | `20` | Poll period per competitor (production: `900`) |
| `POLL_JITTER_RATIO` | `0.1` | ±10% spread, so many competitors don't poll in lockstep |
| `POLL_MAX_ATTEMPTS` | `3` | Attempts per poll job (exponential backoff from 1 s) before `last_error` is recorded |
| `SCHEDULER_TICK_SECONDS` | `5` | How often due competitors are claimed (also the max delay before a new competitor's first poll) |
| `LLM_TIMEOUT_MS` | `10000` | Hard timeout per LLM request |
| `LLM_MAX_ATTEMPTS` | `5` | Attempts before a summary is marked `failed` (exponential backoff from 5 s) |
| `LLM_RATE_PER_SEC` / `SUMMARY_CONCURRENCY` | `5` / `4` | Cost and quota guard, shared by all worker replicas |
| `RECONCILE_PENDING_AFTER_SECONDS` | `120` | When a `pending` summary counts as stuck and gets re-enqueued |
| `REDIS_URL` | `redis://redis:6379` | `rediss://` enables TLS; URL-encoded credentials are decoded |

Example: `POLL_INTERVAL_SECONDS=900 docker compose up`. The full list is in [.env.example](.env.example).

## Local development (without containerizing the apps)

```bash
npm install                      # also runs prisma generate
docker compose up -d postgres redis mock-llm listing-source
cp .env.example apps/api/.env
npm run prisma:deploy -w @competitor-pulse/api
npm run dev:api                  # http://localhost:3000
npm run dev:worker
npm run dev:web                  # http://localhost:5173 (proxies /api to :3000)
```

## Tests

```bash
npm run typecheck   # all workspaces
npm test            # unit tests: Jest (api), node:test (listing-source), Vitest (web)
npm run test:int    # repository integration tests on real Postgres (needs `docker compose up -d postgres`)
npm run e2e         # fresh docker compose stack with fast timings + end-to-end checks
```

The **e2e suite** (`scripts/e2e.mts`) runs against the real stack. It checks:

- the contract's status codes
- complete newest-first history with correct `changed` flags and `changedFields`
- summaries for every change
- that the mock LLM's `callCount` stays flat while listings repeat
- injected LLM HTTP 500s being retried transparently
- LLM timeouts: the snapshot is kept while its summary is `pending`, the API stays responsive, the summary ends `failed`, and a manual retry completes it
- complete history by default, plus gap-free keyset paging
- 400 (never 500) for malformed ids, snapshot ids and cursors, and case-insensitive ids
- the queue dashboard being served
- the listing source surviving a malformed request
- soft delete and re-track, with no paid retries for removed competitors
- unknown ids recording a poll error

The **integration tests** (`apps/api/test/*.int-spec.ts`) run in a separate `*_test` database, which is created if missing and migrated with `migrate deploy`. The tests refuse to run against any other database. They cover:

- the scheduler claim: due/active filtering, jitter bounds, batch order, and disjoint concurrent claims under `SKIP LOCKED`
- the ×2/×4/×8 failure backoff
- the snapshot compare-and-set rollback
- gap-free keyset paging
- the per-competitor summary cache
- the reconciler skipping removed competitors
- idempotent summary transitions

GitHub Actions runs typecheck, unit tests, e2e and the DB integration tests (`.github/workflows/ci.yml`).

You can also inject faults by hand while the stack is running:

```bash
curl -XPOST localhost:4001/control/configure -d '{"latencyMs":20000}'   # LLM slower than its timeout
curl -XPOST localhost:4001/control/configure -d '{"failNext":3}'        # next 3 LLM calls return 500
curl -XPOST localhost:4002/control/configure -d '{"failNext":2}'        # listing source returns 503
curl -XPOST localhost:4001/control/reset
```

## Assumptions

- **The first snapshot is a baseline.** It has `changed: false` and no LLM call, because there is nothing to compare against. As the spec asks for unchanged snapshots, the UI shows it as "No change", noting that it is the first snapshot.
- **Unknown ids are accepted** (`201`). We can't validate them without calling the source, and the stub would advance its counter. The poll then records `lastError`, which the UI shows, and backs off (×2, ×4, ×8 the interval).
- **Removing a competitor is a soft delete.** Its history is kept, and re-tracking resumes the same timeline. `DELETE` is idempotent.
- **The listing source is a separate tiny HTTP service** with in-memory, per-id counters. It is the single owner of the sequence, so any number of API or worker replicas see one consistent sequence. Restarting it restarts the sequences.
- **Whitespace-only differences don't count as changes.** Case and punctuation changes do. The stored snapshot keeps the raw text exactly as fetched.
- **The timeline UI loads 50 snapshots at a time** with a "Load older snapshots" button. The API returns the full history when no `limit` is given.
- **No auth**, including the queue dashboard. This is a single internal user, as specified; every port is published on `127.0.0.1` only. In production the dashboard would sit behind SSO or a VPN.

## Production notes

- **Scale.** 300 competitors × 96 polls/day ≈ 29k snapshot rows/day (~10M/year). That is trivial for Postgres with the `(competitor_id, fetched_at DESC, id DESC)` index. The scheduler's due-query uses a partial index on active competitors. Next steps at real scale:
  - monthly partitioning or a retention policy for unchanged snapshots
  - content-addressed storage, so identical consecutive snapshots don't repeat the text columns
- **Deployment (documented, not deployed).** The same images run on any container platform, for example AWS ECS Fargate with RDS Postgres and ElastiCache Redis, or Fly.io / Railway with managed Postgres and Redis.
  - Run `migrate` as a release or pre-deploy task.
  - Scale `api` behind a load balancer on `/health`.
  - Scale `worker` independently on queue depth.
  - Serve `web` from a CDN or keep it behind nginx.
  - Keep Postgres and Redis on a private network, and use `rediss://` for managed Redis.
  - Keep secrets such as `LLM_API_KEY` in the platform's secret store.
- **Observability.**
  - Structured JSON logs (pino).
  - `/health` checks the DB and Redis.
  - Bull Board shows queue depth, retries and failures.
  - Next: Prometheus metrics for queue lag, LLM latency, error rate and spend, plus an alert on a growing `failed` count.
- **Timeouts are not free.** A request the client aborts can still be processed, and billed, by the provider. The mock shows this: its call counter includes requests our 2s timeout had already given up on. So `LLM_TIMEOUT_MS` should sit above the provider's p99 latency; otherwise each retry after a timeout can bill the same change twice.
- **Fetch checkpoint window.** The fetch checkpoint lives in the poll job, so it covers retries of that job only. One version of the stub can still be skipped in three cases:
  - A database outage outlasts the poll retry budget (`POLL_MAX_ATTEMPTS`, backoff from 1 s). The job fails for good, its checkpoint goes with it, and the next scheduled poll fetches fresh.
  - The worker crashes between the fetch and writing the checkpoint.
  - The response is lost after the source already advanced.

  With a real website none of these lose anything, because the next poll simply sees the current page. Closing them for the stub would need the unsaved fetch kept per competitor outside the job (e.g. a Redis key cleared after the write), or an idempotency key the source honours.
- **Known trade-off.** The summarize job is enqueued after the snapshot commits, not inside the same transaction. The reconciler closes that gap (outbox-lite). A transactional outbox table, or pg-boss, would make the hand-off atomic.

## What I'd do next

- A daily LLM budget guard: a counter in Redis that pauses the summarize queue when the budget is exceeded.
- Push updates to the UI with Server-Sent Events instead of polling every 5 s.
- Collapse runs of "no change" snapshots in the timeline.
- Run the repository integration tests in Testcontainers, so they don't need the compose Postgres.

## AI tools used

Built with **Claude Code** (Anthropic). I used it for architecture discussion and planning, scaffolding, implementation, tests and documentation. I reviewed and directed all design decisions.