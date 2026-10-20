import { Module } from '@nestjs/common';
import { loggerModule } from './common/logger';
import { CompetitorsModule } from './competitors/competitors.module';
import { ConfigModule } from './config/config.module';
import { ListingSourceModule } from './listing-source/listing-source.module';
import { LlmModule } from './llm/llm.module';
import { PollProcessor } from './polling/poll.processor';
import { PollingModule } from './polling/polling.module';
import { PollingService } from './polling/polling.service';
import { SchedulerProcessor } from './polling/scheduler.processor';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { SnapshotsModule } from './snapshots/snapshots.module';
import { SummariesModule } from './summaries/summaries.module';
import { SummariesService } from './summaries/summaries.service';
import { SummarizeProcessor } from './summaries/summarize.processor';

/**
 * Worker process: scheduler, polling and LLM summarization. Separate from the API so it can
 * be scaled (or restarted) independently and slow LLM calls never compete with HTTP requests.
 * Controllers from imported feature modules are inert here (no HTTP server is started).
 */
@Module({
  imports: [
    ConfigModule,
    loggerModule(),
    PrismaModule,
    QueueModule,
    CompetitorsModule,
    SnapshotsModule,
    PollingModule,
    SummariesModule,
    ListingSourceModule,
    LlmModule,
  ],
  providers: [PollingService, SummariesService, SchedulerProcessor, PollProcessor, SummarizeProcessor],
})
export class WorkerModule {}
