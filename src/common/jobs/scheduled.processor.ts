import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue } from 'bullmq';
import { StreakService } from '../../gamification/streak.service';
import { TimingJobsProcessor } from '../../course-timing/timing-jobs.processor';
import {
  MAINTENANCE_BATTLES_JOB,
  MAINTENANCE_QUEUE,
  MAINTENANCE_STUDY_JOB,
  SCHEDULED_QUEUE,
  SCHEDULED_STREAK_JOB,
  SCHEDULED_TIMING_JOB,
} from './jobs.constants';

@Processor(SCHEDULED_QUEUE)
export class ScheduledBullProcessor extends WorkerHost {
  private readonly logger = new Logger(ScheduledBullProcessor.name);

  constructor(
    private readonly timing: TimingJobsProcessor,
    private readonly streak: StreakService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === SCHEDULED_TIMING_JOB) {
      await this.timing.tick();
      return;
    }
    if (job.name === SCHEDULED_STREAK_JOB) {
      await this.streak.closeMissedDays();
      return;
    }
    this.logger.warn(`Unknown scheduled job: ${job.name}`);
  }
}

@Injectable()
export class ScheduledJobsRegistrar implements OnModuleInit {
  private readonly logger = new Logger(ScheduledJobsRegistrar.name);

  constructor(
    @InjectQueue(SCHEDULED_QUEUE) private readonly queue: Queue | null,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    if (!this.queue) return;
    if (this.config.get<string>('TIMING_JOBS_DISABLED') === 'true') {
      this.logger.log('Timing jobs disabled');
    } else {
      const timingMs = Number(
        this.config.get<string>('TIMING_JOBS_INTERVAL_MS') ?? 60_000,
      );
      await this.queue.add(
        SCHEDULED_TIMING_JOB,
        {},
        {
          repeat: { every: timingMs },
          jobId: SCHEDULED_TIMING_JOB,
          removeOnComplete: 20,
          removeOnFail: 20,
        },
      );
    }

    if (this.config.get<string>('STREAK_TICK') !== 'false') {
      await this.queue.add(
        SCHEDULED_STREAK_JOB,
        {},
        {
          repeat: { every: 15 * 60_000 },
          jobId: SCHEDULED_STREAK_JOB,
          removeOnComplete: 20,
          removeOnFail: 20,
        },
      );
    }
  }
}

@Injectable()
export class MaintenanceJobsRegistrar implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceJobsRegistrar.name);

  constructor(
    @InjectQueue(MAINTENANCE_QUEUE) private readonly queue: Queue | null,
  ) {}

  async onModuleInit() {
    if (!this.queue) {
      this.logger.warn(
        'Maintenance queue unavailable — set REDIS_URL for background maintenance',
      );
      return;
    }
    await this.queue.add(
      MAINTENANCE_BATTLES_JOB,
      {},
      {
        repeat: { every: 60_000 },
        jobId: MAINTENANCE_BATTLES_JOB,
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    );
    await this.queue.add(
      MAINTENANCE_STUDY_JOB,
      {},
      {
        repeat: { every: 60_000 },
        jobId: MAINTENANCE_STUDY_JOB,
        removeOnComplete: 20,
        removeOnFail: 20,
      },
    );
  }
}
