import type { Snapshot } from '@competitor-pulse/contracts';
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CompetitorIdPipe } from '../common/competitor-id';
import { ValidationError } from '../common/errors';
import { parseSnapshotId, SnapshotIdPipe } from '../common/snapshot-id';
import { ListSnapshotsQuery } from './dto/list-snapshots.query';
import { toSnapshotResponse } from './snapshot.mapper';
import { SnapshotsService } from './snapshots.service';

@Controller()
export class SnapshotsController {
  constructor(private readonly snapshots: SnapshotsService) {}

  /** Newest first. The body stays a plain array (API contract); paging metadata goes in a header. */
  @Get('competitors/:id/snapshots')
  async list(
    @Param('id', CompetitorIdPipe) competitorId: string,
    @Query() query: ListSnapshotsQuery,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Snapshot[]> {
    let before: bigint | undefined;
    if (query.before !== undefined) {
      before = parseSnapshotId(query.before) ?? undefined;
      if (before === undefined) throw new ValidationError('before must be a snapshot id');
    }
    const rows = await this.snapshots.listForCompetitor(competitorId, query.limit, before);
    if (query.limit !== undefined && rows.length === query.limit) {
      res.setHeader('X-Next-Cursor', rows[rows.length - 1].id.toString());
    }
    return rows.map(toSnapshotResponse);
  }

  @Post('snapshots/:id/summary/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  async retrySummary(@Param('id', SnapshotIdPipe) id: bigint): Promise<void> {
    await this.snapshots.retrySummary(id);
  }
}
