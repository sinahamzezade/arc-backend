import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JsonCacheService } from '../common/cache/json-cache.service';
import { Profile } from './entities/profile.entity';

export type ProfileMini = {
  userId: string;
  displayName: string | null;
  username: string | null;
};

@Injectable()
export class ProfileCacheService {
  private readonly ttlSec: number;

  constructor(
    private readonly cache: JsonCacheService,
    config: ConfigService,
  ) {
    this.ttlSec = Number(config.get<string>('PROFILE_CACHE_TTL_SEC') ?? 60);
  }

  private key(userId: string): string {
    return `profile:mini:${userId}`;
  }

  toMini(profile: Profile): ProfileMini {
    return {
      userId: profile.userId,
      displayName: profile.displayName,
      username: profile.username,
    };
  }

  async get(userId: string): Promise<ProfileMini | null> {
    return this.cache.getJson<ProfileMini>(this.key(userId));
  }

  async set(profile: Profile): Promise<void> {
    await this.cache.setJson(this.key(profile.userId), this.toMini(profile), this.ttlSec);
  }

  async setMany(profiles: Profile[]): Promise<void> {
    await Promise.all(profiles.map((profile) => this.set(profile)));
  }

  async invalidate(userId: string): Promise<void> {
    await this.cache.del(this.key(userId));
  }
}
