import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module, forwardRef } from '@nestjs/common';
import { BattlesModule } from '../../battles/battles.module';
import { CourseTimingModule } from '../../course-timing/course-timing.module';
import { GamificationModule } from '../../gamification/gamification.module';
import { StudyTogetherModule } from '../../study-together/study-together.module';
import { resolveRedisUrl } from '../redis/resolve-redis-url';
import {
  MAINTENANCE_QUEUE,
  SCHEDULED_QUEUE,
} from './jobs.constants';
import { MaintenanceBullProcessor } from './maintenance.processor';
import {
  MaintenanceJobsRegistrar,
  ScheduledBullProcessor,
  ScheduledJobsRegistrar,
} from './scheduled.processor';

const redisUrl = resolveRedisUrl();

const bullImports = redisUrl
  ? [
      BullModule.registerQueue(
        { name: MAINTENANCE_QUEUE },
        { name: SCHEDULED_QUEUE },
      ),
    ]
  : [];

const nullQueueProviders = redisUrl
  ? []
  : [
      { provide: getQueueToken(MAINTENANCE_QUEUE), useValue: null },
      { provide: getQueueToken(SCHEDULED_QUEUE), useValue: null },
    ];

const bullProviders = redisUrl
  ? [
      MaintenanceBullProcessor,
      ScheduledBullProcessor,
      MaintenanceJobsRegistrar,
      ScheduledJobsRegistrar,
    ]
  : [];

@Module({
  imports: [
    ...bullImports,
    forwardRef(() => BattlesModule),
    forwardRef(() => StudyTogetherModule),
    forwardRef(() => CourseTimingModule),
    forwardRef(() => GamificationModule),
  ],
  providers: [...nullQueueProviders, ...bullProviders],
})
export class JobsModule {}
