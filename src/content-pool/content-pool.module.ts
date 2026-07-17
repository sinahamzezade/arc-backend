import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Goal } from '../goals/entities/goal.entity';
import { LessonBodyAiModule } from '../lessons/lesson-body-ai.module';
import { Profile } from '../profiles/entities/profile.entity';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { Milestone } from '../roadmaps/entities/milestone.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { RoadmapPhase } from '../roadmaps/entities/roadmap-phase.entity';
import { AssessmentTemplate } from '../skill-graph/entities/assessment-template.entity';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import { Resource } from '../skill-graph/entities/resource.entity';
import { RoleRecipe } from '../skill-graph/entities/role-recipe.entity';
import { SkillNode } from '../skill-graph/entities/skill-node.entity';
import { TechStack } from '../skill-graph/entities/tech-stack.entity';
import { SkillGraphModule } from '../skill-graph/skill-graph.module';
import { User } from '../users/entities/user.entity';
import { AdminRolesGuard } from '../common/guards/admin-roles.guard';
import { ContentAdminController } from './admin/content-admin.controller';
import { ContentAnalyticsService } from './content-analytics.service';
import { ContentCacheService } from './content-cache.service';
import { ContentCatalogService } from './content-catalog.service';
import { ContentPersonalizationService } from './content-personalization.service';
import { ContentPublicationService } from './content-publication.service';
import { ContentQualityService } from './content-quality.service';
import { ContentQueryService } from './content-query.service';
import { ContentVersionService } from './content-version.service';
import { CareerRole } from './entities/career-role.entity';
import { ContentAuditLog } from './entities/content-audit-log.entity';
import { ContentCategory } from './entities/content-category.entity';
import { ContentTag } from './entities/content-tag.entity';
import { CourseTemplate } from './entities/course-template.entity';
import { Dataset } from './entities/dataset.entity';
import { LessonVersion } from './entities/lesson-version.entity';
import { ModuleTemplate } from './entities/module-template.entity';
import { QuestionTemplate } from './entities/question-template.entity';
import { QuestionVersion } from './entities/question-version.entity';
import { Skill } from './entities/skill.entity';
import { SkillPrerequisite } from './entities/skill-prerequisite.entity';
import { Unit } from './entities/unit.entity';
import { LiveContextSnippet } from './entities/live-context-snippet.entity';
import { UnitsCatalogService } from './units-catalog.service';
import { BattleCatalogService } from './battle-catalog.service';
import { BattleQuestionLlmService } from './battle-question-llm.service';
import { QuestionPoolService } from './question-pool.service';
import { BattleQuestionSeedService } from './seeds/battle-question.seed';
import { EngagementSchemaService } from './engagement-schema.service';
import { LiveContextService } from './live-context.service';
import { LiveContextSeedService } from './seeds/live-context.seed';

/**
 * Central content pool — shared authoring catalog.
 * Extends skill-graph entities; does not own user progress.
 */
@Module({
  imports: [
    SkillGraphModule,
    LessonBodyAiModule,
    TypeOrmModule.forFeature([
      CareerRole,
      ContentCategory,
      ContentTag,
      SkillPrerequisite,
      CourseTemplate,
      ModuleTemplate,
      LessonVersion,
      QuestionTemplate,
      QuestionVersion,
      Dataset,
      ContentAuditLog,
      Skill,
      Unit,
      LiveContextSnippet,
      LessonTemplate,
      RoleRecipe,
      SkillNode,
      Resource,
      TechStack,
      AssessmentTemplate,
      Goal,
      Profile,
      User,
      Roadmap,
      RoadmapPhase,
      Milestone,
      Lesson,
    ]),
  ],
  controllers: [ContentAdminController],
  providers: [
    ContentQueryService,
    ContentPublicationService,
    ContentVersionService,
    ContentPersonalizationService,
    QuestionPoolService,
    BattleCatalogService,
    BattleQuestionLlmService,
    ContentAnalyticsService,
    ContentCacheService,
    ContentCatalogService,
    ContentQualityService,
    UnitsCatalogService,
    BattleQuestionSeedService,
    EngagementSchemaService,
    LiveContextService,
    LiveContextSeedService,
    AdminRolesGuard,
  ],
  exports: [
    ContentQueryService,
    ContentPublicationService,
    ContentVersionService,
    ContentPersonalizationService,
    QuestionPoolService,
    BattleCatalogService,
    BattleQuestionLlmService,
    ContentAnalyticsService,
    ContentQualityService,
    ContentCatalogService,
    UnitsCatalogService,
    LiveContextService,
    TypeOrmModule,
    SkillGraphModule,
  ],
})
export class ContentPoolModule {}
