import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RankDefinition } from './entities/rank-definition.entity';
import { UserRankState } from './entities/user-rank-state.entity';

/**
 * Resolves each user's current rank iconAssetKey for avatar slots.
 * Prefer upload paths (`/uploads/ranks/...`); seed keys still returned for client fallback.
 */
@Injectable()
export class RankAvatarService {
  constructor(
    @InjectRepository(UserRankState)
    private readonly states: Repository<UserRankState>,
    @InjectRepository(RankDefinition)
    private readonly defs: Repository<RankDefinition>,
  ) {}

  async iconKeysByUserIds(
    userIds: string[],
  ): Promise<Map<string, string | null>> {
    const unique = [...new Set(userIds.filter(Boolean))];
    const map = new Map<string, string | null>();
    for (const id of unique) map.set(id, null);
    if (!unique.length) return map;

    const states = await this.states.find({
      where: { userId: In(unique) },
    });
    if (!states.length) return map;

    const levels = [...new Set(states.map((s) => s.currentRankLevel))];
    const defs = await this.defs.find({
      where: { level: In(levels), isActive: true },
    });
    const defByLevel = new Map(defs.map((d) => [d.level, d]));

    for (const state of states) {
      if (state.hideFromProfile) {
        map.set(state.userId, null);
        continue;
      }
      const def = defByLevel.get(state.currentRankLevel);
      map.set(state.userId, def?.iconAssetKey ?? null);
    }
    return map;
  }

  async iconKeyForUser(userId: string): Promise<string | null> {
    const map = await this.iconKeysByUserIds([userId]);
    return map.get(userId) ?? null;
  }
}
