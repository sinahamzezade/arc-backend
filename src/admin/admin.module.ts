import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { BadgeDefinition } from '../badges/entities/badge-definition.entity';
import { QuestDefinition } from '../quests/entities/quest-definition.entity';
import { Battle } from '../battles/entities/battle.entity';
import { ContentPoolModule } from '../content-pool/content-pool.module';
import { CareerRole } from '../content-pool/entities/career-role.entity';
import { CourseTemplate } from '../content-pool/entities/course-template.entity';
import { Dataset } from '../content-pool/entities/dataset.entity';
import { ModuleTemplate } from '../content-pool/entities/module-template.entity';
import { Goal } from '../goals/entities/goal.entity';
import { RewardLedgerEntry } from '../gamification/entities/reward-ledger-entry.entity';
import { StoreItem } from '../gamification/entities/store-item.entity';
import { WheelCampaign } from '../lucky-wheel/entities/wheel-campaign.entity';
import { WheelSegmentRule } from '../lucky-wheel/entities/wheel-segment-rule.entity';
import { Profile } from '../profiles/entities/profile.entity';
import { QuestionnaireDefinition } from '../questionnaire/entities/questionnaire-definition.entity';
import { QuestionnaireOption } from '../questionnaire/entities/questionnaire-option.entity';
import { QuestionnaireStep } from '../questionnaire/entities/questionnaire-step.entity';
import { QuestionnaireModule } from '../questionnaire/questionnaire.module';
import { RankDefinition } from '../ranks/entities/rank-definition.entity';
import { UserRankState } from '../ranks/entities/user-rank-state.entity';
import { ReferralAttribution } from '../referrals/entities/referral-attribution.entity';
import { LessonProgress } from '../roadmaps/entities/lesson-progress.entity';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { AdminAnalyticsService } from './admin-analytics.service';
import { AdminAuthService } from './admin-auth.service';
import { AdminBadgeIconService } from './admin-badge-icon.service';
import { AdminRankIconService } from './admin-rank-icon.service';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminQuestionnaireService } from './admin-questionnaire.service';
import { AdminRolesService } from './admin-roles.service';
import { AdminRoadmapEngineService } from './admin-roadmap-engine.service';
import { AdminSkillGraphService } from './admin-skill-graph.service';
import { AdminUserResetService } from './admin-user-reset.service';
import { AdminController } from './admin.controller';
import { AdminSeedService } from './admin-seed.service';
import { AdminSessionGuard } from './guards/admin-session.guard';
import { SkillGraphModule } from '../skill-graph/skill-graph.module';
import { SystemFlagsModule } from '../system-flags/system-flags.module';
import { GamificationModule } from '../gamification/gamification.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [
    UsersModule,
    AuthModule,
    RoadmapsModule,
    ContentPoolModule,
    QuestionnaireModule,
    SkillGraphModule,
    SystemFlagsModule,
    GamificationModule,
    UploadsModule,
    TypeOrmModule.forFeature([
      Profile,
      User,
      Goal,
      LessonProgress,
      RewardLedgerEntry,
      UserRankState,
      Battle,
      ReferralAttribution,
      RankDefinition,
      StoreItem,
      BadgeDefinition,
      QuestDefinition,
      WheelCampaign,
      WheelSegmentRule,
      CourseTemplate,
      ModuleTemplate,
      Dataset,
      CareerRole,
      QuestionnaireDefinition,
      QuestionnaireStep,
      QuestionnaireOption,
    ]),
  ],
  controllers: [AdminController],
  providers: [
    AdminAuthService,
    AdminSessionGuard,
    AdminSeedService,
    AdminAnalyticsService,
    AdminCatalogService,
    AdminRoadmapEngineService,
    AdminBadgeIconService,
    AdminRankIconService,
    AdminRolesService,
    AdminQuestionnaireService,
    AdminSkillGraphService,
    AdminUserResetService,
  ],
})
export class AdminModule {}
