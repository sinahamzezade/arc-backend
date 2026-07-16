import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { RedisHealthIndicator } from './redis.health';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /** Full check (DB + Redis). */
  @Get()
  @HealthCheck()
  check() {
    return this.readinessChecks();
  }

  /** Process alive — no dependency checks. */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }

  /** Ready for traffic — DB required; Redis when configured. */
  @Get('readiness')
  @HealthCheck()
  readiness() {
    return this.readinessChecks();
  }

  private readinessChecks() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
