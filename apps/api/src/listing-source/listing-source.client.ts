import type { Listing } from '../snapshots/listing';

export const LISTING_SOURCE = Symbol('LISTING_SOURCE');

/** Port to the external data source. Swap the adapter to scrape real pages instead of the stub. */
export interface ListingSourceClient {
  fetchListing(competitorId: string): Promise<Listing>;
}

/** The source does not know this competitor: retrying will not help. */
export class ListingNotFoundError extends Error {
  constructor(competitorId: string) {
    super(`Listing source has no competitor "${competitorId}"`);
    this.name = 'ListingNotFoundError';
  }
}
