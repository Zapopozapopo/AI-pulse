import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { LlmRequestError } from './llm.errors';
import { ChangeSummary, ChangeSummaryInput, LlmProvider } from './llm.provider';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

/**
 * Talks to any OpenAI Chat Completions compatible endpoint (the provided mock server,
 * OpenAI, Ollama, vLLM, ...). Plain fetch keeps the timeout and retry policy explicit:
 * a hard per-request timeout here, retries/backoff/rate limiting in the queue.
 */
@Injectable()
export class OpenAiCompatibleProvider implements LlmProvider {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async summarizeChange(input: ChangeSummaryInput): Promise<ChangeSummary> {
    const { baseUrl, apiKey, model, timeoutMs } = this.config.llm;
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 150,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(input) },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 300);
      throw LlmRequestError.fromStatus(response.status, body);
    }
    const completion = completionSchema.parse(await response.json());
    const text = completion.choices[0].message.content?.trim();
    if (!text) throw new Error('LLM returned an empty summary');
    return { text, model: completion.model ?? model };
  }
}
