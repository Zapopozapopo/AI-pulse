import { Injectable } from '@nestjs/common';
import { Competitor, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Only layer that knows about Prisma/SQL for the competitors table. */
@Injectable()
export class CompetitorsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAllActive(): Promise<Competitor[]> {
    return this.prisma.competitor.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } });
  }

  /** Includes soft-deleted rows, so the service can decide between create and restore. */
  findById(id: string): Promise<Competitor | null> {
    return this.prisma.competitor.findUnique({ where: { id } });
  }

  findActive(id: string): Promise<Competitor | null> {
    return this.prisma.competitor.findFirst({ where: { id, deletedAt: null } });
  }

  /** Throws Prisma P2002 if the id already exists; the service maps that to a conflict. */
  create(id: string): Promise<Competitor> {
    return this.prisma.competitor.create({ data: { id, nextPollAt: new Date() } });
  }

  /** Re-tracks a soft-deleted competitor; returns false if it was not deleted (lost a race). */
  async restore(id: string): Promise<boolean> {
    const { count } = await this.prisma.competitor.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null, nextPollAt: new Date(), lastError: null, consecutiveFailures: 0 },
    });
    return count === 1;
  }

  async softDelete(id: string): Promise<boolean> {
    const { count } = await this.prisma.competitor.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count === 1;
  }

  /**
   * Atomically claims up to `limit` due competitors and pushes their next_poll_at forward
   * (interval ± jitter, so a few hundred competitors spread out instead of polling in bursts).
   * FOR UPDATE SKIP LOCKED makes concurrent schedulers claim disjoint sets, so a competitor
   * is never handed out twice for the same slot even if several worker replicas tick at once.
   */
  async claimDue(limit: number, intervalSeconds: number, jitterRatio: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE competitors AS c
      SET next_poll_at = now() + make_interval(secs => ${intervalSeconds}::float8 * (1 + ${jitterRatio}::float8 * (random() * 2 - 1)))
      WHERE c.id IN (
        SELECT id FROM competitors
        WHERE deleted_at IS NULL AND next_poll_at <= now()
        ORDER BY next_poll_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING c.id`;
    return rows.map((row) => row.id);
  }

  /** Undo a claim whose poll jobs could not be enqueued, so the next tick retries instead of skipping a cycle. */
  async releaseClaims(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.competitor.updateMany({ where: { id: { in: ids } }, data: { nextPollAt: new Date() } });
  }

  /**
   * Records a failed poll and backs off exponentially (x2, x4, x8 the interval) so a broken
   * source is not hammered every cycle. Success resets this in SnapshotsRepository.appendSnapshot.
   */
  async recordPollFailure(id: string, error: string, intervalSeconds: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE competitors
      SET last_error = ${error.slice(0, 1000)},
          consecutive_failures = consecutive_failures + 1,
          next_poll_at = now() + make_interval(secs => ${intervalSeconds}::float8 * power(2, least(consecutive_failures + 1, 3)))
      WHERE id = ${id} AND deleted_at IS NULL`;
  }

  static isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
