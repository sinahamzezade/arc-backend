import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BattlesService } from '../../battles/battles.service';
import { StudyTogetherService } from '../../study-together/study-together.service';
import {
  MAINTENANCE_BATTLES_JOB,
  MAINTENANCE_QUEUE,
  MAINTENANCE_STUDY_JOB,
} from './jobs.constants';

@Processor(MAINTENANCE_QUEUE)
export class MaintenanceBullProcessor extends WorkerHost {
  private readonly logger = new Logger(MaintenanceBullProcessor.name);

  constructor(
    private readonly battles: BattlesService,
    private readonly study: StudyTogetherService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === MAINTENANCE_BATTLES_JOB) {
      await this.battles.performMaintenance();
      return;
    }
    if (job.name === MAINTENANCE_STUDY_JOB) {
      await this.study.performMaintenance();
      return;
    }
    this.logger.warn(`Unknown maintenance job: ${job.name}`);
  }
}
