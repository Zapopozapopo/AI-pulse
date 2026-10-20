import type { ListingField } from '@competitor-pulse/contracts';
import type { Listing } from '../snapshots/listing';

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface ChangeSummaryInput {
  competitorId: string;
  previous: Listing;
  current: Listing;
  changedFields: ListingField[];
}

export interface ChangeSummary {
  text: string;
  model: string;
}

/** Port for the LLM. Only an OpenAI-compatible adapter exists; Anthropic/Ollama would be one more class. */
export interface LlmProvider {
  summarizeChange(input: ChangeSummaryInput): Promise<ChangeSummary>;
}
