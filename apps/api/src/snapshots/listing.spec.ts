import { diffListings, hashListing, normalizeListing, type Listing } from './listing';

const base: Listing = {
  title: 'Acme CRM',
  tagline: 'Simple CRM for small teams',
  price: '$29/mo',
  description: 'Track leads and deals in one place.',
};

describe('listing', () => {
  it('hashes identical content identically regardless of key order', () => {
    const reordered = { description: base.description, price: base.price, tagline: base.tagline, title: base.title };
    expect(hashListing(reordered)).toBe(hashListing(base));
  });

  it('produces a different hash when any field changes', () => {
    expect(hashListing({ ...base, price: '$39/mo' })).not.toBe(hashListing(base));
  });

  it('does not confuse values shifted between fields', () => {
    const a = { ...base, title: 'A B', tagline: 'C' };
    const b = { ...base, title: 'A', tagline: 'B C' };
    expect(hashListing(a)).not.toBe(hashListing(b));
  });

  it('normalizes whitespace only, keeping case and punctuation significant', () => {
    const noisy = { ...base, description: '  Track leads and\n deals   in one place. ' };
    expect(normalizeListing(noisy)).toEqual(base);
    expect(hashListing(normalizeListing({ ...base, title: 'ACME CRM' }))).not.toBe(hashListing(base));
  });

  it('lists exactly the changed fields in canonical order', () => {
    const next = { ...base, description: 'New', price: '$39/mo' };
    expect(diffListings(base, next)).toEqual(['price', 'description']);
    expect(diffListings(base, { ...base })).toEqual([]);
  });
});
