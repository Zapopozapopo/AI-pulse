import { Module } from '@nestjs/common';
import { CompetitorsController } from './competitors.controller';
import { CompetitorsRepository } from './competitors.repository';
import { CompetitorsService } from './competitors.service';

@Module({
  controllers: [CompetitorsController],
  providers: [CompetitorsRepository, CompetitorsService],
  exports: [CompetitorsRepository],
})
export class CompetitorsModule {}
