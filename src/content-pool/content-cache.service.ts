import { Injectable } from '@nestjs/common';
import { JsonCacheService } from '../common/cache/json-cache.service';

type CacheEntry<T> = { value: T; expiresAt: number };

/**
 * Published recipe/graph snapshots — Redis-backed with in-process L1.
 */
@Injectable()
export class ContentCacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTtlMs = 5 * 60 * 1000;

  constructor(private readonly jsonCache: JsonCacheService) {}

  async get<T>(key: string): Promise<T | null> {
    const row = this.store.get(key);
    if (row && Date.now() <= row.expiresAt) {
      return row.value as T;
    }

    const remote = await this.jsonCache.getJson<T>(key);
    if (remote != null) {
      this.store.set(key, {
        value: remote,
        expiresAt: Date.now() + this.defaultTtlMs,
      });
      return remote;
    }
    return null;
  }

  async set<T>(
    key: string,
    value: T,
    ttlMs = this.defaultTtlMs,
  ): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    await this.jsonCache.setJson(key, value, ttlSec);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
    await this.jsonCache.del(key);
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    for (const key of [...this.store.keys()]) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
    await this.jsonCache.delByPrefix(prefix);
  }

  recipeKey(roleSlug: string, version: number): string {
    return `content:recipe:${roleSlug}:v${version}`;
  }

  graphKey(recipeId: string, version: number): string {
    return `content:graph:${recipeId}:v${version}`;
  }
}
