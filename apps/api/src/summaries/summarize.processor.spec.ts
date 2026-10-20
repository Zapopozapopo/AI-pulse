process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';

import { UnrecoverableError, type Job } from 'bullmq';
import { LlmRequestError } from '../llm/llm.errors';
import type { SummarizeJobData } from '../queue/queue.constants';
import type { SummariesService } from './summaries.service';
import { SummarizeProcessor } from './summarize.processor';

const job = (attemptsMade: number, attempts = 5) =>
  ({ data: { snapshotId: '7' }, attemptsMade, opts: { attempts } }) as Job<SummarizeJobData>;

function setup(error: Error) {
  const summaries = { summarize: jest.fn().mockRejectedValue(error), markFailed: jest.fn().mockResolvedValue(undefined) };
  return { processor: new SummarizeProcessor(summaries as unknown as SummariesService), summaries };
}

describe('SummarizeProcessor', () => {
  it('rethrows transient errors for a retry without marking the summary failed', async () => {
    const error = LlmRequestError.fromStatus(503, 'busy');
    const { processor, summaries } = setup(error);
    await expect(processor.process(job(0))).rejects.toBe(error);
    expect(summaries.markFailed).not.toHaveBeenCalled();
  });

  it('marks the summary failed on the final attempt', async () => {
    const { processor, summaries } = setup(new Error('timeout'));
    await expect(processor.process(job(4))).rejects.toThrow('timeout');
    expect(summaries.markFailed).toHaveBeenCalledWith(7n, 'timeout');
  });

  it('fails permanent LLM errors immediately as unrecoverable', async () => {
    const { processor, summaries } = setup(LlmRequestError.fromStatus(401, 'bad key'));
    await expect(processor.process(job(0))).rejects.toBeInstanceOf(UnrecoverableError);
    expect(summaries.markFailed).toHaveBeenCalledWith(7n, expect.stringContaining('401'));
  });

  it('keeps the original error when marking the summary failed also fails', async () => {
    const original = LlmRequestError.fromStatus(401, 'bad key');
    const { processor, summaries } = setup(original);
    summaries.markFailed.mockRejectedValue(new Error('db down'));
    await expect(processor.process(job(0))).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
