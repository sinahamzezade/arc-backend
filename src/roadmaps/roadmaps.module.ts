import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ContentPoolModule } from '../content-pool/content-pool.module';
import { CourseTimingModule } from '../course-timing/course-timing.module';
import { Goal } from '../goals/entities/goal.entity';
import { QuestionnaireResponse } from '../questionnaire/entities/questionnaire-response.entity';
import { CourseTemplate } from '../content-pool/entities/course-template.entity';
import { ModuleTemplate } from '../content-pool/entities/module-template.entity';
import { SkillGraphModule } from '../skill-graph/skill-graph.module';
import { Lesson } from './entities/lesson.entity';
import { LessonProgress } from './entities/lesson-progress.entity';
import { Milestone } from './entities/milestone.entity';
import { Roadmap } from './entities/roadmap.entity';
import { RoadmapGenerationJob } from './entities/roadmap-generation-job.entity';
import { RoadmapPhase } from './entities/roadmap-phase.entity';
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
import { RoadmapPersistenceService } from './roadmap-persistence.service';
import { RoadmapReplanBullProcessor } from './roadmap-replan.processor';
import { RoadmapSnapshotService } from './roadmap-snapshot.service';
import { RoadmapsService } from './roadmaps.service';
import { RoadmapsController } from './roadmaps.controller';
import { resolveRedisUrl } from '../common/redis/resolve-redis-url';

const redisUrl = resolveRedisUrl();

const bullImports = redisUrl
  ? [
      BullModule.forRoot({
        connection: { url: redisUrl },
      }),
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
      QuestionnaireResponse,
      CourseTemplate,
      ModuleTemplate,
    ]),
    AuthModule,
    SkillGraphModule,
    ContentPoolModule,
    CourseTimingModule,
    ...bullImports,
  ],
  controllers: [RoadmapsController],
  providers: [
    RoadmapsService,
    RoadmapGeneratorService,
    RoadmapLegacyAssembler,
    RoadmapLlmPlannerService,
    RoadmapJobsProcessor,
    RoadmapEngineClient,
    RoadmapSnapshotService,
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
  ],
})
export class RoadmapsModule {}
