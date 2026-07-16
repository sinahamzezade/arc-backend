import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BattlesModule } from './battles/battles.module';
import { typeOrmPostgresConfig } from './common/database/typeorm-postgres.config';
import { JobsModule } from './common/jobs/jobs.module';
import { RedisModule } from './common/redis/redis.module';
import { resolveRedisUrl } from './common/redis/resolve-redis-url';
import { CourseTimingModule } from './course-timing/course-timing.module';
import { GamificationModule } from './gamification/gamification.module';
import { StudyTogetherModule } from './study-together/study-together.module';

const redisUrl = resolveRedisUrl();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ...(redisUrl
      ? [
          BullModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => ({
              connection: {
                url: resolveRedisUrl(
                  config.get<string>('REDIS_URL'),
                  config.get<string>('NODE_ENV'),
                ),
              },
            }),
          }),
        ]
      : []),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        typeOrmPostgresConfig(config, { autoLoadEntities: true }),
    }),
    RedisModule,
    JobsModule,
    BattlesModule,
    StudyTogetherModule,
    CourseTimingModule,
    GamificationModule,
  ],
})
export class WorkerModule {}
