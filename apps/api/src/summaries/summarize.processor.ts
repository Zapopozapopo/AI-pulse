import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { loadConfig } from '../config/app-config';
import { LlmRequestError } from '../llm/llm.errors';
import { QUEUES, SummarizeJobData } from '../queue/queue.constants';
import { SummariesService } from './summaries.service';

const { llm } = loadConfig();

/**
 * LLM calls are billed and slow: bounded concurrency plus a queue-level rate limit
 * (shared by all worker replicas through Redis) caps spend and protects provider quotas.
 */
@Processor(QUEUES.summarize, {
  concurrency: llm.concurrency,
  limiter: { max: llm.ratePerSecond, duration: 1000 },
})
export class SummarizeProcessor extends WorkerHost {
  private readonly logger = new Logger(SummarizeProcessor.name);

  constructor(private readonly summaries: SummariesService) {
    super();
  }

  async process(job: Job<SummarizeJobData>): Promise<string> {
    const snapshotId = BigInt(job.data.snapshotId);
    try {
      const outcome = await this.summaries.summarize(snapshotId);
      this.logger.log(`Snapshot ${snapshotId}: summary ${outcome}`);
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permanent = error instanceof LlmRequestError && !error.retryable;
      const attempt = job.attemptsMade + 1;
      const maxAttempts = job.opts.attempts ?? 1;
      this.logger.warn(`Snapshot ${snapshotId}: summary attempt ${attempt}/${maxAttempts} failed: ${message}`);
      if (permanent || attempt >= maxAttempts) {
        // Never let bookkeeping failures replace the real error (or its retry semantics).
        await this.summaries.markFailed(snapshotId, message).catch((markError: unknown) => {
          this.logger.error(`Could not mark snapshot ${snapshotId} failed: ${String(markError)}`);
        });
      }
      // A 401/400 won't fix itself: fail now instead of burning retries and rate-limit slots.
      throw permanent ? new UnrecoverableError(message) : error;
    }
  }
}
