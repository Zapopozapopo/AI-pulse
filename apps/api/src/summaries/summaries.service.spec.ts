import { SummaryStatus, type Snapshot } from '@prisma/client';
import type { AppConfig } from '../config/app-config';
import type { CompetitorsRepository } from '../competitors/competitors.repository';
import type { LlmProvider } from '../llm/llm.provider';
import type { SnapshotsRepository } from '../snapshots/snapshots.repository';
import type { SummarizeProducer } from './summarize.producer';
import { SummariesService } from './summaries.service';

const base = { title: 'Acme CRM', tagline: 'Simple CRM', price: '$29/mo', description: 'Track leads.' };

function snapshot(overrides: Partial<Snapshot>): Snapshot {
  return {
    id: 2n,
    competitorId: 'acme-crm',
    fetchedAt: new Date(),
    ...base,
    contentHash: 'h2',
    previousSnapshotId: 1n,
    previousContentHash: 'h1',
    changed: true,
    changedFields: ['price'],
    summary: null,
    summaryStatus: SummaryStatus.pending,
    summaryError: null,
    summaryAttempts: 0,
    summarizedAt: null,
    llmModel: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function setup(current: Snapshot | null) {
  const previous = snapshot({ id: 1n, price: '$19/mo', summaryStatus: SummaryStatus.none });
  const snapshots = {
    findById: jest.fn(async (id: bigint) => (id === 1n ? previous : current)),
    findCachedSummary: jest.fn().mockResolvedValue(null),
    incrementSummaryAttempts: jest.fn(),
    completeSummary: jest.fn().mockResolvedValue(true),
    failSummary: jest.fn().mockResolvedValue(true),
    findStalePending: jest.fn().mockResolvedValue([]),
  };
  const competitors = { findActive: jest.fn().mockResolvedValue({ id: 'acme-crm' }) };
  const producer = { enqueue: jest.fn(), enqueueMany: jest.fn() };
  const llm = { summarizeChange: jest.fn().mockResolvedValue({ text: 'Price rose.', model: 'mock-llm' }) };
  const config = { reconcile: { pendingAfterSeconds: 120 } } as AppConfig;
  const service = new SummariesService(
    snapshots as unknown as SnapshotsRepository,
    competitors as unknown as CompetitorsRepository,
    producer as unknown as SummarizeProducer,
    llm as LlmProvider,
    config,
  );
  return { service, snapshots, competitors, producer, llm, previous };
}

describe('SummariesService', () => {
  it('calls the LLM with previous, current and changed fields and stores the summary', async () => {
    const current = snapshot({});
    const { service, snapshots, llm, previous } = setup(current);

    await expect(service.summarize(2n)).resolves.toBe('completed');
    expect(llm.summarizeChange).toHaveBeenCalledWith({
      competitorId: 'acme-crm',
      previous: { title: previous.title, tagline: previous.tagline, price: '$19/mo', description: previous.description },
      current: { title: current.title, tagline: current.tagline, price: '$29/mo', description: current.description },
      changedFields: ['price'],
    });
    expect(snapshots.completeSummary).toHaveBeenCalledWith(2n, 'Price rose.', 'mock-llm');
  });

  it('reuses a cached summary for the same content transition without calling the LLM', async () => {
    const { service, snapshots, llm } = setup(snapshot({}));
    snapshots.findCachedSummary.mockResolvedValue({ summary: 'Cached.', llmModel: 'mock-llm' });

    await expect(service.summarize(2n)).resolves.toBe('cached');
    expect(snapshots.findCachedSummary).toHaveBeenCalledWith('acme-crm', 'h1', 'h2');
    expect(llm.summarizeChange).not.toHaveBeenCalled();
    expect(snapshots.completeSummary).toHaveBeenCalledWith(2n, 'Cached.', 'mock-llm');
  });

  it.each([SummaryStatus.completed, SummaryStatus.failed, SummaryStatus.none])(
    'is idempotent: does nothing for a %s snapshot',
    async (summaryStatus) => {
      const { service, llm, snapshots } = setup(snapshot({ summaryStatus }));
      await expect(service.summarize(2n)).resolves.toBe('skipped');
      expect(llm.summarizeChange).not.toHaveBeenCalled();
      expect(snapshots.completeSummary).not.toHaveBeenCalled();
    },
  );

  it('makes no LLM call for a removed competitor and leaves the summary pending for re-tracking', async () => {
    const { service, snapshots, competitors, llm } = setup(snapshot({}));
    competitors.findActive.mockResolvedValue(null);

    await expect(service.summarize(2n)).resolves.toBe('skipped');
    expect(competitors.findActive).toHaveBeenCalledWith('acme-crm');
    expect(snapshots.findCachedSummary).not.toHaveBeenCalled();
    expect(llm.summarizeChange).not.toHaveBeenCalled();
    expect(snapshots.completeSummary).not.toHaveBeenCalled();
    expect(snapshots.failSummary).not.toHaveBeenCalled();
  });

  it('propagates LLM errors (so the queue retries) without touching the snapshot', async () => {
    const { service, llm, snapshots } = setup(snapshot({}));
    llm.summarizeChange.mockRejectedValue(new Error('timeout'));

    await expect(service.summarize(2n)).rejects.toThrow('timeout');
    expect(snapshots.completeSummary).not.toHaveBeenCalled();
    expect(snapshots.failSummary).not.toHaveBeenCalled();
  });

  it('re-enqueues summaries stuck in pending', async () => {
    const { service, snapshots, producer } = setup(null);
    snapshots.findStalePending.mockResolvedValue([5n, 7n]);

    await expect(service.reconcileStuckSummaries()).resolves.toBe(2);
    expect(producer.enqueueMany).toHaveBeenCalledTimes(1);
    expect(producer.enqueueMany).toHaveBeenCalledWith(['5', '7']);
  });

  it('resolves a pending snapshot that has no previous one instead of leaving it pending forever', async () => {
    const { service, snapshots, llm } = setup(snapshot({ previousSnapshotId: null }));

    await expect(service.summarize(2n)).resolves.toBe('skipped');
    expect(snapshots.failSummary).toHaveBeenCalledWith(2n, expect.stringMatching(/No previous snapshot/));
    expect(llm.summarizeChange).not.toHaveBeenCalled();
  });
});
