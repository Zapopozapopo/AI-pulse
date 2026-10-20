import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { QUEUES } from './queue.constants';
import { redisConnectionFromUrl } from './redis-connection';

const queues = [
  BullModule.registerQueue({
    name: QUEUES.scheduler,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 },
  }),
  BullModule.registerQueue({
    name: QUEUES.poll,
    defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
  }),
  BullModule.registerQueue({
    name: QUEUES.summarize,
    defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 },
  }),
];

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ connection: redisConnectionFromUrl(config.redisUrl) }),
    }),
    ...queues,
  ],
  exports: queues,
})
export class QueueModule {}
