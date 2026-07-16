import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private memory = new Map<string, { value: string; expiresAt: number }>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis | null,
  ) {}

  get isAvailable(): boolean {
    return this.client != null && this.client.status === 'ready';
  }

  get raw(): Redis | null {
    return this.client;
  }

  onModuleInit() {
    if (!this.client) {
      this.logger.log('Redis unavailable — using in-memory fallback');
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.client) {
      return this.client.get(key);
    }
    const row = this.memory.get(key);
    if (!row) return null;
    if (row.expiresAt > 0 && row.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return row.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.client) {
      if (ttlSeconds && ttlSeconds > 0) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
      return;
    }
    this.memory.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : 0,
    });
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    if (this.client) {
      await this.client.del(...keys);
      return;
    }
    for (const key of keys) {
      this.memory.delete(key);
    }
  }

  async incr(key: string): Promise<number> {
    if (this.client) {
      return this.client.incr(key);
    }
    const current = Number((await this.get(key)) ?? '0');
    const next = current + 1;
    await this.set(key, String(next));
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (this.client) {
      await this.client.expire(key, ttlSeconds);
      return;
    }
    const row = this.memory.get(key);
    if (row) {
      row.expiresAt = Date.now() + ttlSeconds * 1000;
    }
  }
}
