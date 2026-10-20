# Manual test

A step-by-step check of the whole system. It looks directly at the PostgreSQL rows and the Redis keys, not only at API responses.

Run every command from the repository root. Each step says what you should see. The automated version of most of this is `npm run e2e`.

## 0. Setup

```bash
cd /path/to/AI-pulse
```

Start from an empty database and empty Redis:

```bash
docker compose down -v
```

Start the stack with fast timings: polls every 6s, LLM timeout 2s, 2 attempts, reconciler every 10s.

```bash
POLL_INTERVAL_SECONDS=6 SCHEDULER_TICK_SECONDS=1 POLL_JITTER_RATIO=0 LLM_TIMEOUT_MS=2000 LLM_MAX_ATTEMPTS=2 RECONCILE_INTERVAL_SECONDS=10 RECONCILE_PENDING_AFTER_SECONDS=15 docker compose up -d --build
```

Expect `{"status":"ok","checks":{"database":"up","redis":"up"}}`. Retry after a few seconds if the API isn't up yet.

```bash
curl -s localhost:3000/health
```

## 1. Schema and scheduler

Expect two migrations, both applied (`t`):

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select migration_name, finished_at is not null as applied from _prisma_migrations"
```

Expect 6 indexes, 3 of them partial (with a `WHERE`):

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select indexname, indexdef from pg_indexes where tablename in ('competitors','snapshots')"
```

Expect `tick` and `reconcile`, the schedules the worker registered in Redis:

```bash
docker compose exec redis redis-cli zrange bull:scheduler:repeat 0 -1
```

## 2. Track a competitor and follow its 4 versions

Expect `{"id":"acme-crm"}` with 201. The messy id gets trimmed and lowercased.

```bash
curl -s -w ' %{http_code}\n' -XPOST localhost:3000/api/competitors -H 'content-type: application/json' -d '{"id":" ACME-CRM "}'
```

Expect `next_poll_at` around now, and `last_snapshot_id` empty until the first poll:

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select id, deleted_at, next_poll_at, last_snapshot_id, last_content_hash from competitors"
```

Wait about 30s, then check the snapshot rows:

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select id, changed, changed_fields, previous_snapshot_id as prev, left(content_hash,10) as hash, summary_status, summary_attempts, price, tagline from snapshots order by id"
```

What to look for:

- **Baseline:** row 1 has `changed=f` and status `none`.
- **Changes:** rows 2–4 have `changed=t`, status `completed`, and changed fields `{price}`, then `{tagline,description}`, then `{description}`.
- **Chain:** each row's `prev` points to the row before it.
- **Repeats:** rows 5 onward have `changed=f`, the same hash as row 4, and status `none`.

Check the stored hashes against an independent calculation. Expect `e16eefcaa2`, `4795419cf1`, `e223bdddf3`, `89efedf671`, matching rows 1–4 above.

```bash
python3 -c "import json,hashlib; [print(hashlib.sha256(json.dumps([v['title'],v['tagline'],v['price'],v['description']],separators=(',',':')).encode()).hexdigest()[:10]) for v in json.load(open('fixtures/listings.json'))['acme-crm']]"
```

Expect `{"callCount": 3}`. It should stay at 3 if you rerun it later, because unchanged polls never call the LLM.

```bash
curl -s localhost:4001/control/stats
```

Expect 3 completed summarize jobs, and as many completed poll jobs as there are snapshot rows:

```bash
docker compose exec redis sh -c 'echo summarize_completed=$(redis-cli zcard bull:summarize:completed) poll_completed=$(redis-cli zcard bull:poll:completed)'
```

Check the API contract, newest snapshot first:

```bash
curl -s localhost:3000/api/competitors/acme-crm/snapshots | python3 -m json.tool | head -30
```

## 3. LLM timeout, then the summary cache, then retry

Make the mock LLM (4s) slower than our timeout (2s):

```bash
curl -s -XPOST localhost:4001/control/configure -d '{"latencyMs":4000}'
```

Restart the listing stub's sequence, so it goes from version 4 back to version 1. That 4→1 change is new.

```bash
curl -s -XPOST localhost:4002/control/reset
```

Wait about 30s, then check:

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select id, changed_fields, summary_status, summary_attempts, summary_error, price from snapshots where changed order by id"
```

What to look for:

- **Timeout:** the new 4→1 row is `failed` with 2 attempts and a timeout error. Its listing fields are still stored.
- **Cache:** the following rows (1→2, 2→3, 3→4) are `completed` with 0 attempts. Those changes had been seen before, so no LLM call was made.

Expect the job data, `atm` 2 and the timeout error. `atm` is BullMQ's attempt count.

```bash
docker compose exec redis sh -c 'for j in $(redis-cli zrange bull:summarize:failed 0 -1); do redis-cli hmget bull:summarize:$j data atm failedReason; done'
```

> The mock's `callCount` now includes the 2 timed-out calls. The mock still finishes and counts requests that our client already gave up on. A real provider would bill those too.

Make the mock LLM healthy again:

```bash
curl -s -XPOST localhost:4001/control/reset
```

Retry the failed summary through the API. Expect 202.

```bash
curl -s -w '%{http_code}\n' -XPOST "localhost:3000/api/snapshots/$(docker compose exec -T postgres psql -U pulse -d competitor_pulse -Atc "select id from snapshots where summary_status='failed' order by id desc limit 1")/summary/retry"
```

Expect no failed rows left:

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select id, summary_status, summary_attempts, summary_error from snapshots where changed order by id"
```

