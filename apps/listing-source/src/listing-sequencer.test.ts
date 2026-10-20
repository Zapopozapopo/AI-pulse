import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ListingSequencer } from './listing-sequencer.ts';

const listing = (price: string) => ({ title: 'T', tagline: 'G', price, description: 'D' });

test('advances per id and repeats the last version once exhausted', () => {
  const seq = new ListingSequencer({ a: [listing('1'), listing('2')], b: [listing('x')] });

  assert.equal(seq.next('a')?.listing.price, '1');
  assert.equal(seq.next('b')?.listing.price, 'x');
  assert.equal(seq.next('a')?.listing.price, '2');
  assert.equal(seq.next('a')?.listing.price, '2');
  assert.equal(seq.next('a')?.version, 2);
});

test('returns undefined for unknown ids and does not track them', () => {
  const seq = new ListingSequencer({ a: [listing('1')] });
  assert.equal(seq.next('missing'), undefined);
  assert.deepEqual(seq.state(), {});
});

test('reset starts every sequence from the beginning', () => {
  const seq = new ListingSequencer({ a: [listing('1'), listing('2')] });
  seq.next('a');
  seq.reset();
  assert.equal(seq.next('a')?.listing.price, '1');
});
