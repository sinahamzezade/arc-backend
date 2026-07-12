import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { SkillGraphService } from '../skill-graph/skill-graph.service';
import {
  Roadmap,
  RoadmapStatus,
} from './entities/roadmap.entity';
import {
  RoadmapGenerationJob,
  RoadmapJobStatus,
} from './entities/roadmap-generation-job.entity';
import { RoadmapJobsProcessor } from './roadmap-jobs.processor';
import { toJobDto, toRoadmapTreeDto } from './roadmap.serializer';

export type RoadmapJobResult = {
  status: 'queued' | 'processing' | 'ready' | 'failed';
  jobId: string;
  roadmapId: string | null;
};

/**
 * Roadmap Generator entry — enqueue jobs + expose current tree.
 */
@Injectable()
export class RoadmapsService {
  constructor(
    @InjectRepository(RoadmapGenerationJob)
    private readonly jobsRepo: Repository<RoadmapGenerationJob>,
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    private readonly processor: RoadmapJobsProcessor,
    private readonly skillGraph: SkillGraphService,
  ) {
    void this.skillGraph;
  }

  async enqueueGenerate(
    goalId: string,
    userId: string,
  ): Promise<RoadmapJobResult> {
    const job = await this.jobsRepo.save(
      this.jobsRepo.create({
        goalId,
        userId,
        status: RoadmapJobStatus.Queued,
        roadmapId: null,
        attempts: 0,
      }),
    );

    this.processor.schedule(job.id);

    return {
      status: 'queued',
      jobId: job.id,
      roadmapId: null,
    };
  }

  async getCurrent(userId: string) {
    const job = await this.jobsRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    const roadmap = await this.roadmapsRepo.findOne({
      where: {
        userId,
        status: In([RoadmapStatus.Ready, RoadmapStatus.Generating]),
      },
      order: { updatedAt: 'DESC' },
      relations: {
        phases: {
          milestones: {
            lessons: {
              resource: true,
            },
          },
        },
      },
    });

    return {
      job: toJobDto(job),
      roadmap: roadmap ? toRoadmapTreeDto(roadmap) : null,
    };
  }

  /** Entity + nested lessons for weekly planner (not DTO). */
  async findReadyWithLessons(userId: string): Promise<Roadmap | null> {
    return this.roadmapsRepo.findOne({
      where: {
        userId,
        status: RoadmapStatus.Ready,
      },
      order: { updatedAt: 'DESC' },
      relations: {
        phases: {
          milestones: {
            lessons: true,
          },
        },
      },
    });
  }

  async getJob(userId: string, jobId: string) {
    const job = await this.jobsRepo.findOne({ where: { id: jobId, userId } });
    if (!job) {
      throw new AppException(
        AuthErrorCode.ROADMAP_NOT_FOUND,
        'Roadmap job not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return toJobDto(job);
  }
}