## 4. Reconciler: simulate a lost job

Put a finished summary back to `pending` directly in the database, with no job in Redis:

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "update snapshots set summary_status='pending', summary=null where id=(select max(id) from snapshots where summary_status='completed') returning id"
```

Wait about 15s. Expect that row to be `completed` again:

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select id, summary_status from snapshots where changed order by id desc limit 3"
```

Expect `Re-enqueued 1 stuck pending summaries` in the worker log:

```bash
docker compose logs worker | grep -E "Re-enqueued"
```

## 5. Remove and re-track

Expect 204. Ids are case-insensitive.

```bash
curl -s -w '%{http_code}\n' -XDELETE localhost:3000/api/competitors/Acme-CRM
```

Run this twice, about 15s apart. The snapshot count and `next_poll_at` should not change while the competitor is removed.

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select deleted_at, next_poll_at, last_snapshot_id, (select count(*) from snapshots) as snapshots from competitors where id='acme-crm'"
```

Expect 201. The competitor comes back with its history.

```bash
curl -s -w ' %{http_code}\n' -XPOST localhost:3000/api/competitors -H 'content-type: application/json' -d '{"id":"acme-crm"}'
```

Wait a few seconds. The first new row's `previous_snapshot_id` should be the last snapshot from before the removal.

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select id, previous_snapshot_id, changed, fetched_at from snapshots order by id desc limit 3"
```

## 6. Listing-source failures

Make the next 2 source calls return 503:

```bash
curl -s -XPOST localhost:4002/control/configure -d '{"failNext":2}'
```

Wait about 10s. Expect `failed (attempt 1)` and `(attempt 2)` in the log, and polling continues afterwards:

```bash
docker compose logs worker | grep "Poll of acme-crm failed" | tail -3
```

Expect `consecutive_failures = 0` and an empty `last_error`. The retries happened inside one job, so no failure was recorded.

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select consecutive_failures, last_error from competitors where id='acme-crm'"
```

Track an id the source doesn't know:

```bash
curl -s -XPOST localhost:3000/api/competitors -H 'content-type: application/json' -d '{"id":"ghost-co"}'
```

What to expect:

- `last_error` is set and `consecutive_failures = 1`.
- The next poll is at most 12s away (twice the interval).
- There are no snapshot rows.

```bash
docker compose exec postgres psql -U pulse -d competitor_pulse -c "select consecutive_failures, last_error, round(extract(epoch from next_poll_at - now())) as next_poll_in_s, (select count(*) from snapshots where competitor_id='ghost-co') as snapshots from competitors where id='ghost-co'"
```

Expect `atm` 1: the job failed once and was never retried.

```bash
docker compose exec redis sh -c 'for j in $(redis-cli zrange bull:poll:failed 0 -1); do redis-cli hmget bull:poll:$j data atm failedReason; done'
```

## 7. Input validation (no 500s)

Expect `400 400 400 200 200`, in this order:

- id too large
- not a number
- unknown cursor
- unknown query parameter, which is ignored
- no query

```bash
for q in 'before=9999999999999999999' 'before=abc' 'before=999999' '_=123' ''; do curl -s -o /dev/null -w '%{http_code} ' "localhost:3000/api/competitors/acme-crm/snapshots?$q"; done; echo
```

Expect `400`, because the snapshot id is too large:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -XPOST localhost:3000/api/snapshots/9999999999999999999/summary/retry
```

Expect `400`, then `{"status":"ok"}`. The stub survives a malformed request.

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'localhost:4002/listings/%E0%A4%A'; curl -s localhost:4002/health
```

Expect an `x-next-cursor` header on a paged response:

```bash
curl -s -D - -o /dev/null 'localhost:3000/api/competitors/acme-crm/snapshots?limit=3' | grep -i x-next-cursor
```

## 8. UI and dashboard

Open these in a browser:

- **UI:** http://localhost:8080. Click `acme-crm`. With the fast timings the timeline passes 50 snapshots within a few minutes, and then a "Load older snapshots" button appears.
- **Queue dashboard:** http://localhost:8080/api/admin/queues.

## 9. Back to normal demo settings

```bash
docker compose down -v
```

```bash
docker compose up -d
```
