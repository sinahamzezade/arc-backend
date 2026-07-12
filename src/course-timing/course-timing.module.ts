import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentPoolModule } from '../content-pool/content-pool.module';
import { Goal } from '../goals/entities/goal.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { Profile } from '../profiles/entities/profile.entity';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { CapacityService } from './capacity.service';
import { CourseSchedule } from './entities/course-schedule.entity';
import { LearningCommitment } from './entities/learning-commitment.entity';
import { PaceSnapshot } from './entities/pace-snapshot.entity';
import { ReminderPlan } from './entities/reminder-plan.entity';
import { ScheduleChange } from './entities/schedule-change.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';
import { PaceEngineService } from './pace-engine.service';
import { ReminderPlannerService } from './reminder-planner.service';
import { ScheduleBuilderService } from './schedule-builder.service';
import { TimingAnalyticsService } from './timing-analytics.service';
import { TimingController } from './timing.controller';
import { TimingJobsProcessor } from './timing-jobs.processor';
import { TimingService } from './timing.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      LearningCommitment,
      CourseSchedule,
      ScheduleSlot,
      PaceSnapshot,
      ReminderPlan,
      ScheduleChange,
      Goal,
      Roadmap,
      Lesson,
      Profile,
    ]),
    NotificationsModule,
    ContentPoolModule,
  ],
  controllers: [TimingController],
  providers: [
    TimingService,
    CapacityService,
    ScheduleBuilderService,
    PaceEngineService,
    ReminderPlannerService,
    TimingAnalyticsService,
    TimingJobsProcessor,
  ],
  exports: [TimingService, CapacityService, TimingJobsProcessor],
})
export class CourseTimingModule {}
