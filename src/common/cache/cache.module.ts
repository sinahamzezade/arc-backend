import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { JsonCacheService } from './json-cache.service';

@Global()
@Module({
  imports: [RedisModule],
  providers: [JsonCacheService],
  exports: [JsonCacheService],
})
export class CacheModule {}
