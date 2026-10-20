import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullBoardModule } from '@bull-board/nestjs';
import { Module } from '@nestjs/common';
import { CompetitorsModule } from './competitors/competitors.module';
import { loggerModule } from './common/logger';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { QUEUES } from './queue/queue.constants';
import { SnapshotsModule } from './snapshots/snapshots.module';

/**
 * HTTP process: REST API + queue dashboard (Bull Board, /api/admin/queues). Enqueues jobs but
 * runs no workers. No auth anywhere, per the assignment (single internal user); ports are
 * published on localhost only.
 */
@Module({
  imports: [
    ConfigModule,
    loggerModule(),
    PrismaModule,
    QueueModule,
    BullBoardModule.forRoot({ route: '/admin/queues', adapter: ExpressAdapter }),
    ...Object.values(QUEUES).map((name) => BullBoardModule.forFeature({ name, adapter: BullMQAdapter })),
    CompetitorsModule,
    SnapshotsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
