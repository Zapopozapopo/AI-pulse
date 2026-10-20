import { createHash } from 'node:crypto';
import type { ListingField } from '@competitor-pulse/contracts';

export interface Listing {
  title: string;
  tagline: string;
  price: string;
  description: string;
}

/** Fixed order: hashing and diffing never depend on object key order. */
export const LISTING_FIELDS: readonly ListingField[] = ['title', 'tagline', 'price', 'description'];

/**
 * Whitespace-only normalization (trim + collapse runs). Deliberately conservative:
 * case or punctuation changes are real copy changes and must still count as changes,
 * but re-wrapped text or trailing spaces from a scraper must not trigger a billed LLM call.
 */
export function normalizeListing(raw: Listing): Listing {
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  return {
    title: clean(raw.title),
    tagline: clean(raw.tagline),
    price: clean(raw.price),
    description: clean(raw.description),
  };
}

/** Stable content fingerprint used for O(1) change detection and the summary cache. */
export function hashListing(listing: Listing): string {
  const canonical = JSON.stringify(LISTING_FIELDS.map((field) => listing[field]));
  return createHash('sha256').update(canonical).digest('hex');
}

export function diffListings(previous: Listing, current: Listing): ListingField[] {
  return LISTING_FIELDS.filter((field) => previous[field] !== current[field]);
}

/** Strips a DB row (ids, hashes, timestamps) down to the listing content. */
export function pickListing(source: Listing): Listing {
  return { title: source.title, tagline: source.tagline, price: source.price, description: source.description };
}
