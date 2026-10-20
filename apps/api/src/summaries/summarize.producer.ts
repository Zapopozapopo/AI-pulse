import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { JOBS, QUEUES, summarizeDedupId, SummarizeJobData } from '../queue/queue.constants';

@Injectable()
export class SummarizeProducer {
  constructor(
    @InjectQueue(QUEUES.summarize) private readonly queue: Queue<SummarizeJobData>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Idempotent: one live job per snapshot, however many times this is called. */
  async enqueue(snapshotId: string): Promise<void> {
    await this.enqueueMany([snapshotId]);
  }

  /** One Redis round trip for any number of snapshots (used by the reconciler). */
  async enqueueMany(snapshotIds: string[]): Promise<void> {
    if (snapshotIds.length === 0) return;
    await this.queue.addBulk(
      snapshotIds.map((snapshotId) => ({
        name: JOBS.summarize,
        data: { snapshotId },
        opts: {
          deduplication: { id: summarizeDedupId(snapshotId) },
          attempts: this.config.llm.maxAttempts,
          // 5s, 10s, 20s, 40s... rides out provider hiccups without hammering it.
          backoff: { type: 'exponential' as const, delay: 5000 },
        },
      })),
    );
  }
}
