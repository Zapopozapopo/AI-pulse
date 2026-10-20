import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { ListingSequencer, type Fixtures } from './listing-sequencer.ts';

const port = Number(process.env.PORT ?? 4002);
const fixturesPath = process.env.FIXTURES_PATH ?? new URL('../../../fixtures/listings.json', import.meta.url).pathname;
const sequencer = new ListingSequencer(JSON.parse(readFileSync(fixturesPath, 'utf8')) as Fixtures);

// Fault injection, mirroring the mock LLM server, so poll retries can be demonstrated.
const faults = { latencyMs: 0, failNext: 0 };

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const listingMatch = /^\/listings\/([^/]+)$/.exec(url.pathname);

  if (req.method === 'GET' && listingMatch) {
    let id: string;
    try {
      id = decodeURIComponent(listingMatch[1]);
    } catch {
      return send(res, 400, { error: 'malformed competitor id' });
    }
    if (faults.latencyMs > 0) await sleep(faults.latencyMs);
    if (faults.failNext > 0) {
      faults.failNext -= 1;
      return send(res, 503, { error: 'listing-source: injected failure' });
    }
    const next = sequencer.next(id);
    if (!next) return send(res, 404, { error: `unknown competitor "${id}"` });
    console.log(`[listing-source] ${id} -> v${next.version}`);
    return send(res, 200, next.listing);
  }

  if (req.method === 'GET' && url.pathname === '/listings') return send(res, 200, { ids: sequencer.ids() });
  if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok' });
  if (req.method === 'GET' && url.pathname === '/control/state') {
    return send(res, 200, { cursors: sequencer.state(), faults });
  }
  if (req.method === 'POST' && url.pathname === '/control/configure') {
    const body = await readJson(req);
    if (typeof body.latencyMs === 'number') faults.latencyMs = body.latencyMs;
    if (typeof body.failNext === 'number') faults.failNext = body.failNext;
    return send(res, 200, { ok: true, faults });
  }
  if (req.method === 'POST' && url.pathname === '/control/reset') {
    sequencer.reset();
    faults.latencyMs = 0;
    faults.failNext = 0;
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'not found' });
}

// One bad request must never take the whole data source down: every error becomes a 500.
const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    console.error('[listing-source] request failed', error);
    if (!res.headersSent) send(res, 500, { error: 'internal error' });
    else res.destroy();
  });
});

server.listen(port, () => console.log(`[listing-source] listening on :${port}, fixtures: ${fixturesPath}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
