process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

import { UnrecoverableError, type Job } from 'bullmq';
import { ListingNotFoundError } from '../listing-source/listing-source.client';
import type { PollJobData } from '../queue/queue.constants';
import { PollProcessor } from './poll.processor';
import type { PollingService } from './polling.service';

const job = (attemptsMade: number, data: PollJobData = { competitorId: 'x' }) =>
  ({ data, attemptsMade, opts: { attempts: 3 }, updateData: jest.fn().mockResolvedValue(undefined) }) as unknown as Job<PollJobData>;

function setup(error: Error) {
  const polling = { pollCompetitor: jest.fn().mockRejectedValue(error), recordFailure: jest.fn().mockResolvedValue(undefined) };
  return { processor: new PollProcessor(polling as unknown as PollingService), polling };
}

describe('PollProcessor', () => {
  it('passes a checkpointed fetch to the retry and saves fresh fetches into the job', async () => {
    const polling = { pollCompetitor: jest.fn().mockResolvedValue({ status: 'changed' }), recordFailure: jest.fn() };
    const processor = new PollProcessor(polling as unknown as PollingService);
    const listing = { title: 't', tagline: 'g', price: 'p', description: 'd' };
    const retry = job(1, { competitorId: 'x', fetched: { listing, fetchedAt: '2026-09-10T12:00:00.000Z' } });

    await processor.process(retry);
    const checkpoint = polling.pollCompetitor.mock.calls[0][1];
    expect(checkpoint.fetched).toEqual({ listing, fetchedAt: new Date('2026-09-10T12:00:00Z') });

    await checkpoint.save({ listing, fetchedAt: new Date('2026-09-10T12:05:00Z') });
    expect(retry.updateData).toHaveBeenCalledWith({
      competitorId: 'x',
      fetched: { listing, fetchedAt: '2026-09-10T12:05:00.000Z' },
    });
  });

  it('retries transient errors without recording a failure until the last attempt', async () => {
    const { processor, polling } = setup(new Error('503'));
    await expect(processor.process(job(0))).rejects.toThrow('503');
    expect(polling.recordFailure).not.toHaveBeenCalled();
    await expect(processor.process(job(2))).rejects.toThrow('503');
    expect(polling.recordFailure).toHaveBeenCalledTimes(1);
  });

  it('records unknown competitors once and does not retry them', async () => {
    const { processor, polling } = setup(new ListingNotFoundError('x'));
    await expect(processor.process(job(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(polling.recordFailure).toHaveBeenCalledWith('x', expect.stringContaining('no competitor'));
  });

  it('keeps the original error (and its no-retry semantics) when recording the failure fails', async () => {
    const { processor, polling } = setup(new ListingNotFoundError('x'));
    polling.recordFailure.mockRejectedValue(new Error('db down'));
    await expect(processor.process(job(0))).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
