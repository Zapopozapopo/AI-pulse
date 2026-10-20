/**
 * An HTTP-level LLM failure. `retryable` separates transient problems (timeouts, 408, 429, 5xx)
 * from permanent ones (401 bad key, 400 bad request, 404 unknown model) that retries can't fix.
 */
export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LlmRequestError';
  }

  static fromStatus(status: number, body: string): LlmRequestError {
    const retryable = status === 408 || status === 429 || status >= 500;
    return new LlmRequestError(`LLM responded ${status}: ${body}`, retryable);
  }
}
