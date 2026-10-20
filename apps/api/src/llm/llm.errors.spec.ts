import { LlmRequestError } from './llm.errors';

describe('LlmRequestError.fromStatus', () => {
  it.each([408, 429, 500, 502, 503])('treats %i as retryable', (status) => {
    expect(LlmRequestError.fromStatus(status, '').retryable).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])('treats %i as permanent', (status) => {
    expect(LlmRequestError.fromStatus(status, '').retryable).toBe(false);
  });
});
