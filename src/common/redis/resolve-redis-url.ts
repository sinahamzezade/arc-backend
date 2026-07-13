/**
 * Resolve REDIS_URL for BullMQ / ioredis.
 * Empty or localhost in production → undefined (in-process / memory fallback).
 * Railway must set REDIS_URL to the Redis service private URL, not localhost.
 */
export function resolveRedisUrl(
  raw: string | undefined | null = process.env.REDIS_URL,
  nodeEnv: string | undefined | null = process.env.NODE_ENV,
): string | undefined {
  const url = raw?.trim();
  if (!url) return undefined;

  const isProd = nodeEnv === 'production';
  if (isProd && isLoopbackRedis(url)) {
    return undefined;
  }
  return url;
}

function isLoopbackRedis(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0'
    );
  } catch {
    return /localhost|127\.0\.0\.1|::1/.test(url);
  }
}
