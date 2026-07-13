import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  ROADMAP_REPLAN_QUEUE,
  type RoadmapReplanJobData,
} from './roadmap-generation.processor';
import { RoadmapsService } from './roadmaps.service';

@Processor(ROADMAP_REPLAN_QUEUE, { concurrency: 1 })
@Injectable()
export class RoadmapReplanBullProcessor extends WorkerHost {
  private readonly logger = new Logger(RoadmapReplanBullProcessor.name);

  constructor(
    @Inject(forwardRef(() => RoadmapsService))
    private readonly roadmaps: RoadmapsService,
  ) {
    super();
  }

  async process(job: Job<RoadmapReplanJobData>): Promise<void> {
    this.logger.log(
      `Replan bull job roadmap=${job.data.roadmapId} trigger=${job.data.trigger}`,
    );
    const roadmap = await this.roadmaps.loadReadyTree(job.data.roadmapId);
    if (!roadmap) return;
    await this.roadmaps.executeReplan(roadmap, job.data.trigger);
  }
}
