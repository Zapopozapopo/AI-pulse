import { Module } from '@nestjs/common';
import { LLM_PROVIDER } from './llm.provider';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

@Module({
  providers: [{ provide: LLM_PROVIDER, useClass: OpenAiCompatibleProvider }],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
