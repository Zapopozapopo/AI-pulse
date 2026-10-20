import { Module } from '@nestjs/common';
import { PollProducer } from './poll.producer';

/** Producer side only: safe to import from the HTTP app (no workers start). */
@Module({
  providers: [PollProducer],
  exports: [PollProducer],
})
export class PollingModule {}
