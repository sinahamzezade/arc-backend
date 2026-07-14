import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import {
  RoadmapGenerationJob,
  RoadmapJobStatus,
} from './entities/roadmap-generation-job.entity';
import { RoadmapGeneratorService } from './roadmap-generator.service';

export const ROADMAP_GENERATION_QUEUE = 'roadmap_generation';
export const ROADMAP_REPLAN_QUEUE = 'roadmap_replan';

export type RoadmapGenerationJobData = {
  dbJobId: string;
};

export type RoadmapReplanJobData = {
  roadmapId: string;
  userId: string;
  trigger: string;
  dbJobId?: string;
};

@Injectable()
export class RoadmapJobsProcessor {
  private readonly logger = new Logger(RoadmapJobsProcessor.name);

  constructor(
    @InjectRepository(RoadmapGenerationJob)
    private readonly jobsRepo: Repository<RoadmapGenerationJob>,
    private readonly generator: RoadmapGeneratorService,
    @Optional()
    @InjectQueue(ROADMAP_GENERATION_QUEUE)
    private readonly generationQueue: Queue<RoadmapGenerationJobData> | null,
  ) {}

  /** Prefer BullMQ when queue wired; else in-process setImmediate. */
  async enqueue(dbJobId: string): Promise<void> {
    if (this.generationQueue) {
      const maxAttempts = Number(
        process.env.ROADMAP_GENERATION_MAX_RETRIES ?? 3,
      );
      await this.generationQueue.add(
        'generate',
        { dbJobId },
        {
          attempts: maxAttempts,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
          jobId: dbJobId,
        },
      );
      return;
    }
    this.logger.debug(`In-process schedule job=${dbJobId}`);
    setImmediate(() => {
      void this.processDbJob(dbJobId);
    });
  }

  /** @deprecated use enqueue */
  schedule(jobId: string) {
    void this.enqueue(jobId);
  }

  async processDbJob(
    jobId: string,
    opts: { rethrow?: boolean } = {},
  ): Promise<void> {
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

    this.logger.log(
      `[roadmap-gen] processing job=${jobId} goal=${job.goalId} user=${job.userId} attempt=${job.attempts}`,
    );

    try {
      const roadmap = await this.generator.assemble(job.goalId, job.userId);
      job.status = RoadmapJobStatus.Ready;
      job.roadmapId = roadmap.id;
      job.errorCode = null;
      job.errorMessage = null;
      job.finishedAt = new Date();
      await this.jobsRepo.save(job);
      const meta = (roadmap.generationMeta ?? {}) as Record<string, unknown>;
      this.logger.log(
        `[roadmap-gen] ready job=${jobId} roadmap=${roadmap.id} mode=${String(meta.mode ?? '?')} model=${String(meta.aiModel ?? 'none')} fallback=${String(meta.aiUsedFallback ?? false)}`,
      );
    } catch (err) {
      const code =
        err instanceof AppException ? err.code : 'ROADMAP_GENERATION_FAILED';
      const message =
        err instanceof Error ? err.message : 'Roadmap generation failed';
      this.logger.error(
        `[roadmap-gen] failed job=${jobId} code=${code}: ${message}`,
      );
      job.status = RoadmapJobStatus.Failed;
      job.errorCode = code;
      job.errorMessage = message;
      job.finishedAt = new Date();
      await this.jobsRepo.save(job);
      if (opts.rethrow) throw err;
    }
  }
}
@Processor(ROADMAP_GENERATION_QUEUE, { concurrency: 2 })
export class RoadmapGenerationBullProcessor extends WorkerHost {
  private readonly logger = new Logger(RoadmapGenerationBullProcessor.name);

  constructor(private readonly jobs: RoadmapJobsProcessor) {
    super();
  }

  async process(job: Job<RoadmapGenerationJobData>): Promise<void> {
    this.logger.debug(`Bull job ${job.id} dbJob=${job.data.dbJobId}`);
    await this.jobs.processDbJob(job.data.dbJobId, { rethrow: true });
  }
}
