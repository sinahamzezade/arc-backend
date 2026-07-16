import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';

type MemoryEntry = { value: string; expiresAt: number };

@Injectable()
export class JsonCacheService {
  private readonly logger = new Logger(JsonCacheService.name);
  private readonly defaultTtlSec: number;
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.defaultTtlSec = Number(config.get<string>('CACHE_DEFAULT_TTL_SEC') ?? 300);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.getRaw(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      await this.del(key);
      return null;
    }
  }

  async setJson<T>(
    key: string,
    value: T,
    ttlSec = this.defaultTtlSec,
  ): Promise<void> {
    await this.setRaw(key, JSON.stringify(value), ttlSec);
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    if (this.redis.isAvailable && this.redis.raw) {
      await this.redis.raw.del(...keys);
    }
    for (const key of keys) {
      this.memory.delete(key);
    }
  }

  async delByPrefix(prefix: string): Promise<number> {
    let removed = 0;
    if (this.redis.isAvailable && this.redis.raw) {
      const client = this.redis.raw;
      let cursor = '0';
      do {
        const [next, keys] = await client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length) {
          await client.del(...keys);
          removed += keys.length;
        }
      } while (cursor !== '0');
    }

    for (const key of [...this.memory.keys()]) {
      if (key.startsWith(prefix)) {
        this.memory.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  private async getRaw(key: string): Promise<string | null> {
    if (this.redis.isAvailable) {
      return this.redis.get(key);
    }
    const row = this.memory.get(key);
    if (!row) return null;
    if (row.expiresAt > 0 && row.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return row.value;
  }

  private async setRaw(
    key: string,
    value: string,
    ttlSec: number,
  ): Promise<void> {
    await this.redis.set(key, value, ttlSec);
    this.memory.set(key, {
      value,
      expiresAt: ttlSec > 0 ? Date.now() + ttlSec * 1000 : 0,
    });
  }
}
