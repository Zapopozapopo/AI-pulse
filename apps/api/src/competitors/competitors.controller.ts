import type { Competitor } from '@competitor-pulse/contracts';
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CompetitorIdPipe } from '../common/competitor-id';
import { toCompetitorResponse } from './competitor.mapper';
import { CompetitorsService } from './competitors.service';
import { CreateCompetitorDto } from './dto/create-competitor.dto';

@Controller('competitors')
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  @Get()
  async list(): Promise<Competitor[]> {
    return (await this.competitors.list()).map(toCompetitorResponse);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateCompetitorDto): Promise<{ id: string }> {
    await this.competitors.track(dto.id);
    return { id: dto.id };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', CompetitorIdPipe) id: string): Promise<void> {
    await this.competitors.untrack(id);
  }
}
