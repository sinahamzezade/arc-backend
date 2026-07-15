import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { resolveRedisUrl } from '../common/redis/resolve-redis-url';
import { Goal } from '../goals/entities/goal.entity';
import { LearnerProfileSnapshot } from '../questionnaire/entities/learner-profile-snapshot.entity';
import { QuestionnaireResponse } from '../questionnaire/entities/questionnaire-response.entity';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { SystemFlagsModule } from '../system-flags/system-flags.module';
import {
  LESSON_BODY_PERSONALIZATION_QUEUE,
  LessonBodyPersonalizationBullProcessor,
  LessonBodyPersonalizationJobs,
} from './lesson-body-personalization.jobs';
import { LessonBodyPersonalizerService } from './lesson-body-personalizer.service';

const redisUrl = resolveRedisUrl();

const bullImports = redisUrl
  ? [
      BullModule.forRoot({
        connection: { url: redisUrl },
      }),
      BullModule.registerQueue({ name: LESSON_BODY_PERSONALIZATION_QUEUE }),
    ]
  : [];

const nullQueueProviders = redisUrl
  ? []
  : [
      {
        provide: getQueueToken(LESSON_BODY_PERSONALIZATION_QUEUE),
        useValue: null,
      },
    ];

const bullProviders = redisUrl ? [LessonBodyPersonalizationBullProcessor] : [];

/**
 * Isolated so ContentPool can enqueue body personalization without
 * importing LessonsModule (avoids ContentPool ↔ Lessons circular load).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Lesson,
      Roadmap,
      Goal,
      QuestionnaireResponse,
      LearnerProfileSnapshot,
    ]),
    SystemFlagsModule,
    ...bullImports,
  ],
  providers: [
    LessonBodyPersonalizerService,
    LessonBodyPersonalizationJobs,
    ...nullQueueProviders,
    ...bullProviders,
  ],
  exports: [LessonBodyPersonalizationJobs, LessonBodyPersonalizerService],
})
export class LessonBodyAiModule {}
