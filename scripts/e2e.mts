/**
 * End-to-end check against the running docker-compose stack (see scripts/e2e.sh).
 * Exercises the API contract, scheduling, diffing, LLM cost control and resilience.
 * Run with Node >= 22.18 (native TypeScript type stripping): node scripts/e2e.mts
 */
import assert from 'node:assert/strict';
import type { Competitor, Snapshot } from '../packages/contracts/index.d.ts';

const API = process.env.API_URL ?? 'http://localhost:8080/api';
const LLM = process.env.MOCK_LLM_URL ?? 'http://localhost:4001';
const SOURCE = process.env.LISTING_SOURCE_URL ?? 'http://localhost:4002';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(method: string, url: string, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const snapshots = async (id: string): Promise<Snapshot[]> => (await call('GET', `${API}/competitors/${id}/snapshots`)).json();
const llmCalls = async (): Promise<number> => ((await (await call('GET', `${LLM}/control/stats`)).json()) as { callCount: number }).callCount;
const configureLlm = (body: object) => call('POST', `${LLM}/control/configure`, body);

async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}

async function step(name: string, fn: () => Promise<void>): Promise<void> {
  process.stdout.write(`- ${name} ... `);
  await fn();
  console.log('ok');
}

await call('POST', `${LLM}/control/reset`);
// The first two LLM calls return HTTP 500: summaries must still complete via queue retries.
await configureLlm({ failNext: 2 });

await step('POST /competitors returns 201, rejects duplicates (409) and invalid ids (400)', async () => {
  assert.equal((await call('POST', `${API}/competitors`, { id: 'acme-crm' })).status, 201);
  assert.equal((await call('POST', `${API}/competitors`, { id: 'ferry-pay' })).status, 201);
  assert.equal((await call('POST', `${API}/competitors`, { id: 'acme-crm' })).status, 409);
  assert.equal((await call('POST', `${API}/competitors`, { id: 'Not A Slug' })).status, 400);
  const list = (await (await call('GET', `${API}/competitors`)).json()) as Competitor[];
  assert.deepEqual(list.map((c) => c.id).sort(), ['acme-crm', 'ferry-pay']);
});

