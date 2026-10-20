import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import type { Listing } from '../snapshots/listing';
import { ListingNotFoundError, ListingSourceClient } from './listing-source.client';

/** External input: validated at the boundary, never trusted structurally. */
const listingSchema = z.object({
  title: z.string(),
  tagline: z.string(),
  price: z.string(),
  description: z.string(),
});

@Injectable()
export class HttpListingSourceClient implements ListingSourceClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async fetchListing(competitorId: string): Promise<Listing> {
    const { baseUrl, timeoutMs } = this.config.listingSource;
    const response = await fetch(`${baseUrl}/listings/${encodeURIComponent(competitorId)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 404) throw new ListingNotFoundError(competitorId);
    if (!response.ok) throw new Error(`Listing source responded ${response.status} for "${competitorId}"`);
    return listingSchema.parse(await response.json());
  }
}
