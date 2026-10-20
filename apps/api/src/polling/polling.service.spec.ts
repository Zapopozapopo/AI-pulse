import type { Competitor, Snapshot } from '@prisma/client';
import type { AppConfig } from '../config/app-config';
import type { CompetitorsRepository } from '../competitors/competitors.repository';
import type { ListingSourceClient } from '../listing-source/listing-source.client';
import { hashListing, type Listing } from '../snapshots/listing';
import { StaleSnapshotPointerError, type SnapshotsRepository } from '../snapshots/snapshots.repository';
import type { SummarizeProducer } from '../summaries/summarize.producer';
import type { PollProducer } from './poll.producer';
import { PollingService } from './polling.service';

const v1: Listing = { title: 'Acme CRM', tagline: 'Simple CRM', price: '$29/mo', description: 'Track leads.' };
const v2: Listing = { ...v1, price: '$39/mo' };

const config = { polling: { batchSize: 2, intervalSeconds: 900, jitterRatio: 0.1 } } as AppConfig;

function competitor(overrides: Partial<Competitor> = {}): Competitor {
  return {
    id: 'acme-crm',
    createdAt: new Date(),
    deletedAt: null,
    nextPollAt: new Date(),
    lastPolledAt: null,
    lastSnapshotId: null,
    lastContentHash: null,
    lastError: null,
    consecutiveFailures: 0,
    ...overrides,
  };
}

function setup(current: Competitor | null, fetched: Listing, previous?: Listing) {
  const competitors = {
    findActive: jest.fn().mockResolvedValue(current),
    claimDue: jest.fn(),
    releaseClaims: jest.fn(),
    recordPollFailure: jest.fn(),
  };
  const snapshots = {
    findById: jest.fn().mockResolvedValue(previous ? ({ ...previous, id: 1n } as Snapshot) : null),
    appendSnapshot: jest.fn().mockResolvedValue({ id: 2n } as Snapshot),
  };
  const pollProducer = { enqueue: jest.fn() };
  const summarizeProducer = { enqueue: jest.fn().mockResolvedValue(undefined) };
  const source: ListingSourceClient = { fetchListing: jest.fn().mockResolvedValue(fetched) };
  const service = new PollingService(
    competitors as unknown as CompetitorsRepository,
    snapshots as unknown as SnapshotsRepository,
    pollProducer as unknown as PollProducer,
    summarizeProducer as unknown as SummarizeProducer,
    source,
    config,
  );
  return { service, competitors, snapshots, pollProducer, summarizeProducer, source };
}

