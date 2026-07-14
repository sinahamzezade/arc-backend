import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { LessonBodyPersonalizerService } from './lesson-body-personalizer.service';

export const LESSON_BODY_PERSONALIZATION_QUEUE = 'lesson_body_personalization';

export type LessonBodyPersonalizationJobData = {
  lessonId: string;
  userId: string;
  roadmapId: string;
};

@Injectable()
export class LessonBodyPersonalizationJobs {
  private readonly logger = new Logger(LessonBodyPersonalizationJobs.name);

  constructor(
    private readonly personalizer: LessonBodyPersonalizerService,
    @Optional()
    @InjectQueue(LESSON_BODY_PERSONALIZATION_QUEUE)
    private readonly queue: Queue<LessonBodyPersonalizationJobData> | null,
  ) {}

  /**
   * Enqueue personalization for freshly materialized lessons.
   * No-op when flag/LLM off. Idempotent jobId = lessonId.
   */
  async enqueueForMaterializedLessons(input: {
    roadmapId: string;
    userId: string;
    lessonIds: string[];
  }): Promise<void> {
    if (!input.lessonIds.length) return;
    if (!(await this.personalizer.isEnabled(input.userId))) {
      return;
    }

    for (const lessonId of input.lessonIds) {
      await this.enqueueOne({
        lessonId,
        userId: input.userId,
        roadmapId: input.roadmapId,
      });
    }
  }

  async enqueueOne(data: LessonBodyPersonalizationJobData): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.add('personalize', data, {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
          jobId: data.lessonId,
        });
      } catch (err) {
        // jobId collision when already queued/completed — ignore
        this.logger.debug(
          `Enqueue skip lesson=${data.lessonId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
      return;
    }

    this.logger.debug(`In-process personalize lesson=${data.lessonId}`);
    setImmediate(() => {
      void this.processJob(data);
    });
  }

  async processJob(data: LessonBodyPersonalizationJobData): Promise<void> {
    const result = await this.personalizer.personalizeLesson(data);
    if (!result.ok) {
      this.logger.debug(
        `Personalize skipped lesson=${data.lessonId} reason=${result.skipped}`,
      );
    }
  }
}

@Processor(LESSON_BODY_PERSONALIZATION_QUEUE, { concurrency: 2 })
export class LessonBodyPersonalizationBullProcessor extends WorkerHost {
  private readonly logger = new Logger(
    LessonBodyPersonalizationBullProcessor.name,
  );

  constructor(private readonly jobs: LessonBodyPersonalizationJobs) {
    super();
  }

  async process(job: Job<LessonBodyPersonalizationJobData>): Promise<void> {
    this.logger.debug(
      `Bull personalize job=${job.id} lesson=${job.data.lessonId}`,
    );
    await this.jobs.processJob(job.data);
  }
}
