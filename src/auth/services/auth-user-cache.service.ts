import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthUserPayload } from '../../common/decorators/current-user.decorator';
import { RedisService } from '../../common/redis/redis.service';

const CACHE_PREFIX = 'auth:user:';

@Injectable()
export class AuthUserCacheService {
  private readonly ttlSeconds: number;
  private readonly memory = new Map<
    string,
    { payload: AuthUserPayload; expiresAt: number }
  >();

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds = Number(config.get<string>('JWT_USER_CACHE_TTL_SEC') ?? 60);
  }

  async get(userId: string): Promise<AuthUserPayload | null> {
    const key = `${CACHE_PREFIX}${userId}`;
    const raw = await this.redis.get(key);
    if (raw) {
      try {
        return JSON.parse(raw) as AuthUserPayload;
      } catch {
        await this.redis.del(key);
      }
    }

    const mem = this.memory.get(userId);
    if (!mem) return null;
    if (mem.expiresAt <= Date.now()) {
      this.memory.delete(userId);
      return null;
    }
    return mem.payload;
  }

  async set(userId: string, payload: AuthUserPayload): Promise<void> {
    const key = `${CACHE_PREFIX}${userId}`;
    const serialized = JSON.stringify(payload);
    await this.redis.set(key, serialized, this.ttlSeconds);
    this.memory.set(userId, {
      payload,
      expiresAt: Date.now() + this.ttlSeconds * 1000,
    });
  }

  async invalidate(userId: string): Promise<void> {
    const key = `${CACHE_PREFIX}${userId}`;
    await this.redis.del(key);
    this.memory.delete(userId);
  }
}
