import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonCacheService } from '../common/cache/json-cache.service';
import { Roadmap } from './entities/roadmap.entity';
import { toRoadmapTreeDto } from './roadmap.serializer';

export type RoadmapTreeCachePayload = ReturnType<typeof toRoadmapTreeDto>;

@Injectable()
export class RoadmapCacheService {
  private readonly ttlSec: number;

  constructor(
    private readonly cache: JsonCacheService,
    config: ConfigService,
  ) {
    this.ttlSec = Number(config.get<string>('ROADMAP_CACHE_TTL_SEC') ?? 120);
  }

  treeKey(roadmapId: string): string {
    return `roadmap:tree:${roadmapId}`;
  }

  activeKey(userId: string): string {
    return `roadmap:active:${userId}`;
  }

  ordinalsKey(roadmapId: string): string {
    return `roadmap:ordinals:${roadmapId}`;
  }

  async getTree(roadmapId: string): Promise<RoadmapTreeCachePayload | null> {
    return this.cache.getJson<RoadmapTreeCachePayload>(this.treeKey(roadmapId));
  }

  async setTree(roadmap: Roadmap): Promise<void> {
    await this.cache.setJson(
      this.treeKey(roadmap.id),
      toRoadmapTreeDto(roadmap),
      this.ttlSec,
    );
  }

  async getActiveRoadmapId(userId: string): Promise<string | null> {
    return this.cache.getJson<string>(this.activeKey(userId));
  }

  async setActiveRoadmapId(userId: string, roadmapId: string): Promise<void> {
    await this.cache.setJson(this.activeKey(userId), roadmapId, this.ttlSec);
  }

  async getOrdinals(roadmapId: string): Promise<Record<string, number> | null> {
    return this.cache.getJson<Record<string, number>>(this.ordinalsKey(roadmapId));
  }

  async setOrdinals(
    roadmapId: string,
    ordinals: Record<string, number>,
  ): Promise<void> {
    await this.cache.setJson(this.ordinalsKey(roadmapId), ordinals, this.ttlSec);
  }

  async invalidateRoadmap(roadmapId: string, userId?: string): Promise<void> {
    await this.cache.del(this.treeKey(roadmapId), this.ordinalsKey(roadmapId));
    if (userId) {
      await this.cache.del(this.activeKey(userId));
    }
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.cache.del(this.activeKey(userId));
  }
}
