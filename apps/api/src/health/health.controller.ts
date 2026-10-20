import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES } from '../queue/queue.constants';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.poll) private readonly pollQueue: Queue,
  ) {}

  @Get()
  async check(): Promise<{ status: 'ok'; checks: Record<string, 'up'> }> {
    const results = await Promise.allSettled([
      this.prisma.$queryRaw`SELECT 1`,
      this.pollQueue.count(), // any Redis round trip
    ]);
    const [database, redis] = results.map((r) => (r.status === 'fulfilled' ? 'up' : 'down'));
    if (database !== 'up' || redis !== 'up') {
      throw new ServiceUnavailableException({ status: 'error', checks: { database, redis } });
    }
    return { status: 'ok', checks: { database: 'up', redis: 'up' } };
  }
}
