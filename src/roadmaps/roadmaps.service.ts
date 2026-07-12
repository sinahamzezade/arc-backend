import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { SkillGraphService } from '../skill-graph/skill-graph.service';
import { Lesson, LessonStatus } from './entities/lesson.entity';
import { Milestone } from './entities/milestone.entity';
import {
  Roadmap,
  RoadmapStatus,
} from './entities/roadmap.entity';
import { RoadmapPhase } from './entities/roadmap-phase.entity';
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
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    @InjectRepository(RoadmapPhase)
    private readonly phasesRepo: Repository<RoadmapPhase>,
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

  /** Re-enqueue generation from latest job's goal (Redraw map). */
  async retryGenerate(userId: string): Promise<RoadmapJobResult> {
    const latest = await this.jobsRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    if (!latest?.goalId) {
      throw new AppException(
        AuthErrorCode.GOAL_NOT_FOUND,
        'No roadmap job to retry — finish the questionnaire first',
        HttpStatus.NOT_FOUND,
      );
    }
    if (
      latest.status === RoadmapJobStatus.Queued ||
      latest.status === RoadmapJobStatus.Processing
    ) {
      return {
        status: latest.status === RoadmapJobStatus.Processing
          ? 'processing'
          : 'queued',
        jobId: latest.id,
        roadmapId: latest.roadmapId,
      };
    }
    return this.enqueueGenerate(latest.goalId, userId);
  }

  async getCurrent(userId: string) {
    const job = await this.jobsRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    let roadmap = await this.roadmapsRepo.findOne({
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

    // Heal paths stuck with zero Available (e.g. old XP hard-gate after week seal).
    if (roadmap?.status === RoadmapStatus.Ready) {
      const healed = await this.healStuckPath(roadmap);
      if (healed) {
        roadmap = await this.roadmapsRepo.findOne({
          where: { id: roadmap.id },
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
      }
    }

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

  /**
   * If Path has no Available lesson but locked ones remain after progress,
   * unlock the next one so week-goal / ahead users can keep learning.
   */
  private async healStuckPath(roadmap: Roadmap): Promise<boolean> {
    const ordered = this.flattenLessons(roadmap);
    if (!ordered.length) return false;
    if (ordered.some((l) => l.status === LessonStatus.Available)) return false;

    let unlockIdx = -1;
    const lastCompletedIdx = ordered.reduce(
      (acc, l, i) => (l.status === LessonStatus.Completed ? i : acc),
      -1,
    );
    if (lastCompletedIdx >= 0) {
      unlockIdx = ordered.findIndex(
        (l, i) => i > lastCompletedIdx && l.status === LessonStatus.Locked,
      );
    } else {
      unlockIdx = ordered.findIndex((l) => l.status === LessonStatus.Locked);
    }
    if (unlockIdx < 0) return false;

    const next = ordered[unlockIdx]!;
    next.status = LessonStatus.Available;
    await this.lessonsRepo.save(next);

    if (next.milestone?.phase?.locked) {
      next.milestone.phase.locked = false;
      await this.phasesRepo.save(next.milestone.phase);
    }
    return true;
  }

  private flattenLessons(roadmap: Roadmap): Lesson[] {
    const phases = [...(roadmap.phases ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    const out: Lesson[] = [];
    for (const phase of phases) {
      const milestones = [...(phase.milestones ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      for (const milestone of milestones) {
        const lessons = [...(milestone.lessons ?? [])].sort(
          (a, b) => a.orderIndex - b.orderIndex,
        );
        for (const lesson of lessons) {
          (lesson as Lesson & { milestone?: Milestone }).milestone = milestone;
          if (!milestone.phase) {
            (milestone as Milestone & { phase?: RoadmapPhase }).phase = phase;
          }
          out.push(lesson);
        }
      }
    }
    return out;
  }
}
