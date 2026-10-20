import { Injectable } from '@nestjs/common';
import { Snapshot, SummaryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { Listing } from './listing';

export interface AppendSnapshotInput {
  competitorId: string;
  fetchedAt: Date;
  listing: Listing;
  contentHash: string;
  /** The pointer the caller compared against; the write fails if it moved meanwhile. */
  previousSnapshotId: bigint | null;
  previousContentHash: string | null;
  changed: boolean;
  changedFields: string[];
}

/** Snapshot was not appended because the competitor's latest-snapshot pointer moved (or it was removed). */
export class StaleSnapshotPointerError extends Error {
  constructor(competitorId: string) {
    super(`Latest snapshot of "${competitorId}" changed concurrently or competitor was removed`);
    this.name = 'StaleSnapshotPointerError';
  }
}

@Injectable()
export class SnapshotsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: bigint): Promise<Snapshot | null> {
    return this.prisma.snapshot.findUnique({ where: { id } });
  }

  /**
   * Newest first. Explicit keyset pagination on (fetched_at, id), served by snapshots_timeline_idx:
   * rows strictly older than the cursor row in that ordering. No limit = complete history.
   */
  listForCompetitor(
    competitorId: string,
    limit?: number,
    cursor?: Pick<Snapshot, 'id' | 'fetchedAt'>,
  ): Promise<Snapshot[]> {
    return this.prisma.snapshot.findMany({
      where: {
        competitorId,
        ...(cursor && {
          OR: [{ fetchedAt: { lt: cursor.fetchedAt } }, { fetchedAt: cursor.fetchedAt, id: { lt: cursor.id } }],
        }),
      },
      orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  /**
   * Inserts the snapshot and advances the competitor's latest-snapshot pointer in ONE
   * transaction. The pointer update is a compare-and-set on the previous snapshot id
   * (optimistic concurrency): if anything else appended in between, or the competitor was
   * removed, nothing is written and StaleSnapshotPointerError is thrown.
   * The summary is NOT part of this transaction: the snapshot is durable before any LLM call.
   */
  appendSnapshot(input: AppendSnapshotInput): Promise<Snapshot> {
    return this.prisma.$transaction(async (tx) => {
      const snapshot = await tx.snapshot.create({
        data: {
          competitorId: input.competitorId,
          fetchedAt: input.fetchedAt,
          ...input.listing,
          contentHash: input.contentHash,
          previousSnapshotId: input.previousSnapshotId,
          previousContentHash: input.previousContentHash,
          changed: input.changed,
          changedFields: input.changedFields,
          summaryStatus: input.changed ? SummaryStatus.pending : SummaryStatus.none,
        },
      });
      const { count } = await tx.competitor.updateMany({
        where: { id: input.competitorId, deletedAt: null, lastSnapshotId: input.previousSnapshotId },
        data: {
          lastSnapshotId: snapshot.id,
          lastContentHash: input.contentHash,
          lastPolledAt: input.fetchedAt,
          lastError: null,
          consecutiveFailures: 0,
        },
      });
      if (count !== 1) throw new StaleSnapshotPointerError(input.competitorId);
      return snapshot;
    });
  }

  /**
   * Summary cache lookup: a completed summary for the exact same content transition of the
   * SAME competitor (summaries may name the competitor, so they are not shared across ids).
   */
  findCachedSummary(competitorId: string, previousContentHash: string, contentHash: string) {
    return this.prisma.snapshot.findFirst({
      where: { competitorId, previousContentHash, contentHash, summaryStatus: SummaryStatus.completed },
      select: { summary: true, llmModel: true },
    });
  }

  async incrementSummaryAttempts(id: bigint): Promise<void> {
    await this.prisma.snapshot.update({ where: { id }, data: { summaryAttempts: { increment: 1 } } });
  }

  /** Conditional on `pending`, so retries/duplicates can't overwrite a finished summary. */
  async completeSummary(id: bigint, summary: string, llmModel: string): Promise<boolean> {
    const { count } = await this.prisma.snapshot.updateMany({
      where: { id, summaryStatus: SummaryStatus.pending },
      data: {
        summary,
        llmModel,
        summaryStatus: SummaryStatus.completed,
        summaryError: null,
        summarizedAt: new Date(),
      },
    });
    return count === 1;
  }

  async failSummary(id: bigint, error: string): Promise<boolean> {
    const { count } = await this.prisma.snapshot.updateMany({
      where: { id, summaryStatus: SummaryStatus.pending },
      data: { summaryStatus: SummaryStatus.failed, summaryError: error.slice(0, 1000) },
    });
    return count === 1;
  }

  async resetFailedSummary(id: bigint): Promise<boolean> {
    const { count } = await this.prisma.snapshot.updateMany({
      where: { id, summaryStatus: SummaryStatus.failed },
      data: { summaryStatus: SummaryStatus.pending, summaryError: null, summaryAttempts: 0 },
    });
    return count === 1;
  }

  /** Stuck pending summaries of tracked competitors (removed ones wait until they are re-tracked). */
  async findStalePending(olderThan: Date, limit: number): Promise<bigint[]> {
    const rows = await this.prisma.snapshot.findMany({
      where: { summaryStatus: SummaryStatus.pending, createdAt: { lt: olderThan }, competitor: { deletedAt: null } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }
}
