import { Module } from '@nestjs/common';
import { SummarizeProducer } from './summarize.producer';

/** Producer side only: safe to import from the HTTP app (no workers start). */
@Module({
  providers: [SummarizeProducer],
  exports: [SummarizeProducer],
})
export class SummariesModule {}