await step('scheduler polls every competitor and persists every snapshot, newest first', async () => {
  const timeline = await waitFor('6 acme-crm snapshots', async () => {
    const s = await snapshots('acme-crm');
    return s.length >= 6 && s;
  });
  const times = timeline.map((s) => Date.parse(s.fetchedAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');

  const oldestFirst = [...timeline].reverse();
  assert.equal(oldestFirst[0].isBaseline, true);
  assert.equal(oldestFirst[0].changed, false);
  assert.deepEqual(oldestFirst.slice(0, 4).map((s) => s.changed), [false, true, true, true]);
  assert.deepEqual(oldestFirst.slice(1, 4).map((s) => s.changedFields), [['price'], ['tagline', 'description'], ['description']]);
  for (const s of oldestFirst.slice(4)) {
    assert.equal(s.changed, false, 'sequence exhausted: repeats are unchanged');
    assert.equal(s.summary, null);
    assert.equal(s.summaryStatus, 'none');
  }
});

await step('each detected change gets an LLM summary stored with its snapshot', async () => {
  const changed = await waitFor('acme-crm summaries completed', async () => {
    const c = (await snapshots('acme-crm')).filter((s) => s.changed);
    return c.length === 3 && c.every((s) => s.summaryStatus === 'completed') && c;
  });
  for (const s of changed) assert.match(s.summary ?? '', /Changed fields for acme-crm/);
});

await step('injected LLM HTTP 500s were retried transparently', async () => {
  const state = (await (await configureLlm({})).json()) as { state: { failNext: number } };
  assert.equal(state.state.failNext, 0, 'both injected failures were consumed by real calls');
});

await step('LLM is only called on change: call count stays flat while listings repeat', async () => {
  await waitFor('ferry-pay summaries completed', async () => {
    const c = (await snapshots('ferry-pay')).filter((s) => s.changed);
    return c.length === 3 && c.every((s) => s.summaryStatus === 'completed');
  });
  const before = await llmCalls();
  assert.equal(before, 6, '3 changes x 2 competitors');
  const countBefore = (await snapshots('acme-crm')).length;
  await waitFor('more polls', async () => (await snapshots('acme-crm')).length >= countBefore + 2);
  assert.equal(await llmCalls(), before);
});

await step('slow/failing LLM never loses the snapshot; summary ends "failed" and can be retried', async () => {
  await configureLlm({ latencyMs: 4000 }); // > LLM_TIMEOUT_MS in e2e.sh
  assert.equal((await call('POST', `${API}/competitors`, { id: 'north-analytics' })).status, 201);

  const pending = await waitFor('a pending change', async () =>
    (await snapshots('north-analytics')).find((s) => s.changed && s.summaryStatus === 'pending'),
  );
  assert.equal(pending.summary, null);
  assert.equal(pending.price.length > 0, true, 'snapshot fields are stored while the summary is pending');

  const apiStart = Date.now();
  await snapshots('north-analytics');
  assert.ok(Date.now() - apiStart < 1000, 'API stays responsive while the LLM is slow');

  const failed = await waitFor(
    'summary failed after retries',
    async () => (await snapshots('north-analytics')).find((s) => s.id === pending.id && s.summaryStatus === 'failed'),
    90_000,
  );
  assert.equal(failed.summary, null);
  assert.equal(failed.changed, true);

  await call('POST', `${LLM}/control/reset`);
// The first two LLM calls return HTTP 500: summaries must still complete via queue retries.
await configureLlm({ failNext: 2 });
  assert.equal((await call('POST', `${API}/snapshots/${failed.id}/summary/retry`)).status, 202);
  assert.equal((await call('POST', `${API}/snapshots/${failed.id}/summary/retry`)).status, 422, 'not failed anymore');
  await waitFor('retried summary completed', async () =>
    (await snapshots('north-analytics')).find((s) => s.id === failed.id && s.summaryStatus === 'completed'),
  );
});

await step('history is complete by default and pageable with limit/before (keyset, no gaps)', async () => {
  const all = await snapshots('acme-crm');
  const paged: Snapshot[] = [];
  let cursor: string | null = null;
  do {
    const query: string = cursor ? `limit=4&before=${cursor}` : 'limit=4';
    const res = await call('GET', `${API}/competitors/acme-crm/snapshots?${query}`);
    paged.push(...((await res.json()) as Snapshot[]));
    cursor = res.headers.get('x-next-cursor');
  } while (cursor);
  assert.ok(all.length > 4);
  assert.deepEqual(new Set(paged.map((s) => s.id)).size, paged.length, 'no duplicates');
  assert.ok(paged.length >= all.length, 'no gaps (new polls may land between pages)');
});

await step('ids, cursors and query params are validated without 500s', async () => {
  const status = async (method: string, path: string) => (await call(method, `${API}${path}`)).status;
  assert.equal(await status('GET', '/competitors/ACME-CRM/snapshots'), 200, 'ids are case-insensitive everywhere');
  assert.equal(await status('GET', '/competitors/acme-crm/snapshots?_=123'), 200, 'unknown query params are ignored');
  assert.equal(await status('GET', '/competitors/acme-crm/snapshots?before=9999999999999999999'), 400);
  assert.equal(await status('GET', '/competitors/acme-crm/snapshots?before=abc'), 400);
  assert.equal(await status('GET', '/competitors/acme-crm/snapshots?before=999999'), 400, 'unknown cursor');
  const ferry = (await snapshots('ferry-pay'))[0];
  assert.equal(await status('GET', `/competitors/acme-crm/snapshots?before=${ferry.id}`), 400, 'foreign cursor');
  assert.equal(await status('POST', '/snapshots/9999999999999999999/summary/retry'), 400);
  assert.equal(await status('POST', '/snapshots/999999/summary/retry'), 404);
  assert.equal(await status('GET', '/competitors/Bad%20Id!/snapshots'), 400);
});

await step('queue dashboard is served', async () => {
  assert.equal((await call('GET', `${API}/admin/queues`)).status, 200);
});

await step('a malformed request cannot take the listing source down', async () => {
  assert.equal((await fetch(`${SOURCE}/listings/%E0%A4%A`)).status, 400);
  assert.equal((await fetch(`${SOURCE}/health`)).status, 200);
});

await step('DELETE returns 204, stops tracking, and re-tracking restores history', async () => {
  const count = (await snapshots('ferry-pay')).length;
  const someFerrySnapshot = (await snapshots('ferry-pay'))[0];
  assert.equal((await call('DELETE', `${API}/competitors/FERRY-PAY`)).status, 204, 'ids are normalized on DELETE too');
  assert.equal(
    (await call('POST', `${API}/snapshots/${someFerrySnapshot.id}/summary/retry`)).status,
    404,
    'no paid retries for removed competitors',
  );
  assert.equal((await call('DELETE', `${API}/competitors/ferry-pay`)).status, 204, 'idempotent');
  assert.equal((await call('GET', `${API}/competitors/ferry-pay/snapshots`)).status, 404);
  const list = (await (await call('GET', `${API}/competitors`)).json()) as Competitor[];
  assert.ok(!list.some((c) => c.id === 'ferry-pay'));

  assert.equal((await call('POST', `${API}/competitors`, { id: 'ferry-pay' })).status, 201);
  assert.ok((await snapshots('ferry-pay')).length >= count);
});

await step('unknown competitor ids surface a poll error instead of crashing', async () => {
  assert.equal((await call('POST', `${API}/competitors`, { id: 'does-not-exist' })).status, 201);
  await waitFor('lastError recorded', async () => {
    const list = (await (await call('GET', `${API}/competitors`)).json()) as Competitor[];
    return list.find((c) => c.id === 'does-not-exist')?.lastError;
  });
});

console.log('\nAll end-to-end checks passed.');
