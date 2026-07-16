import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { RedisThrottlerStorage } from './redis-throttler.storage';

@Module({
  imports: [RedisModule],
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class ThrottlerStorageModule {}
