import { Injectable } from '@nestjs/common';
import type { Competitor } from '@prisma/client';
import { ConflictError } from '../common/errors';
import { CompetitorsRepository } from './competitors.repository';

@Injectable()
export class CompetitorsService {
  constructor(private readonly competitors: CompetitorsRepository) {}

  list(): Promise<Competitor[]> {
    return this.competitors.findAllActive();
  }

  /**
   * Creates the competitor, or restores it (with its history) if it was removed earlier.
   * Both set next_poll_at = now, so the next scheduler tick (every few seconds) polls it.
   * Deliberately no direct enqueue here: one path to polling means no double polls.
   */
  async track(id: string): Promise<void> {
    const existing = await this.competitors.findById(id);
    if (existing && !existing.deletedAt) throw new ConflictError(`Competitor "${id}" is already tracked`);

    if (existing) {
      if (!(await this.competitors.restore(id))) throw new ConflictError(`Competitor "${id}" is already tracked`);
    } else {
      try {
        await this.competitors.create(id);
      } catch (error) {
        if (CompetitorsRepository.isUniqueViolation(error)) {
          throw new ConflictError(`Competitor "${id}" is already tracked`);
        }
        throw error;
      }
    }
  }

  /** Idempotent: removing an unknown or already removed competitor is still a 204. */
  async untrack(id: string): Promise<void> {
    await this.competitors.softDelete(id);
  }
}
