export interface Listing {
  title: string;
  tagline: string;
  price: string;
  description: string;
}

export type Fixtures = Record<string, Listing[]>;

/**
 * Returns the next listing in each competitor's sequence on every call and keeps
 * repeating the last one once the sequence is exhausted.
 * State is in memory on purpose: this service is the single owner of the counters,
 * so any number of API/worker replicas see one consistent sequence.
 */
export class ListingSequencer {
  private readonly cursors = new Map<string, number>();
  private readonly fixtures: Fixtures;

  constructor(fixtures: Fixtures) {
    this.fixtures = fixtures;
  }

  has(id: string): boolean {
    return Object.hasOwn(this.fixtures, id) && this.fixtures[id].length > 0;
  }

  ids(): string[] {
    return Object.keys(this.fixtures);
  }

  next(id: string): { listing: Listing; version: number } | undefined {
    if (!this.has(id)) return undefined;
    const versions = this.fixtures[id];
    const cursor = this.cursors.get(id) ?? 0;
    const index = Math.min(cursor, versions.length - 1);
    this.cursors.set(id, cursor + 1);
    return { listing: versions[index], version: index + 1 };
  }

  state(): Record<string, number> {
    return Object.fromEntries(this.cursors);
  }

  reset(): void {
    this.cursors.clear();
  }
}
