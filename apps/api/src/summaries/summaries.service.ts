import { Inject, Injectable, Logger } from '@nestjs/common';
import { SummaryStatus } from '@prisma/client';
import type { ListingField } from '@competitor-pulse/contracts';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { CompetitorsRepository } from '../competitors/competitors.repository';
import { LLM_PROVIDER, LlmProvider } from '../llm/llm.provider';
import { diffListings, normalizeListing, pickListing } from '../snapshots/listing';
import { SnapshotsRepository } from '../snapshots/snapshots.repository';
import { SummarizeProducer } from './summarize.producer';

export type SummarizeOutcome = 'completed' | 'cached' | 'skipped';

@Injectable()
export class SummariesService {
  private readonly logger = new Logger(SummariesService.name);

  constructor(
    private readonly snapshots: SnapshotsRepository,
    private readonly competitors: CompetitorsRepository,
    private readonly producer: SummarizeProducer,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Generates and stores the change summary of one snapshot. Safe to run more than once
   * (at-least-once delivery): it no-ops unless the snapshot is still `pending`, and the
   * final write is conditional on `pending` too. Throws on LLM errors so the queue retries.
   */
  async summarize(snapshotId: bigint): Promise<SummarizeOutcome> {
    const snapshot = await this.snapshots.findById(snapshotId);
    if (!snapshot || snapshot.summaryStatus !== SummaryStatus.pending) return 'skipped';
    // No paid LLM calls for removed competitors. The summary stays pending, so re-tracking
    // the competitor resumes it through the reconciler, just like the rest of its timeline.
    if (!(await this.competitors.findActive(snapshot.competitorId))) return 'skipped';
    if (!snapshot.previousSnapshotId) {
      // Nothing to compare against: resolve it, otherwise the reconciler would re-enqueue it forever.
      await this.snapshots.failSummary(snapshotId, 'No previous snapshot to compare against');
      return 'skipped';
    }

    // Same content transition seen before (e.g. a page flip-flopping between A/B variants):
    // reuse that summary instead of paying for another LLM call.
    if (snapshot.previousContentHash) {
      const cached = await this.snapshots.findCachedSummary(
        snapshot.competitorId,
        snapshot.previousContentHash,
        snapshot.contentHash,
      );
      if (cached?.summary) {
        await this.snapshots.completeSummary(snapshotId, cached.summary, cached.llmModel ?? 'cache');
        return 'cached';
      }
    }

    const previous = await this.snapshots.findById(snapshot.previousSnapshotId);
    if (!previous) {
      await this.snapshots.failSummary(snapshotId, 'Previous snapshot no longer exists');
      return 'skipped';
    }

    await this.snapshots.incrementSummaryAttempts(snapshotId);
    const changedFields = snapshot.changedFields.length
      ? (snapshot.changedFields as ListingField[])
      : diffListings(normalizeListing(previous), normalizeListing(snapshot));
    const result = await this.llm.summarizeChange({
      competitorId: snapshot.competitorId,
      previous: pickListing(previous),
      current: pickListing(snapshot),
      changedFields,
    });
    await this.snapshots.completeSummary(snapshotId, result.text, result.model);
    return 'completed';
  }

  /** Called once all automatic retries are exhausted; the snapshot itself is untouched. */
  async markFailed(snapshotId: bigint, error: string): Promise<void> {
    await this.snapshots.failSummary(snapshotId, error);
  }

  /**
   * Outbox-style safety net. The summarize job is enqueued after the snapshot commits, so a
   * crash or Redis outage in between would leave it `pending` forever. Re-enqueueing is safe
   * because jobs are deduplicated per snapshot and the handler is idempotent.
   */
  async reconcileStuckSummaries(): Promise<number> {
    const olderThan = new Date(Date.now() - this.config.reconcile.pendingAfterSeconds * 1000);
    const ids = await this.snapshots.findStalePending(olderThan, 500);
    await this.producer.enqueueMany(ids.map(String));
    if (ids.length) this.logger.warn(`Re-enqueued ${ids.length} stuck pending summaries`);
    return ids.length;
  }
}
