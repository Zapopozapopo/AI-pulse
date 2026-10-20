import type { RedisOptions } from 'bullmq';

/**
 * REDIS_URL -> ioredis options. Handles what managed Redis needs: rediss:// (TLS) and
 * URL-encoded credentials (a password like "p@ss" arrives as "p%40ss").
 */
export function redisConnectionFromUrl(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
    throw new Error(`REDIS_URL must use redis:// or rediss://, got ${url.protocol}`);
  }
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    tls: url.protocol === 'rediss:' ? { servername: url.hostname } : undefined,
  };
}
