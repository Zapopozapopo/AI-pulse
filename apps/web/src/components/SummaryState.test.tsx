import type { Snapshot } from '@competitor-pulse/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SummaryState } from './SummaryState';

const snapshot = (overrides: Partial<Snapshot>): Snapshot => ({
  id: '2',
  fetchedAt: '2026-09-10T12:00:00Z',
  title: 'Acme CRM',
  tagline: 'Simple CRM',
  price: '$29/mo',
  description: 'Track leads.',
  changed: true,
  summary: null,
  summaryStatus: 'pending',
  changedFields: ['price'],
  isBaseline: false,
  ...overrides,
});

describe('SummaryState', () => {
  it.each([
    [{ isBaseline: true, changed: false, summaryStatus: 'none' as const }, /No change — first snapshot/],
    [{ changed: false, summaryStatus: 'none' as const }, /No change since previous snapshot/],
    [{ summaryStatus: 'pending' as const }, /generating AI summary/],
    [{ summaryStatus: 'failed' as const }, /AI summary failed/],
    [{ summaryStatus: 'completed' as const, summary: 'Price dropped.' }, /Price dropped\./],
  ])('renders %o', (overrides, expected) => {
    render(<SummaryState snapshot={snapshot(overrides)} />);
    expect(screen.getByText(expected)).toBeTruthy();
  });
});
