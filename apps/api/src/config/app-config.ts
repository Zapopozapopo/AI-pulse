import { existsSync } from 'node:fs';
import { z } from 'zod';

const seconds = (fallback: number) => z.coerce.number().positive().default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  LISTING_SOURCE_URL: z.string().url().default('http://localhost:4002'),
  LISTING_SOURCE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),

  POLL_INTERVAL_SECONDS: seconds(900),
  POLL_JITTER_RATIO: z.coerce.number().min(0).max(0.5).default(0.1),
  SCHEDULER_TICK_SECONDS: seconds(5),
  POLL_BATCH_SIZE: z.coerce.number().int().positive().default(100),
  POLL_CONCURRENCY: z.coerce.number().int().positive().default(10),
  POLL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),

  LLM_BASE_URL: z.string().url().default('http://localhost:4001/v1'),
  LLM_API_KEY: z.string().default('not-needed-for-mock'),
  LLM_MODEL: z.string().default('mock-llm'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  LLM_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LLM_RATE_PER_SEC: z.coerce.number().int().positive().default(5),
  SUMMARY_CONCURRENCY: z.coerce.number().int().positive().default(4),

  RECONCILE_INTERVAL_SECONDS: seconds(60),
  RECONCILE_PENDING_AFTER_SECONDS: seconds(120),
});

export type AppConfig = Readonly<{
  env: 'development' | 'production' | 'test';
  port: number;
  logLevel: string;
  databaseUrl: string;
  redisUrl: string;
  listingSource: { baseUrl: string; timeoutMs: number };
  polling: {
    intervalSeconds: number;
    jitterRatio: number;
    tickSeconds: number;
    batchSize: number;
    concurrency: number;
    maxAttempts: number;
  };
  llm: {
    baseUrl: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
    maxAttempts: number;
    ratePerSecond: number;
    concurrency: number;
  };
  reconcile: { intervalSeconds: number; pendingAfterSeconds: number };
}>;

export const APP_CONFIG = Symbol('APP_CONFIG');

let cached: AppConfig | undefined;

/**
 * Parses and validates the environment once; the process fails fast on bad config.
 * Exposed as a plain function (not only via DI) because BullMQ worker options are
 * declared in decorators, which are evaluated before the DI container exists.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached && source === process.env) return cached;
  if (source === process.env && existsSync('.env')) process.loadEnvFile('.env');

  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = result.data;
  const config: AppConfig = {
    env: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    redisUrl: e.REDIS_URL,
    listingSource: { baseUrl: e.LISTING_SOURCE_URL, timeoutMs: e.LISTING_SOURCE_TIMEOUT_MS },
    polling: {
      intervalSeconds: e.POLL_INTERVAL_SECONDS,
      jitterRatio: e.POLL_JITTER_RATIO,
      tickSeconds: e.SCHEDULER_TICK_SECONDS,
      batchSize: e.POLL_BATCH_SIZE,
      concurrency: e.POLL_CONCURRENCY,
      maxAttempts: e.POLL_MAX_ATTEMPTS,
    },
    llm: {
      baseUrl: e.LLM_BASE_URL,
      apiKey: e.LLM_API_KEY,
      model: e.LLM_MODEL,
      timeoutMs: e.LLM_TIMEOUT_MS,
      maxAttempts: e.LLM_MAX_ATTEMPTS,
      ratePerSecond: e.LLM_RATE_PER_SEC,
      concurrency: e.SUMMARY_CONCURRENCY,
    },
    reconcile: {
      intervalSeconds: e.RECONCILE_INTERVAL_SECONDS,
      pendingAfterSeconds: e.RECONCILE_PENDING_AFTER_SECONDS,
    },
  };
  if (source === process.env) cached = config;
  return config;
}
