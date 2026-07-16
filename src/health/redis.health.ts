import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { RedisService } from '../common/redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    if (!this.redis.isAvailable) {
      return this.getStatus(key, true, { optional: true });
    }
    const pong = await this.redis.raw?.ping();
    const isHealthy = pong === 'PONG';
    return this.getStatus(key, isHealthy);
  }
}
