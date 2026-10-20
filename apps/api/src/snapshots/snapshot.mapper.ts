import type { ListingField, Snapshot as SnapshotResponse } from '@competitor-pulse/contracts';
import { Snapshot, SummaryStatus } from '@prisma/client';

export const toSnapshotResponse = (s: Snapshot): SnapshotResponse => ({
  fetchedAt: s.fetchedAt.toISOString(),
  title: s.title,
  tagline: s.tagline,
  price: s.price,
  description: s.description,
  changed: s.changed,
  // Contract: null if unchanged, pending, or failed.
  summary: s.summaryStatus === SummaryStatus.completed ? s.summary : null,
  id: s.id.toString(),
  summaryStatus: s.summaryStatus,
  changedFields: s.changedFields as ListingField[],
  isBaseline: s.previousSnapshotId === null,
});
