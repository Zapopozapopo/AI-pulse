import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { CompetitorsRepository } from '../competitors/competitors.repository';
import { LISTING_SOURCE, ListingSourceClient } from '../listing-source/listing-source.client';
import { diffListings, hashListing, LISTING_FIELDS, type Listing, normalizeListing, pickListing } from '../snapshots/listing';
import { SnapshotsRepository, StaleSnapshotPointerError } from '../snapshots/snapshots.repository';
import { SummarizeProducer } from '../summaries/summarize.producer';
import { PollProducer } from './poll.producer';

export type PollOutcome =
  | { status: 'skipped' }
  | { status: 'baseline' | 'unchanged' | 'changed'; snapshotId: bigint };

export interface FetchedListing {
  listing: Listing;
  fetchedAt: Date;
}

/**
 * The source is not idempotent (the stub advances on every fetch), so a fetch must happen at most
 * once per poll job: it is checkpointed before the write, and a retry of a failed write reuses it.
 */
export interface PollCheckpoint {
  /** Result of an earlier attempt's fetch: reuse it instead of advancing the source again. */
  fetched?: FetchedListing;
  /** Persists a fresh fetch before the snapshot is written. */
  save?: (fetched: FetchedListing) => Promise<void>;
}

/** Safety valve: a single tick never claims more than this many batches. */
const MAX_BATCHES_PER_TICK = 50;

@Injectable()
export class PollingService {
  private readonly logger = new Logger(PollingService.name);

  constructor(
    private readonly competitors: CompetitorsRepository,
    private readonly snapshots: SnapshotsRepository,
    private readonly pollProducer: PollProducer,
    private readonly summarizeProducer: SummarizeProducer,
    @Inject(LISTING_SOURCE) private readonly source: ListingSourceClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Scheduler tick: claim every due competitor (in batches) and fan out one poll job each. */
  async enqueueDuePolls(): Promise<number> {
    const { batchSize, intervalSeconds, jitterRatio } = this.config.polling;
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_TICK; batch++) {
      const ids = await this.competitors.claimDue(batchSize, intervalSeconds, jitterRatio);
      try {
        await this.pollProducer.enqueue(ids);
      } catch (error) {
        // Claim and enqueue can't be atomic (DB vs Redis): hand the claim back so these
        // competitors are retried on the next tick instead of silently skipping a whole interval.
        await this.competitors.releaseClaims(ids);
        throw error;
      }
      total += ids.length;
      if (ids.length < batchSize) break;
    }
    if (total) this.logger.log(`Enqueued ${total} poll job(s)`);
    return total;
  }

  /**
   * Fetch -> normalize -> hash -> compare with the stored hash of the latest snapshot.
   * Every fetch is persisted. The LLM is never called here: a change only enqueues a
   * summarize job after the snapshot is committed, so a slow/failing LLM can't lose it.
   */
  async pollCompetitor(competitorId: string, checkpoint: PollCheckpoint = {}): Promise<PollOutcome> {
    const competitor = await this.competitors.findActive(competitorId);
    if (!competitor) return { status: 'skipped' };

    // Store exactly what was fetched; normalize only for comparison, so whitespace noise
    // doesn't count as a change but the stored history keeps the original formatting.
    const { listing, fetchedAt } = checkpoint.fetched ?? (await this.fetchOnce(competitorId, checkpoint));
    const normalized = normalizeListing(listing);
    const contentHash = hashListing(normalized);

    const isBaseline = competitor.lastSnapshotId === null;
    const changed = !isBaseline && contentHash !== competitor.lastContentHash;

    // Only a real change costs an extra read (the previous fields, to compute the diff).
    let changedFields: string[] = [];
    if (changed) {
      const previous = await this.snapshots.findById(competitor.lastSnapshotId!);
      changedFields = previous ? diffListings(normalizeListing(previous), normalized) : [...LISTING_FIELDS];
    }

    let snapshot;
    try {
      snapshot = await this.snapshots.appendSnapshot({
        competitorId,
        fetchedAt,
        listing: pickListing(listing),
        contentHash,
        previousSnapshotId: competitor.lastSnapshotId,
        previousContentHash: competitor.lastContentHash,
        changed,
        changedFields,
      });
    } catch (error) {
      // Removed while we were fetching: drop the result quietly. Otherwise let the job retry
      // (with the checkpointed listing, compared against the then-current pointer).
      if (error instanceof StaleSnapshotPointerError && !(await this.competitors.findActive(competitorId))) {
        return { status: 'skipped' };
      }
      throw error;
    }

    if (changed) {
      // If this enqueue fails the reconciler picks the pending snapshot up later.
      await this.summarizeProducer.enqueue(snapshot.id.toString()).catch((error: unknown) => {
        this.logger.error(`Could not enqueue summary for snapshot ${snapshot.id}: ${String(error)}`);
      });
    }
    return { status: isBaseline ? 'baseline' : changed ? 'changed' : 'unchanged', snapshotId: snapshot.id };
  }

  private async fetchOnce(competitorId: string, checkpoint: PollCheckpoint): Promise<FetchedListing> {
    const fetchedAt = new Date();
    const fetched = { listing: await this.source.fetchListing(competitorId), fetchedAt };
    // Best effort: failing here would make the job retry and fetch again, which is exactly the
    // version skip the checkpoint exists to prevent. Without it only a failed write refetches.
    await checkpoint.save?.(fetched).catch((error: unknown) => {
      this.logger.warn(`Could not checkpoint the fetch of ${competitorId}: ${String(error)}`);
    });
    return fetched;
  }

  async recordFailure(competitorId: string, error: string): Promise<void> {
    await this.competitors.recordPollFailure(competitorId, error, this.config.polling.intervalSeconds);
  }
}
