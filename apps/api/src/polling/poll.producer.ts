import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { JOBS, pollDedupId, PollJobData, QUEUES } from '../queue/queue.constants';

@Injectable()
export class PollProducer {
  constructor(
    @InjectQueue(QUEUES.poll) private readonly queue: Queue<PollJobData>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Deduplicated per competitor while a poll is waiting or running: polls of one competitor
   * are serialized (no two jobs comparing against the same "previous" snapshot) and a slow
   * source can't pile up duplicate jobs across ticks.
   */
  async enqueue(competitorIds: string[]): Promise<void> {
    if (competitorIds.length === 0) return;
    await this.queue.addBulk(
      competitorIds.map((competitorId) => ({
        name: JOBS.poll,
        data: { competitorId },
        opts: {
          deduplication: { id: pollDedupId(competitorId) },
          attempts: this.config.polling.maxAttempts,
          backoff: { type: 'exponential', delay: 1000 },
        },
      })),
    );
  }
}
