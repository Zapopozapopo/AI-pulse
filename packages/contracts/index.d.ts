/**
 * Public HTTP contract of the CompetitorPulse API.
 * Type-only on purpose: both the Nest API and the React app import these with `import type`,
 * so there is nothing to build and no runtime coupling between the apps.
 */

export type CompetitorId = string;

export interface CreateCompetitorRequest {
  id: CompetitorId;
}

export interface Competitor {
  id: CompetitorId;
  /** Extra fields beyond the minimum `{ id }` contract. */
  createdAt: string;
  lastPolledAt: string | null;
  nextPollAt: string;
  lastError: string | null;
}

/**
 * - `none`      no summary needed (first snapshot or unchanged listing)
 * - `pending`   change detected, LLM summary queued or in progress
 * - `completed` summary available
 * - `failed`    LLM failed after all retries; snapshot is still stored
 */
export type SummaryStatus = 'none' | 'pending' | 'completed' | 'failed';

export type ListingField = 'title' | 'tagline' | 'price' | 'description';

export interface Snapshot {
  fetchedAt: string;
  title: string;
  tagline: string;
  price: string;
  description: string;
  /** false if identical to the previous snapshot (and for the first, baseline snapshot). */
  changed: boolean;
  /** null if unchanged, pending, or failed. */
  summary: string | null;

  /** Extra fields beyond the required contract. */
  id: string;
  summaryStatus: SummaryStatus;
  changedFields: ListingField[];
  isBaseline: boolean;
}

export interface ApiError {
  statusCode: number;
  message: string | string[];
  error?: string;
}
