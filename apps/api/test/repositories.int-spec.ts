import { SummaryStatus } from '@prisma/client';
import { CompetitorsRepository } from '../src/competitors/competitors.repository';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashListing } from '../src/snapshots/listing';
import { SnapshotsRepository, StaleSnapshotPointerError } from '../src/snapshots/snapshots.repository';

const prisma = new PrismaService();
const competitors = new CompetitorsRepository(prisma);
const snapshots = new SnapshotsRepository(prisma);

const listing = { title: 'Acme CRM', tagline: 'Simple', price: '$29/mo', description: 'Track leads.' };
const INTERVAL = 100;

const nextPollIn = async (id: string) => {
  const c = await prisma.competitor.findUniqueOrThrow({ where: { id } });
  return (c.nextPollAt.getTime() - Date.now()) / 1000;
};

async function append(competitorId: string, previousSnapshotId: bigint | null, overrides = {}) {
  return snapshots.appendSnapshot({
    competitorId,
    fetchedAt: new Date(),
    listing,
    contentHash: hashListing(listing),
    previousSnapshotId,
    previousContentHash: null,
    changed: false,
    changedFields: [],
    ...overrides,
  });
}

beforeAll(async () => {
  // Every test wipes its tables: never run against anything but a dedicated test database.
  const database = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  if (!database.endsWith('_test')) throw new Error(`Refusing to run integration tests against "${database}"`);
  await prisma.$connect();
});
afterAll(() => prisma.$disconnect());
beforeEach(async () => {
  await prisma.snapshot.deleteMany();
  await prisma.competitor.deleteMany();
});

describe('CompetitorsRepository.claimDue', () => {
  it('claims only active, due competitors and schedules them interval ± jitter ahead', async () => {
    const past = new Date(Date.now() - 1000);
    await prisma.competitor.createMany({
      data: [
        { id: 'due-1', nextPollAt: past },
        { id: 'due-2', nextPollAt: past },
        { id: 'future', nextPollAt: new Date(Date.now() + 60_000) },
        { id: 'deleted', nextPollAt: past, deletedAt: new Date() },
      ],
    });

    expect((await competitors.claimDue(10, INTERVAL, 0.1)).sort()).toEqual(['due-1', 'due-2']);
    for (const id of ['due-1', 'due-2']) {
      const seconds = await nextPollIn(id);
      expect(seconds).toBeGreaterThan(INTERVAL * 0.9 - 1);
      expect(seconds).toBeLessThan(INTERVAL * 1.1 + 1);
    }
    expect(await competitors.claimDue(10, INTERVAL, 0.1)).toEqual([]);
  });

  it('never hands the same competitor to concurrent claimers (FOR UPDATE SKIP LOCKED)', async () => {
    const past = new Date(Date.now() - 1000);
    await prisma.competitor.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ id: `c-${i}`, nextPollAt: past })) });

    const batches = await Promise.all(Array.from({ length: 6 }, () => competitors.claimDue(10, INTERVAL, 0)));
    const claimed = batches.flat();
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.length).toBeLessThanOrEqual(30);
    // Anything not claimed concurrently is still due and is picked up by the next tick.
    const rest = await competitors.claimDue(100, INTERVAL, 0);
    expect(new Set([...claimed, ...rest]).size).toBe(30);
  });

  it('respects the batch limit, oldest due first', async () => {
    await prisma.competitor.createMany({
      data: [
        { id: 'newest', nextPollAt: new Date(Date.now() - 1000) },
        { id: 'oldest', nextPollAt: new Date(Date.now() - 3000) },
        { id: 'middle', nextPollAt: new Date(Date.now() - 2000) },
      ],
    });
    expect(await competitors.claimDue(2, INTERVAL, 0)).toHaveLength(2);
    expect(await competitors.claimDue(2, INTERVAL, 0)).toEqual(['newest']);
  });

  it('releaseClaims makes claimed competitors due again', async () => {
    await prisma.competitor.create({ data: { id: 'a', nextPollAt: new Date(Date.now() - 1000) } });
    await competitors.claimDue(10, INTERVAL, 0);
    await competitors.releaseClaims(['a']);
    expect(await competitors.claimDue(10, INTERVAL, 0)).toEqual(['a']);
  });
});

