import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { JOBS, QUEUES } from '../queue/queue.constants';
import { SummariesService } from '../summaries/summaries.service';
import { PollingService } from './polling.service';

/**
 * Repeatable jobs instead of setInterval: BullMQ job schedulers live in Redis, so with N
 * worker replicas each tick still runs exactly once (no duplicate polling, no leader election).
 */
@Processor(QUEUES.scheduler, { concurrency: 1 })
export class SchedulerProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(SchedulerProcessor.name);

  constructor(
    @InjectQueue(QUEUES.scheduler) private readonly queue: Queue,
    private readonly polling: PollingService,
    private readonly summaries: SummariesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    const { tickSeconds, intervalSeconds } = this.config.polling;
    // Upsert = idempotent across restarts and replicas; changing the env updates the schedule.
    await this.queue.upsertJobScheduler(JOBS.tick, { every: tickSeconds * 1000 }, { name: JOBS.tick });
    await this.queue.upsertJobScheduler(
      JOBS.reconcile,
      { every: this.config.reconcile.intervalSeconds * 1000 },
      { name: JOBS.reconcile },
    );
    this.logger.log(`Scheduler tick every ${tickSeconds}s; each competitor polled every ~${intervalSeconds}s`);
  }

  async process(job: Job): Promise<number> {
    switch (job.name) {
      case JOBS.tick:
        return this.polling.enqueueDuePolls();
      case JOBS.reconcile:
        return this.summaries.reconcileStuckSummaries();
      default:
        throw new Error(`Unknown scheduler job "${job.name}"`);
    }
  }
}
