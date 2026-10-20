import { Module } from '@nestjs/common';
import { CompetitorsModule } from '../competitors/competitors.module';
import { SummariesModule } from '../summaries/summaries.module';
import { SnapshotsController } from './snapshots.controller';
import { SnapshotsRepository } from './snapshots.repository';
import { SnapshotsService } from './snapshots.service';

@Module({
  imports: [CompetitorsModule, SummariesModule],
  controllers: [SnapshotsController],
  providers: [SnapshotsRepository, SnapshotsService],
  exports: [SnapshotsRepository],
})
export class SnapshotsModule {}
