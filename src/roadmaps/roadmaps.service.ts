import { InjectQueue } from '@nestjs/bullmq';
import {
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { In, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { ContentQueryService } from '../content-pool/content-query.service';
import { TimingService } from '../course-timing/timing.service';
import { Goal } from '../goals/entities/goal.entity';
import { Lesson, LessonStatus } from './entities/lesson.entity';
import { Milestone } from './entities/milestone.entity';
import { Roadmap, RoadmapStatus } from './entities/roadmap.entity';
import { RoadmapPhase } from './entities/roadmap-phase.entity';
import {
  RoadmapGenerationJob,
  RoadmapJobStatus,
} from './entities/roadmap-generation-job.entity';
import type { ReplanCurrentStateDto } from './dto/roadmap-engine.types';
import { RoadmapAnalyticsService } from './roadmap-analytics.service';
import { RoadmapEngineClient } from './roadmap-engine.client';
import {
  ROADMAP_GENERATION_QUEUE,
  ROADMAP_REPLAN_QUEUE,
  RoadmapJobsProcessor,
  type RoadmapReplanJobData,
} from './roadmap-generation.processor';
import { RoadmapPersistenceService } from './roadmap-persistence.service';
import { RoadmapSnapshotService } from './roadmap-snapshot.service';
import { toJobDto, toRoadmapTreeDto } from './roadmap.serializer';

export type RoadmapJobResult = {
  status: 'queued' | 'processing' | 'ready' | 'failed';
  jobId: string;
  roadmapId: string | null;
};

@Injectable()
export class RoadmapsService {
  private readonly logger = new Logger(RoadmapsService.name);
  private readonly replanInFlight = new Set<string>();

  constructor(
    @InjectRepository(RoadmapGenerationJob)
    private readonly jobsRepo: Repository<RoadmapGenerationJob>,
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    @InjectRepository(RoadmapPhase)
    private readonly phasesRepo: Repository<RoadmapPhase>,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
    private readonly processor: RoadmapJobsProcessor,
    private readonly snapshot: RoadmapSnapshotService,
    private readonly engine: RoadmapEngineClient,
    private readonly persistence: RoadmapPersistenceService,
    private readonly analytics: RoadmapAnalyticsService,
    private readonly contentQuery: ContentQueryService,
    private readonly timing: TimingService,
    @Optional()
    @InjectQueue(ROADMAP_REPLAN_QUEUE)
    private readonly replanQueue: Queue<RoadmapReplanJobData> | null,
  ) {
    void ROADMAP_GENERATION_QUEUE;
  }

  async generateRoadmap(
    goalId: string,
    userId: string,
  ): Promise<RoadmapJobResult> {
    return this.enqueueGenerate(goalId, userId);
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

    await this.processor.enqueue(job.id);

    return {
      status: 'queued',
      jobId: job.id,
      roadmapId: null,
    };
  }

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
        status:
          latest.status === RoadmapJobStatus.Processing
            ? 'processing'
            : 'queued',
        jobId: latest.id,
        roadmapId: latest.roadmapId,
      };
    }
    return this.enqueueGenerate(latest.goalId, userId);
  }

  async getActiveRoadmap(userId: string): Promise<Roadmap | null> {
    return this.roadmapsRepo.findOne({
      where: {
        userId,
        status: In([RoadmapStatus.Ready, RoadmapStatus.Generating]),
      },
      order: { updatedAt: 'DESC' },
      relations: {
        phases: {
          milestones: {
            lessons: { resource: true },
          },
        },
      },
    });
  }

  async swapActiveRoadmap(oldId: string, newId: string): Promise<void> {
    await this.persistence.swapActiveRoadmap(oldId, newId);
  }

  async replanRoadmap(
    roadmapId: string,
    trigger: string,
  ): Promise<{ roadmapId: string }> {
    if (this.replanInFlight.has(roadmapId)) {
      throw new AppException(
        AuthErrorCode.ROADMAP_REPLAN_CONFLICT,
        'Replan already in progress for this roadmap',
        HttpStatus.CONFLICT,
      );
    }

    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId, status: RoadmapStatus.Ready },
      relations: {
        phases: { milestones: { lessons: true } },
      },
    });
    if (!roadmap) {
      throw new AppException(
        AuthErrorCode.ROADMAP_NOT_FOUND,
        'Roadmap not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (this.replanQueue) {
      this.replanInFlight.add(roadmapId);
      try {
        await this.replanQueue.add(
          'replan',
          {
            roadmapId,
            userId: roadmap.userId,
            trigger,
          },
          {
            jobId: `replan-${roadmapId}`,
            attempts: 2,
            removeOnComplete: 50,
          },
        );
      } catch (err) {
        this.replanInFlight.delete(roadmapId);
        if (
          err instanceof Error &&
          /already exists|duplicat/i.test(err.message)
        ) {
          throw new AppException(
            AuthErrorCode.ROADMAP_REPLAN_CONFLICT,
            'Replan already queued',
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      }
      return { roadmapId };
    }

    const neu = await this.executeReplan(roadmap, trigger);
    return { roadmapId: neu.id };
  }

  async executeReplan(
    roadmap: Roadmap,
    trigger: string,
  ): Promise<Roadmap> {
    this.replanInFlight.add(roadmap.id);
    try {
      const goal = await this.goalsRepo.findOne({
        where: { id: roadmap.goalId },
      });
      if (!goal) {
        throw new AppException(
          AuthErrorCode.GOAL_NOT_FOUND,
          'Goal not found',
          HttpStatus.NOT_FOUND,
        );
      }

      const currentState = this.buildReplanState(roadmap, trigger);
      const contentSnapshot = await this.snapshot.buildSnapshot(goal);
      const profile = this.snapshot.toProfile(
        goal,
        currentState.completed_skill_node_ids,
      );
      const revision = this.snapshot.goalRevision(goal);
      const seed = this.snapshot.seedFor(goal.userId, revision + `:replan:${trigger}`);

      const response = await this.engine.replan(
        profile,
        contentSnapshot,
        seed,
        currentState,
      );
      if (!response.ok || !response.plan) {
        throw new AppException(
          AuthErrorCode.ROADMAP_GENERATION_FAILED,
          response.error_message ?? 'Replan failed',
          HttpStatus.BAD_REQUEST,
        );
      }

      const neu = await this.persistence.persistPlan(goal, response.plan, {
        schemaVersion: 2,
        mode: 'python-replan',
        replanTrigger: trigger,
        sourceRoadmapId: roadmap.id,
        goalRevision: revision,
      });
      await this.persistence.swapActiveRoadmap(roadmap.id, neu.id);

      this.analytics.roadmapReplanned({
        roadmapId: neu.id,
        trigger,
        weeksShifted: Number(
          response.plan.schedule_meta?.preserved_phase_count ?? 0,
        ),
        lessonsInserted: response.plan.phases.reduce(
          (n, p) =>
            n + p.milestones.reduce((m, ms) => m + ms.lessons.length, 0),
          0,
        ),
      });

      try {
        await this.contentQuery.materializeRoadmapContent(neu.id, {
          weeks: 3,
          fromWeek: 1,
        });
      } catch (err) {
        this.logger.warn(
          `Materialize after replan failed: ${err instanceof Error ? err.message : err}`,
        );
      }
      try {
        await this.timing.bootstrapFromRoadmap(neu.id);
      } catch (err) {
        this.logger.warn(
          `Timing bootstrap after replan failed: ${err instanceof Error ? err.message : err}`,
        );
      }

      return neu;
    } finally {
      this.replanInFlight.delete(roadmap.id);
    }
  }

  async loadReadyTree(roadmapId: string): Promise<Roadmap | null> {
    return this.roadmapsRepo.findOne({
      where: { id: roadmapId },
      relations: { phases: { milestones: { lessons: true } } },
    });
  }

  private buildReplanState(
    roadmap: Roadmap,
    trigger: string,
  ): ReplanCurrentStateDto {
    const completedLessonTemplateIds: string[] = [];
    const completedSkillNodeIds: string[] = [];
    const completedPhaseKeys: string[] = [];

    const phases = [...(roadmap.phases ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    for (const phase of phases) {
      const milestones = [...(phase.milestones ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      let phaseComplete = milestones.length > 0;
      for (const m of milestones) {
        const lessons = [...(m.lessons ?? [])];
        if (!lessons.length) continue;
        const allDone = lessons.every(
          (l) => l.status === LessonStatus.Completed,
        );
        if (!allDone) phaseComplete = false;
        for (const l of lessons) {
          if (l.status === LessonStatus.Completed && l.lessonTemplateId) {
            completedLessonTemplateIds.push(l.lessonTemplateId);
          }
        }
        if (
          allDone &&
          m.skillNodeId &&
          lessons.every((l) => l.status === LessonStatus.Completed)
        ) {
          completedSkillNodeIds.push(m.skillNodeId);
        }
      }
      if (phaseComplete && phase.completedAt) {
        completedPhaseKeys.push(phase.title);
      } else if (
        phaseComplete &&
        milestones.every((m) =>
          (m.lessons ?? []).every((l) => l.status === LessonStatus.Completed),
        )
      ) {
        // Use title as key fallback when phase.key not stored on entity
        completedPhaseKeys.push(phase.title);
      }
    }

    return {
      roadmap_id: roadmap.id,
      completed_lesson_template_ids: completedLessonTemplateIds,
      completed_skill_node_ids: [...new Set(completedSkillNodeIds)],
      completed_phase_keys: completedPhaseKeys,
      current_week: 1,
      trigger,
      prior_plan: {
        title: roadmap.title,
        description: roadmap.description,
        primary_role_slug: roadmap.primaryRoleSlug,
        recipe_id: (roadmap.generationMeta?.recipeId as string) ?? '',
        timeline_weeks: roadmap.timelineWeeks,
        weekly_hours_target: Number(roadmap.weeklyHoursTarget ?? 0),
        estimated_weeks: Number(
          roadmap.generationMeta?.estimatedWeeks ?? roadmap.timelineWeeks,
        ),
        estimated_completion_date:
          (roadmap.generationMeta?.estimatedCompletionDate as string) ?? null,
        engine_version: Number(roadmap.generationMeta?.engineVersion ?? 2),
        seed: Number(roadmap.generationMeta?.seed ?? 0),
        content_version: String(
          roadmap.generationMeta?.contentVersion ?? '',
        ),
        phases: phases.map((p) => ({
          key: p.title,
          title: p.title,
          tech_stack_id: p.techStackId,
          tech_stack_slug: p.techStackSlug,
          order_index: p.orderIndex,
          locked: p.locked,
          week_type: 'learning',
          milestones: (p.milestones ?? []).map((m) => ({
            skill_node_id: m.skillNodeId ?? '',
            title: m.title,
            type: m.type,
            compress: false,
            order_index: m.orderIndex,
            xp_reward: m.xpReward,
            lessons: (m.lessons ?? []).map((l) => ({
              source_template_id: l.lessonTemplateId ?? '',
              source_version_id: l.sourceVersionId,
              skill_node_id: m.skillNodeId ?? '',
              title: l.title,
              mission_name: l.missionName,
              lesson_type: l.lessonType,
              estimated_minutes: l.estimatedMinutes,
              difficulty: l.difficulty,
              xp_reward: l.xpReward,
              reward_class: l.rewardClassSnapshot ?? 'standard',
              resource_id: l.resourceId,
              status: l.status,
              content_outline: l.playContent ?? {},
              week_index: null,
              explanation: null,
            })),
          })),
        })),
        skipped_known: [],
        explanations: [],
        schedule_meta: {},
      },
    };
  }

  async getCurrent(userId: string) {
    const job = await this.jobsRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    let roadmap = await this.getActiveRoadmap(userId);

    if (roadmap?.status === RoadmapStatus.Ready) {
      const healed = await this.healStuckPath(roadmap);
      if (healed) {
        roadmap = await this.getActiveRoadmap(userId);
      }
    }

    return {
      job: toJobDto(job),
      roadmap: roadmap ? toRoadmapTreeDto(roadmap) : null,
    };
  }

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
