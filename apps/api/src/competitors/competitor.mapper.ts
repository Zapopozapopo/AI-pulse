import type { Competitor as CompetitorResponse } from '@competitor-pulse/contracts';
import type { Competitor } from '@prisma/client';

export const toCompetitorResponse = (c: Competitor): CompetitorResponse => ({
  id: c.id,
  createdAt: c.createdAt.toISOString(),
  lastPolledAt: c.lastPolledAt?.toISOString() ?? null,
  nextPollAt: c.nextPollAt.toISOString(),
  lastError: c.lastError,
});
