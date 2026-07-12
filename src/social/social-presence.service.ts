import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

const PRESENCE_TTL_SEC = 120;

/**
 * Online presence — Redis key presence:user:{id} TTL 120s, else in-memory.
 * Client heartbeat every ~60s while visible.
 */
@Injectable()
export class SocialPresenceService implements OnModuleDestroy {
  private readonly logger = new Logger(SocialPresenceService.name);
  private redis: Redis | null = null;
  private readonly memory = new Map<string, number>();

  constructor() {
    const url = process.env.REDIS_URL?.trim();
    if (url) {
      try {
        this.redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
        void this.redis.connect().catch(() => {
          this.logger.warn('Presence Redis connect failed — using memory');
          this.redis = null;
        });
      } catch {
        this.redis = null;
      }
    }
  }

  async onModuleDestroy() {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }

  async heartbeat(userId: string) {
    const key = `presence:user:${userId}`;
    if (this.redis) {
      await this.redis.set(key, '1', 'EX', PRESENCE_TTL_SEC);
      return { online: true, ttlSec: PRESENCE_TTL_SEC };
    }
    this.memory.set(userId, Date.now() + PRESENCE_TTL_SEC * 1000);
    return { online: true, ttlSec: PRESENCE_TTL_SEC };
  }

  async isOnline(userId: string): Promise<boolean> {
    if (this.redis) {
      const v = await this.redis.get(`presence:user:${userId}`);
      return Boolean(v);
    }
    const until = this.memory.get(userId);
    if (!until) return false;
    if (until < Date.now()) {
      this.memory.delete(userId);
      return false;
    }
    return true;
  }

  async areOnline(userIds: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    await Promise.all(
      userIds.map(async (id) => {
        if (await this.isOnline(id)) out.add(id);
      }),
    );
    return out;
  }
}
