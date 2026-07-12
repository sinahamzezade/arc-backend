import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ContentPoolModule } from '../content-pool/content-pool.module';
import { CourseTimingModule } from '../course-timing/course-timing.module';
import { Goal } from '../goals/entities/goal.entity';
import { SkillGraphModule } from '../skill-graph/skill-graph.module';
import { Lesson } from './entities/lesson.entity';
import { LessonProgress } from './entities/lesson-progress.entity';
import { Milestone } from './entities/milestone.entity';
import { Roadmap } from './entities/roadmap.entity';
import { RoadmapGenerationJob } from './entities/roadmap-generation-job.entity';
import { RoadmapPhase } from './entities/roadmap-phase.entity';
import { RoadmapGeneratorService } from './roadmap-generator.service';
import { RoadmapAiService } from './roadmap-ai.service';
import { RoadmapJobsProcessor } from './roadmap-jobs.processor';
import { RoadmapsController } from './roadmaps.controller';
import { RoadmapsService } from './roadmaps.service';

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
    ]),
    AuthModule,
    SkillGraphModule,
    ContentPoolModule,
    CourseTimingModule,
  ],
  controllers: [RoadmapsController],
  providers: [
    RoadmapsService,
    RoadmapGeneratorService,
    RoadmapJobsProcessor,
    RoadmapAiService,
  ],
  exports: [RoadmapsService, RoadmapGeneratorService],
})
export class RoadmapsModule {}
