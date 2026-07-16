import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ContentPoolModule } from '../content-pool/content-pool.module';
import { CourseTimingModule } from '../course-timing/course-timing.module';
import { GamificationModule } from '../gamification/gamification.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { LessonProgress } from '../roadmaps/entities/lesson-progress.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { RoadmapsModule } from '../roadmaps/roadmaps.module';
import { SystemFlagsModule } from '../system-flags/system-flags.module';
import { WeeksModule } from '../weeks/weeks.module';
import { LessonAttempt } from './entities/lesson-attempt.entity';
import { LessonCompletionResult } from './entities/lesson-completion-result.entity';
import { RemediationEvent } from './entities/remediation-event.entity';
import { UserBadge } from '../badges/entities/user-badge.entity';
import { LessonArloService } from './lesson-arlo.service';
import { LessonBodyAiModule } from './lesson-body-ai.module';
import { LessonCompletionOrchestrator } from './lesson-completion.orchestrator';
import { LessonContentService } from './lesson-content.service';
import { LessonRemediationService } from './lesson-remediation.service';
import { LessonRewardsService } from './lesson-rewards.service';
import { LessonUnlockService } from './lesson-unlock.service';
import { LessonsController } from './lessons.controller';
import { LessonsService } from './lessons.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Lesson,
      LessonProgress,
      Roadmap,
      UserBadge,
      LessonAttempt,
      LessonCompletionResult,
      RemediationEvent,
    ]),
    AuthModule,
    ProfilesModule,
    GamificationModule,
    ContentPoolModule,
    forwardRef(() => RoadmapsModule),
    CourseTimingModule,
    SystemFlagsModule,
    LessonBodyAiModule,
    forwardRef(() => WeeksModule),
  ],
  controllers: [LessonsController],
  providers: [
    LessonsService,
    LessonContentService,
    LessonRemediationService,
    LessonRewardsService,
    LessonUnlockService,
    LessonCompletionOrchestrator,
    LessonArloService,
  ],
  exports: [LessonsService, LessonContentService, LessonBodyAiModule],
})
export class LessonsModule {}
