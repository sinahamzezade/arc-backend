import { Global, Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  REDIS_CLIENT,
  REDIS_PUB_CLIENT,
  REDIS_SUB_CLIENT,
} from './redis.constants';
import { resolveRedisUrl } from './resolve-redis-url';
import { RedisService } from './redis.service';

function createRedisClient(url: string, label: string): Redis {
  const logger = new Logger(`Redis:${label}`);
  const client = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  client.on('error', (err) => logger.warn(err.message));
  void client.connect().catch((err: Error) => {
    logger.warn(`connect failed: ${err.message}`);
  });
  return client;
}

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis | null => {
        const url = resolveRedisUrl(
          config.get<string>('REDIS_URL'),
          config.get<string>('NODE_ENV'),
        );
        if (!url) return null;
        return createRedisClient(url, 'main');
      },
    },
    {
      provide: REDIS_PUB_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis | null => {
        const url = resolveRedisUrl(
          config.get<string>('REDIS_URL'),
          config.get<string>('NODE_ENV'),
        );
        if (!url) return null;
        return createRedisClient(url, 'pub');
      },
    },
    {
      provide: REDIS_SUB_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis | null => {
        const url = resolveRedisUrl(
          config.get<string>('REDIS_URL'),
          config.get<string>('NODE_ENV'),
        );
        if (!url) return null;
        return createRedisClient(url, 'sub');
      },
    },
    RedisService,
  ],
  exports: [
    RedisService,
    REDIS_CLIENT,
    REDIS_PUB_CLIENT,
    REDIS_SUB_CLIENT,
  ],
})
export class RedisModule {}