describe('PollingService.pollCompetitor', () => {
  it('stores the first snapshot as an unchanged baseline without asking for a summary', async () => {
    const { service, snapshots, summarizeProducer } = setup(competitor(), v1);

    await expect(service.pollCompetitor('acme-crm')).resolves.toMatchObject({ status: 'baseline' });
    expect(snapshots.appendSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ changed: false, previousSnapshotId: null, changedFields: [] }),
    );
    expect(summarizeProducer.enqueue).not.toHaveBeenCalled();
  });

  it('treats whitespace noise as unchanged but stores the raw fetched text', async () => {
    const raw = { ...v1, description: 'Track\n\nleads. ' };
    const { service, snapshots, summarizeProducer } = setup(
      competitor({ lastSnapshotId: 1n, lastContentHash: hashListing(v1) }),
      raw,
    );

    await expect(service.pollCompetitor('acme-crm')).resolves.toMatchObject({ status: 'unchanged' });
    expect(snapshots.findById).not.toHaveBeenCalled();
    expect(snapshots.appendSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ changed: false, listing: raw, contentHash: hashListing(v1) }),
    );
    expect(summarizeProducer.enqueue).not.toHaveBeenCalled();
  });

  it('ignores whitespace-only differences when listing the changed fields', async () => {
    const { service, snapshots } = setup(
      competitor({ lastSnapshotId: 1n, lastContentHash: hashListing(v1) }),
      { ...v2, description: ' Track   leads.' },
      v1,
    );

    await service.pollCompetitor('acme-crm');
    expect(snapshots.appendSnapshot).toHaveBeenCalledWith(expect.objectContaining({ changedFields: ['price'] }));
  });

  it('persists a changed snapshot with its diff and enqueues a summary after the write', async () => {
    const { service, snapshots, summarizeProducer } = setup(
      competitor({ lastSnapshotId: 1n, lastContentHash: hashListing(v1) }),
      v2,
      v1,
    );

    await expect(service.pollCompetitor('acme-crm')).resolves.toEqual({ status: 'changed', snapshotId: 2n });
    expect(snapshots.appendSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ changed: true, changedFields: ['price'], previousSnapshotId: 1n }),
    );
    expect(summarizeProducer.enqueue).toHaveBeenCalledWith('2');
    expect(snapshots.appendSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
      summarizeProducer.enqueue.mock.invocationCallOrder[0],
    );
  });

  it('keeps the snapshot when enqueueing the summary fails (the reconciler retries later)', async () => {
    const { service, summarizeProducer } = setup(
      competitor({ lastSnapshotId: 1n, lastContentHash: hashListing(v1) }),
      v2,
      v1,
    );
    summarizeProducer.enqueue.mockRejectedValue(new Error('redis down'));

    await expect(service.pollCompetitor('acme-crm')).resolves.toMatchObject({ status: 'changed' });
  });

  it('skips competitors that are no longer tracked', async () => {
    const { service, snapshots } = setup(null, v1);
    await expect(service.pollCompetitor('acme-crm')).resolves.toEqual({ status: 'skipped' });
    expect(snapshots.appendSnapshot).not.toHaveBeenCalled();
  });

  it('drops the result if the competitor was removed while fetching', async () => {
    const { service, competitors, snapshots } = setup(competitor(), v1);
    snapshots.appendSnapshot.mockRejectedValue(new StaleSnapshotPointerError('acme-crm'));
    competitors.findActive.mockResolvedValueOnce(competitor()).mockResolvedValueOnce(null);

    await expect(service.pollCompetitor('acme-crm')).resolves.toEqual({ status: 'skipped' });
  });

  it('rethrows a concurrent append for a still-tracked competitor so the job retries', async () => {
    const { service, snapshots } = setup(competitor(), v1);
    snapshots.appendSnapshot.mockRejectedValue(new StaleSnapshotPointerError('acme-crm'));

    await expect(service.pollCompetitor('acme-crm')).rejects.toBeInstanceOf(StaleSnapshotPointerError);
  });

  it('checkpoints a fresh fetch before writing the snapshot', async () => {
    const { service, snapshots, source } = setup(competitor(), v1);
    const save = jest.fn().mockResolvedValue(undefined);

    await service.pollCompetitor('acme-crm', { save });
    expect(save).toHaveBeenCalledWith({ listing: v1, fetchedAt: expect.any(Date) });
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(snapshots.appendSnapshot.mock.invocationCallOrder[0]);
    expect(source.fetchListing).toHaveBeenCalledTimes(1);
  });

  it('reuses a checkpointed fetch on retry instead of advancing the source again', async () => {
    const { service, snapshots, source } = setup(
      competitor({ lastSnapshotId: 1n, lastContentHash: hashListing(v1) }),
      v1,
      v1,
    );
    const fetchedAt = new Date('2026-09-10T12:00:00Z');
    const save = jest.fn();

    await expect(service.pollCompetitor('acme-crm', { fetched: { listing: v2, fetchedAt }, save })).resolves.toMatchObject(
      { status: 'changed' },
    );
    expect(source.fetchListing).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(snapshots.appendSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ fetchedAt, listing: v2, changedFields: ['price'] }),
    );
  });

  it('still persists the snapshot when the checkpoint cannot be saved', async () => {
    const { service, snapshots } = setup(competitor(), v1);
    const save = jest.fn().mockRejectedValue(new Error('redis down'));

    await expect(service.pollCompetitor('acme-crm', { save })).resolves.toMatchObject({ status: 'baseline' });
    expect(snapshots.appendSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('PollingService.enqueueDuePolls', () => {
  it('keeps claiming batches until a partial batch comes back', async () => {
    const { service, competitors, pollProducer } = setup(null, v1);
    competitors.claimDue.mockResolvedValueOnce(['a', 'b']).mockResolvedValueOnce(['c']);

    await expect(service.enqueueDuePolls()).resolves.toBe(3);
    expect(competitors.claimDue).toHaveBeenCalledTimes(2);
    expect(pollProducer.enqueue).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(pollProducer.enqueue).toHaveBeenNthCalledWith(2, ['c']);
  });

  it('hands claims back when enqueueing fails, so no polling cycle is skipped', async () => {
    const { service, competitors, pollProducer } = setup(null, v1);
    competitors.claimDue.mockResolvedValueOnce(['a', 'b']);
    pollProducer.enqueue.mockRejectedValue(new Error('redis down'));

    await expect(service.enqueueDuePolls()).rejects.toThrow('redis down');
    expect(competitors.releaseClaims).toHaveBeenCalledWith(['a', 'b']);
  });
});
