import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ContentPoolModule } from '../content-pool/content-pool.module';
import { CourseTimingModule } from '../course-timing/course-timing.module';
import { Goal } from '../goals/entities/goal.entity';
import { LearnerProfileSnapshot } from '../questionnaire/entities/learner-profile-snapshot.entity';
import { QuestionnaireResponse } from '../questionnaire/entities/questionnaire-response.entity';
import { CourseTemplate } from '../content-pool/entities/course-template.entity';
import { ModuleTemplate } from '../content-pool/entities/module-template.entity';
import { SkillGraphModule } from '../skill-graph/skill-graph.module';
import { SystemFlagsModule } from '../system-flags/system-flags.module';
import { Lesson } from './entities/lesson.entity';
import { LessonProgress } from './entities/lesson-progress.entity';
import { Milestone } from './entities/milestone.entity';
import { Roadmap } from './entities/roadmap.entity';
import { RoadmapGenerationJob } from './entities/roadmap-generation-job.entity';
import { RoadmapPhase } from './entities/roadmap-phase.entity';
import { RoadmapCacheService } from './roadmap-cache.service';
import { RoadmapAnalyticsService } from './roadmap-analytics.service';
import { RoadmapAiService } from './roadmap-ai.service';
import { RoadmapEngineClient } from './roadmap-engine.client';
import {
  ROADMAP_GENERATION_QUEUE,
  ROADMAP_REPLAN_QUEUE,
  RoadmapGenerationBullProcessor,
  RoadmapJobsProcessor,
} from './roadmap-generation.processor';
import { RoadmapGeneratorService } from './roadmap-generator.service';
import { RoadmapLegacyAssembler } from './roadmap-legacy.assembler';
import { RoadmapLlmPlannerService } from './roadmap-llm-planner.service';
import { RoadmapNarratorService } from './roadmap-narrator.service';
import { RoadmapPersistenceService } from './roadmap-persistence.service';
import { RoadmapPipelineService } from './roadmap-pipeline.service';
import { RoadmapReplanBullProcessor } from './roadmap-replan.processor';
import { RoadmapSnapshotService } from './roadmap-snapshot.service';
import { RoadmapTreeLoader } from './roadmap-tree.loader';
import { RoadmapsService } from './roadmaps.service';
import { RoadmapsController } from './roadmaps.controller';
import { resolveRedisUrl } from '../common/redis/resolve-redis-url';

const redisUrl = resolveRedisUrl();

const bullImports = redisUrl
  ? [
      BullModule.registerQueue(
        { name: ROADMAP_GENERATION_QUEUE },
        { name: ROADMAP_REPLAN_QUEUE },
      ),
    ]
  : [];

/** Null queue tokens so @Optional() @InjectQueue works without Redis. */
const nullQueueProviders = redisUrl
  ? []
  : [
      { provide: getQueueToken(ROADMAP_GENERATION_QUEUE), useValue: null },
      { provide: getQueueToken(ROADMAP_REPLAN_QUEUE), useValue: null },
    ];

const bullProviders = redisUrl
  ? [RoadmapGenerationBullProcessor, RoadmapReplanBullProcessor]
  : [];

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Roadmap,
      RoadmapPhase,
      Milestone,
      Lesson,
      LessonProgress,
      RoadmapGenerationJob,
      Goal,
      LearnerProfileSnapshot,
      QuestionnaireResponse,
      CourseTemplate,
      ModuleTemplate,
    ]),
    AuthModule,
    SkillGraphModule,
    ContentPoolModule,
    CourseTimingModule,
    SystemFlagsModule,
    ...bullImports,
  ],
  controllers: [RoadmapsController],
  providers: [
    RoadmapsService,
    RoadmapGeneratorService,
    RoadmapLegacyAssembler,
    RoadmapLlmPlannerService,
    RoadmapNarratorService,
    RoadmapPipelineService,
    RoadmapJobsProcessor,
    RoadmapEngineClient,
    RoadmapSnapshotService,
    RoadmapCacheService,
    RoadmapTreeLoader,
    RoadmapPersistenceService,
    RoadmapAnalyticsService,
    RoadmapAiService,
    ...nullQueueProviders,
    ...bullProviders,
  ],
  exports: [
    RoadmapsService,
    RoadmapGeneratorService,
    RoadmapEngineClient,
    RoadmapSnapshotService,
    RoadmapCacheService,
    RoadmapTreeLoader,
  ],
})
export class RoadmapsModule {}
