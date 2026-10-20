import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { loadConfig } from '../config/app-config';
import { ListingNotFoundError } from '../listing-source/listing-source.client';
import { PollJobData, QUEUES } from '../queue/queue.constants';
import { PollingService } from './polling.service';

@Processor(QUEUES.poll, { concurrency: loadConfig().polling.concurrency })
export class PollProcessor extends WorkerHost {
  private readonly logger = new Logger(PollProcessor.name);

  constructor(private readonly polling: PollingService) {
    super();
  }

  async process(job: Job<PollJobData>): Promise<string> {
    const { competitorId, fetched } = job.data;
    try {
      const outcome = await this.polling.pollCompetitor(competitorId, {
        fetched: fetched && { listing: fetched.listing, fetchedAt: new Date(fetched.fetchedAt) },
        save: (result) =>
          job.updateData({
            competitorId,
            fetched: { listing: result.listing, fetchedAt: result.fetchedAt.toISOString() },
          }),
      });
      this.logger.log(`Polled ${competitorId}: ${outcome.status}`);
      return outcome.status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof ListingNotFoundError;
      const finalAttempt = permanent || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      this.logger.warn(`Poll of ${competitorId} failed (attempt ${job.attemptsMade + 1}): ${message}`);
      if (finalAttempt) {
        // Never let bookkeeping failures replace the real error (or its retry semantics).
        await this.polling.recordFailure(competitorId, message).catch((recordError: unknown) => {
          this.logger.error(`Could not record poll failure for ${competitorId}: ${String(recordError)}`);
        });
      }
      // UnrecoverableError tells BullMQ not to spend retries on an id the source doesn't know.
      throw permanent ? new UnrecoverableError(message) : error;
    }
  }
}