describe('CompetitorsRepository.recordPollFailure', () => {
  it('backs off x2, x4, x8 and caps at x8, keeping the last error', async () => {
    await prisma.competitor.create({ data: { id: 'flaky' } });
    for (const multiplier of [2, 4, 8, 8]) {
      await competitors.recordPollFailure('flaky', 'boom', INTERVAL);
      expect(await nextPollIn('flaky')).toBeCloseTo(INTERVAL * multiplier, -1);
    }
    const row = await prisma.competitor.findUniqueOrThrow({ where: { id: 'flaky' } });
    expect(row).toMatchObject({ consecutiveFailures: 4, lastError: 'boom' });
  });

  it('does not touch removed competitors', async () => {
    await prisma.competitor.create({ data: { id: 'gone', deletedAt: new Date() } });
    await competitors.recordPollFailure('gone', 'boom', INTERVAL);
    expect((await prisma.competitor.findUniqueOrThrow({ where: { id: 'gone' } })).lastError).toBeNull();
  });
});

describe('SnapshotsRepository.appendSnapshot', () => {
  it('inserts the snapshot and advances the pointer, resetting failure state', async () => {
    await prisma.competitor.create({ data: { id: 'acme', lastError: 'old', consecutiveFailures: 2 } });
    const first = await append('acme', null);
    const second = await append('acme', first.id, { changed: true });

    const competitor = await prisma.competitor.findUniqueOrThrow({ where: { id: 'acme' } });
    expect(competitor).toMatchObject({ lastSnapshotId: second.id, lastError: null, consecutiveFailures: 0 });
    expect(second.summaryStatus).toBe(SummaryStatus.pending);
    expect(first.summaryStatus).toBe(SummaryStatus.none);
  });

  it('rolls back (no orphan snapshot) when the pointer moved concurrently', async () => {
    await prisma.competitor.create({ data: { id: 'acme' } });
    const first = await append('acme', null);

    await expect(append('acme', null)).rejects.toBeInstanceOf(StaleSnapshotPointerError);
    expect(await prisma.snapshot.count()).toBe(1);
    expect((await prisma.competitor.findUniqueOrThrow({ where: { id: 'acme' } })).lastSnapshotId).toBe(first.id);
  });

  it('rolls back when the competitor was removed during the poll', async () => {
    await prisma.competitor.create({ data: { id: 'acme', deletedAt: new Date() } });
    await expect(append('acme', null)).rejects.toBeInstanceOf(StaleSnapshotPointerError);
    expect(await prisma.snapshot.count()).toBe(0);
  });
});

describe('SnapshotsRepository queries', () => {
  it('pages the timeline newest first without gaps or duplicates', async () => {
    await prisma.competitor.create({ data: { id: 'acme' } });
    let previous: bigint | null = null;
    for (let i = 0; i < 5; i++) previous = (await append('acme', previous)).id;

    const all = await snapshots.listForCompetitor('acme');
    expect(all).toHaveLength(5);
    const paged = [];
    let cursor;
    do {
      const page = await snapshots.listForCompetitor('acme', 2, cursor);
      paged.push(...page);
      cursor = page.length === 2 ? page[1] : undefined;
    } while (cursor);
    expect(paged.map((s) => s.id)).toEqual(all.map((s) => s.id));
    expect(all.map((s) => s.id)).toEqual([...all.map((s) => s.id)].sort((a, b) => (a > b ? -1 : 1)));
  });

  it('only reuses cached summaries of the same competitor', async () => {
    await prisma.competitor.createMany({ data: [{ id: 'a' }, { id: 'b' }] });
    const base = await append('a', null);
    const changed = await append('a', base.id, { changed: true, previousContentHash: 'h1', contentHash: 'h2' });
    await snapshots.completeSummary(changed.id, 'A changed.', 'mock');

    expect(await snapshots.findCachedSummary('a', 'h1', 'h2')).toEqual({ summary: 'A changed.', llmModel: 'mock' });
    expect(await snapshots.findCachedSummary('b', 'h1', 'h2')).toBeNull();
  });

  it('reconciler only picks up stuck summaries of tracked competitors', async () => {
    await prisma.competitor.createMany({ data: [{ id: 'kept' }, { id: 'removed' }] });
    const keptBase = await append('kept', null);
    const kept = await append('kept', keptBase.id, { changed: true });
    const removedBase = await append('removed', null);
    await append('removed', removedBase.id, { changed: true });
    await competitors.softDelete('removed');

    expect(await snapshots.findStalePending(new Date(Date.now() + 1000), 10)).toEqual([kept.id]);
  });

  it('summary transitions are conditional on pending (idempotent)', async () => {
    await prisma.competitor.create({ data: { id: 'acme' } });
    const base = await append('acme', null);
    const s = await append('acme', base.id, { changed: true });

    expect(await snapshots.completeSummary(s.id, 'first', 'm')).toBe(true);
    expect(await snapshots.completeSummary(s.id, 'second', 'm')).toBe(false);
    expect(await snapshots.failSummary(s.id, 'late failure')).toBe(false);
    expect((await snapshots.findById(s.id))?.summary).toBe('first');
  });
});
