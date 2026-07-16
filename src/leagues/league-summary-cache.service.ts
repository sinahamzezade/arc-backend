import { Injectable } from '@nestjs/common';
import { JsonCacheService } from '../common/cache/json-cache.service';

type LeagueSummaryKind = 'current' | 'me';

@Injectable()
export class LeagueSummaryCacheService {
  private readonly ttlSec = 20;

  constructor(private readonly cache: JsonCacheService) {}

  private key(
    userId: string,
    cohortId: string,
    kind: LeagueSummaryKind,
  ): string {
    return `league:summary:${userId}:${kind}:${cohortId}`;
  }

  async get<T>(
    userId: string,
    cohortId: string,
    kind: LeagueSummaryKind,
  ): Promise<T | null> {
    return this.cache.getJson<T>(this.key(userId, cohortId, kind));
  }

  async set<T>(
    userId: string,
    cohortId: string,
    kind: LeagueSummaryKind,
    value: T,
  ): Promise<void> {
    await this.cache.setJson(
      this.key(userId, cohortId, kind),
      value,
      this.ttlSec,
    );
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.cache.delByPrefix(`league:summary:${userId}:`);
  }
}
