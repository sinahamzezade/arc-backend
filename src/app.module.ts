import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { typeOrmPostgresConfig } from './common/database/typeorm-postgres.config';
import { JobsModule } from './common/jobs/jobs.module';
import { RequestIdMiddleware } from './common/logging/request-id.middleware';
import { MetricsInterceptor } from './common/metrics/metrics.interceptor';
import { CacheModule } from './common/cache/cache.module';
import { RedisModule } from './common/redis/redis.module';
import { resolveRedisUrl } from './common/redis/resolve-redis-url';
import { RedisThrottlerStorage } from './common/throttler/redis-throttler.storage';
import { ThrottlerStorageModule } from './common/throttler/throttler-storage.module';
import { LlmModule } from './common/llm/llm.module';
import { CoachModule } from './coach/coach.module';
import { ContentPoolModule } from './content-pool/content-pool.module';
import { GoalsModule } from './goals/goals.module';
import { HealthModule } from './health/health.module';
import { LessonsModule } from './lessons/lessons.module';
import { GamificationModule } from './gamification/gamification.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProfilesModule } from './profiles/profiles.module';
import { QuestionnaireModule } from './questionnaire/questionnaire.module';
import { RoadmapsModule } from './roadmaps/roadmaps.module';
import { SkillGraphModule } from './skill-graph/skill-graph.module';
import { UsersModule } from './users/users.module';
import { WeeksModule } from './weeks/weeks.module';
import { LeaguesModule } from './leagues/leagues.module';
import { BattlesModule } from './battles/battles.module';
import { ReferralsModule } from './referrals/referrals.module';
import { SocialModule } from './social/social.module';
import { CourseTimingModule } from './course-timing/course-timing.module';
import { LuckyWheelModule } from './lucky-wheel/lucky-wheel.module';
import { RanksModule } from './ranks/ranks.module';
import { StudyTogetherModule } from './study-together/study-together.module';
import { ChatModule } from './chat/chat.module';
import { CallsModule } from './calls/calls.module';
import { UploadsModule } from './uploads/uploads.module';
import { BadgesModule } from './badges/badges.module';
import { QuestsModule } from './quests/quests.module';
import { SystemFlagsModule } from './system-flags/system-flags.module';

const redisUrl = resolveRedisUrl();

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: false,
        customProps: (req) => ({
          requestId: req.headers['x-request-id'],
        }),
      },
    }),
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
    RedisModule,
    CacheModule,
    ThrottlerModule.forRootAsync({
      imports: [ThrottlerStorageModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ ttl: 60_000, limit: 100 }],
        storage,
      }),
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        typeOrmPostgresConfig(config, { autoLoadEntities: true }),
    }),
    JobsModule,
    HealthModule,
    LlmModule,
    SystemFlagsModule,
    UsersModule,
    ProfilesModule,
    AuthModule,
    AdminModule,
    GoalsModule,
    SkillGraphModule,
    ContentPoolModule,
    CourseTimingModule,
    RoadmapsModule,
    LessonsModule,
    GamificationModule,
    WeeksModule,
    CoachModule,
    QuestionnaireModule,
    NotificationsModule,
    LeaguesModule,
    BattlesModule,
    ReferralsModule,
    SocialModule,
    LuckyWheelModule,
    RanksModule,
    StudyTogetherModule,
    ChatModule,
    CallsModule,
    UploadsModule,
    BadgesModule,
    QuestsModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: MetricsInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
