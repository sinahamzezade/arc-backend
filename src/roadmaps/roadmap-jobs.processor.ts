import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import {
  RoadmapGenerationJob,
  RoadmapJobStatus,
} from './entities/roadmap-generation-job.entity';
import { RoadmapGeneratorService } from './roadmap-generator.service';

@Injectable()
export class RoadmapJobsProcessor {
  private readonly logger = new Logger(RoadmapJobsProcessor.name);

  constructor(
    @InjectRepository(RoadmapGenerationJob)
    private readonly jobsRepo: Repository<RoadmapGenerationJob>,
    private readonly generator: RoadmapGeneratorService,
  ) {}

  /** Fire-and-forget in-process worker (Bull later). */
  schedule(jobId: string) {
    setImmediate(() => {
      void this.process(jobId);
    });
  }

  async process(jobId: string) {
    const job = await this.jobsRepo.findOne({ where: { id: jobId } });
    if (!job) {
      this.logger.warn(`Job ${jobId} missing`);
      return;
    }
    if (
      job.status === RoadmapJobStatus.Ready ||
      job.status === RoadmapJobStatus.Processing
    ) {
      return;
    }

    job.status = RoadmapJobStatus.Processing;
    job.attempts += 1;
    await this.jobsRepo.save(job);

    try {
      const roadmap = await this.generator.assemble(job.goalId, job.userId);
      job.status = RoadmapJobStatus.Ready;
      job.roadmapId = roadmap.id;
      job.errorCode = null;
      job.errorMessage = null;
      job.finishedAt = new Date();
      await this.jobsRepo.save(job);
    } catch (err) {
      const code =
        err instanceof AppException
          ? err.code
          : 'ROADMAP_GENERATION_FAILED';
      const message =
        err instanceof Error ? err.message : 'Roadmap generation failed';
      this.logger.error(`Job ${jobId} failed: ${message}`);
      job.status = RoadmapJobStatus.Failed;
      job.errorCode = code;
      job.errorMessage = message;
      job.finishedAt = new Date();
      await this.jobsRepo.save(job);
    }
  }
}
