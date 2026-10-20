import { Injectable } from '@nestjs/common';
import type { Snapshot } from '@prisma/client';
import { InvalidStateError, NotFoundError, ValidationError } from '../common/errors';
import { CompetitorsRepository } from '../competitors/competitors.repository';
import { SummarizeProducer } from '../summaries/summarize.producer';
import { SnapshotsRepository } from './snapshots.repository';

@Injectable()
export class SnapshotsService {
  constructor(
    private readonly snapshots: SnapshotsRepository,
    private readonly competitors: CompetitorsRepository,
    private readonly summarizeProducer: SummarizeProducer,
  ) {}

  async listForCompetitor(competitorId: string, limit?: number, before?: bigint): Promise<Snapshot[]> {
    await this.requireTracked(competitorId);
    if (before === undefined) return this.snapshots.listForCompetitor(competitorId, limit);

    // The cursor must be a snapshot of THIS competitor, otherwise the keyset would point
    // into someone else's timeline and silently return a wrong page.
    const cursor = await this.snapshots.findById(before);
    if (!cursor || cursor.competitorId !== competitorId) {
      throw new ValidationError(`Unknown cursor ${before} for competitor "${competitorId}"`);
    }
    return this.snapshots.listForCompetitor(competitorId, limit, cursor);
  }

  /** Manual retry for a summary that exhausted its automatic retries. */
  async retrySummary(snapshotId: bigint): Promise<void> {
    const snapshot = await this.snapshots.findById(snapshotId);
    if (!snapshot) throw new NotFoundError(`Snapshot ${snapshotId} not found`);
    // Same "not tracked = 404" rule as the timeline: no paid LLM calls for removed competitors.
    await this.requireTracked(snapshot.competitorId);
    if (!(await this.snapshots.resetFailedSummary(snapshotId))) {
      throw new InvalidStateError(`Snapshot ${snapshotId} has no failed summary to retry`);
    }
    await this.summarizeProducer.enqueue(snapshotId.toString());
  }

  private async requireTracked(competitorId: string): Promise<void> {
    if (!(await this.competitors.findActive(competitorId))) {
      throw new NotFoundError(`Competitor "${competitorId}" is not tracked`);
    }
  }
}
