import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { typeOrmPostgresConfig } from './common/database/typeorm-postgres.config';
import { LlmModule } from './common/llm/llm.module';
import { CoachModule } from './coach/coach.module';
import { ContentPoolModule } from './content-pool/content-pool.module';
import { GoalsModule } from './goals/goals.module';
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
import { BadgesModule } from './badges/badges.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        typeOrmPostgresConfig(config, { autoLoadEntities: true }),
    }),
    LlmModule,
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
    BadgesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
