import { Injectable } from '@nestjs/common';

type CacheEntry<T> = { value: T; expiresAt: number };

/**
 * In-process cache for published recipe/graph snapshots.
 * Key includes content version. Redis-ready interface (get/set/del).
 */
@Injectable()
export class ContentCacheService {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTtlMs = 5 * 60 * 1000;

  get<T>(key: string): T | null {
    const row = this.store.get(key);
    if (!row) return null;
    if (Date.now() > row.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return row.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  del(key: string): void {
    this.store.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  recipeKey(roleSlug: string, version: number): string {
    return `recipe:${roleSlug}:v${version}`;
  }

  graphKey(recipeId: string, version: number): string {
    return `graph:${recipeId}:v${version}`;
  }
}
