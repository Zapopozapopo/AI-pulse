import { SummaryStatus, type Competitor, type Snapshot } from '@prisma/client';
import { InvalidStateError, NotFoundError, ValidationError } from '../common/errors';
import type { CompetitorsRepository } from '../competitors/competitors.repository';
import type { SummarizeProducer } from '../summaries/summarize.producer';
import type { SnapshotsRepository } from './snapshots.repository';
import { SnapshotsService } from './snapshots.service';

const snap = (overrides: Partial<Snapshot> = {}) =>
  ({ id: 5n, competitorId: 'acme-crm', fetchedAt: new Date('2026-01-01'), summaryStatus: SummaryStatus.failed, ...overrides }) as Snapshot;

function setup({ tracked = true, cursor = snap() as Snapshot | null } = {}) {
  const snapshots = {
    findById: jest.fn().mockResolvedValue(cursor),
    listForCompetitor: jest.fn().mockResolvedValue([]),
    resetFailedSummary: jest.fn().mockResolvedValue(true),
  };
  const competitors = { findActive: jest.fn().mockResolvedValue(tracked ? ({ id: 'acme-crm' } as Competitor) : null) };
  const producer = { enqueue: jest.fn() };
  const service = new SnapshotsService(
    snapshots as unknown as SnapshotsRepository,
    competitors as unknown as CompetitorsRepository,
    producer as unknown as SummarizeProducer,
  );
  return { service, snapshots, producer };
}

describe('SnapshotsService.listForCompetitor', () => {
  it('returns the complete history when no limit is given', async () => {
    const { service, snapshots } = setup();
    await service.listForCompetitor('acme-crm');
    expect(snapshots.listForCompetitor).toHaveBeenCalledWith('acme-crm', undefined);
  });

  it('404s for an untracked competitor', async () => {
    const { service } = setup({ tracked: false });
    await expect(service.listForCompetitor('acme-crm')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('pages from a cursor that belongs to the competitor', async () => {
    const cursor = snap();
    const { service, snapshots } = setup({ cursor });
    await service.listForCompetitor('acme-crm', 50, 5n);
    expect(snapshots.listForCompetitor).toHaveBeenCalledWith('acme-crm', 50, cursor);
  });

  it.each([
    ['unknown', null],
    ["another competitor's", snap({ competitorId: 'ferry-pay' })],
  ])('rejects an %s cursor', async (_label, cursor) => {
    const { service, snapshots } = setup({ cursor });
    await expect(service.listForCompetitor('acme-crm', 50, 5n)).rejects.toBeInstanceOf(ValidationError);
    expect(snapshots.listForCompetitor).not.toHaveBeenCalled();
  });
});

describe('SnapshotsService.retrySummary', () => {
  it('resets a failed summary and re-enqueues it', async () => {
    const { service, snapshots, producer } = setup();
    await service.retrySummary(5n);
    expect(snapshots.resetFailedSummary).toHaveBeenCalledWith(5n);
    expect(producer.enqueue).toHaveBeenCalledWith('5');
  });

  it('404s for an unknown snapshot', async () => {
    const { service } = setup({ cursor: null });
    await expect(service.retrySummary(5n)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s (and spends nothing) for a snapshot of an untracked competitor', async () => {
    const { service, snapshots, producer } = setup({ tracked: false });
    await expect(service.retrySummary(5n)).rejects.toBeInstanceOf(NotFoundError);
    expect(snapshots.resetFailedSummary).not.toHaveBeenCalled();
    expect(producer.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a snapshot whose summary is not failed', async () => {
    const { service, snapshots, producer } = setup();
    snapshots.resetFailedSummary.mockResolvedValue(false);
    await expect(service.retrySummary(5n)).rejects.toBeInstanceOf(InvalidStateError);
    expect(producer.enqueue).not.toHaveBeenCalled();
  });
});
