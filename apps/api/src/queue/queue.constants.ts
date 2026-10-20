import type { Listing } from '../snapshots/listing';

/**
 * Three queues so each stage gets its own concurrency, rate limit and retry policy:
 * - scheduler: repeatable "tick" (claim due competitors) and "reconcile" (re-enqueue stuck summaries)
 * - poll:      fetch one competitor's listing and persist a snapshot (cheap, high concurrency)
 * - summarize: one LLM call per detected change (billed, rate limited, slow, retried with backoff)
 */
export const QUEUES = {
  scheduler: 'scheduler',
  poll: 'poll',
  summarize: 'summarize',
} as const;

export const JOBS = {
  tick: 'tick',
  reconcile: 'reconcile',
  poll: 'poll',
  summarize: 'summarize',
} as const;

export interface PollJobData {
  competitorId: string;
  /**
   * Checkpoint of this job's fetch (fetchedAt as ISO string: job payloads are JSON). The source
   * advances on every fetch, so a retry reuses this instead of fetching again and skipping a version.
   */
  fetched?: { listing: Listing; fetchedAt: string };
}

export interface SummarizeJobData {
  /** bigint serialized as string: job payloads are JSON. */
  snapshotId: string;
}

/** BullMQ deduplication ids: at most one waiting/active job per competitor / snapshot. */
export const pollDedupId = (competitorId: string) => `poll-${competitorId}`;
export const summarizeDedupId = (snapshotId: string) => `summarize-${snapshotId}`;
