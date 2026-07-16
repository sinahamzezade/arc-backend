import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  RewardCurrency,
  RewardReasonType,
} from '../gamification/entities/reward-ledger-entry.entity';
import { GamificationService } from '../gamification/gamification.service';
import { OutboxService } from '../gamification/outbox.service';
import {
  OUTBOX_ROADMAP_COMPLETED,
  ROADMAP_COMPLETE_REWARD_RULE_KEY,
} from '../gamification/reward-constants';
import {
  LearnerProfileSnapshot,
  LearnerProfileStatus,
} from '../questionnaire/entities/learner-profile-snapshot.entity';
import { Lesson } from './entities/lesson.entity';
import {
  LessonProgress,
  LessonProgressStatus,
} from './entities/lesson-progress.entity';
import { Milestone } from './entities/milestone.entity';
import {
  PostCompletionStatus,
  Roadmap,
  RoadmapCompletionSummary,
  RoadmapStatus,
} from './entities/roadmap.entity';
import {
  RoadmapCompletionEvent,
  type RoadmapNextAction,
} from './entities/roadmap-completion-event.entity';
import { RoadmapCacheService } from './roadmap-cache.service';
import { RoadmapTreeLoader } from './roadmap-tree.loader';
import { RoadmapCompletionCoachProcessor } from './roadmap-completion-coach.processor';

const ASSESSMENT_MILESTONE_TYPES = new Set(['assessment', 'project']);

const DEFAULT_COACH_OPTIONS = [
  { key: 'new_goal', label: 'Explore a new career path' },
  { key: 'same_goal_advanced', label: 'Go deeper on the same path' },
  { key: 'top_up', label: 'Close my skill gaps first' },
];

/** Graduation XP/gems — gamification owns amounts; fixed v1 rule. */
const GRADUATION_XP = 500;
const GRADUATION_GEMS = 25;

@Injectable()
export class RoadmapCompletionService {
  private readonly logger = new Logger(RoadmapCompletionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly treeLoader: RoadmapTreeLoader,
    private readonly roadmapCache: RoadmapCacheService,
    private readonly gamification: GamificationService,
    private readonly outbox: OutboxService,
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    @InjectRepository(RoadmapCompletionEvent)
    private readonly completionEventsRepo: Repository<RoadmapCompletionEvent>,
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    @InjectRepository(LessonProgress)
    private readonly progressRepo: Repository<LessonProgress>,
    @InjectRepository(Milestone)
    private readonly milestonesRepo: Repository<Milestone>,
    @InjectRepository(LearnerProfileSnapshot)
    private readonly profilesRepo: Repository<LearnerProfileSnapshot>,
    @Optional()
    @Inject(forwardRef(() => RoadmapCompletionCoachProcessor))
    private readonly coachProcessor: RoadmapCompletionCoachProcessor | null,
  ) {}

  /** Post-commit hook — never blocks lesson complete. */
  async checkRoadmapCompletion(
    userId: string,
    roadmapId: string,
  ): Promise<boolean> {
    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId, userId },
    });
    if (!roadmap || roadmap.finishedAt) return false;
    const complete = await this.isComplete(userId, roadmapId);
    if (!complete) return false;
    await this.finalizeCompletion(userId, roadmapId);
    return true;
  }

  async isComplete(userId: string, roadmapId: string): Promise<boolean> {
    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId },
    });
    if (!roadmap || roadmap.finishedAt) return false;

    const requiredLessons = await this.lessonsRepo
      .createQueryBuilder('l')
      .innerJoin('l.milestone', 'm')
      .innerJoin('m.phase', 'p')
      .where('p.roadmap_id = :roadmapId', { roadmapId })
      .andWhere('l.required = true')
      .getMany();

    if (requiredLessons.length === 0) {
      // Fallback: treat all lessons as required when none flagged (legacy rows).
      const all = await this.lessonsRepo
        .createQueryBuilder('l')
        .innerJoin('l.milestone', 'm')
        .innerJoin('m.phase', 'p')
        .where('p.roadmap_id = :roadmapId', { roadmapId })
        .getMany();
      if (all.length === 0) return false;
      const done = await this.progressRepo.count({
        where: {
          userId,
          lessonId: In(all.map((l) => l.id)),
          status: LessonProgressStatus.Completed,
        },
      });
      if (done < all.length) return false;
    } else {
      const done = await this.progressRepo.count({
        where: {
          userId,
          lessonId: In(requiredLessons.map((l) => l.id)),
          status: LessonProgressStatus.Completed,
        },
      });
      if (done < requiredLessons.length) return false;
    }

    return this.allAssessmentsComplete(roadmapId);
  }

  async finalizeCompletion(
    userId: string,
    roadmapId: string,
  ): Promise<Roadmap | null> {
    const result = await this.dataSource.transaction(async (manager) => {
      const locked = await manager
        .getRepository(Roadmap)
        .createQueryBuilder('r')
        .setLock('pessimistic_write')
        .where('r.id = :roadmapId', { roadmapId })
        .andWhere('r.finished_at IS NULL')
        .getOne();
      if (!locked) return null;

      const summary = await this.buildMasterySummary(userId, roadmapId);
      const finishedAt = new Date();

      locked.finishedAt = finishedAt;
      locked.status = RoadmapStatus.Completed;
      locked.postCompletionStatus = PostCompletionStatus.AwaitingChoice;
      locked.progressPercent = '100';
      locked.completionSummary = {
        ...summary,
        coachAssessment: {
          ready: false,
          recommendation: null,
          rationale: null,
          options: DEFAULT_COACH_OPTIONS,
        },
      };
      await manager.getRepository(Roadmap).save(locked);

      await manager.getRepository(RoadmapCompletionEvent).save(
        manager.getRepository(RoadmapCompletionEvent).create({
          userId,
          roadmapId,
          skillsMastered: summary.skillsMastered,
          skillsPartial: summary.skillsPartial,
          skillsShaky: summary.skillsShaky,
          totalLessons: summary.totalLessons,
          totalXpEarned: summary.totalXpEarned,
          completionWeeks: summary.completionTimeWeeks,
          nextAction: null,
          coachRationale: null,
          coachReady: false,
        }),
      );

      return { roadmap: locked, summary, finishedAt };
    });

    if (!result) return null;

    await this.roadmapCache.invalidateRoadmap(roadmapId, userId);

    // Fire-and-forget side effects — never roll back finalization.
    void this.emitCompletedSideEffects(
      userId,
      result.roadmap,
      result.summary,
      result.finishedAt,
    ).catch((err) =>
      this.logger.warn(
        `Roadmap completion side-effects failed roadmap=${roadmapId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );

    return result.roadmap;
  }

  async getCompletionSummary(userId: string, roadmapId: string) {
    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId, userId },
    });
    if (!roadmap?.finishedAt) return null;

    const event = await this.completionEventsRepo.findOne({
      where: { roadmapId, userId },
      order: { createdAt: 'DESC' },
    });

    const summary = roadmap.completionSummary ?? {
      skillsMastered: event?.skillsMastered ?? 0,
      skillsPartial: event?.skillsPartial ?? 0,
      skillsShaky: event?.skillsShaky ?? 0,
      totalLessons: event?.totalLessons ?? 0,
      totalXpEarned: event?.totalXpEarned ?? 0,
      completionTimeWeeks: event?.completionWeeks ?? 0,
      skillSummary: [],
    };

    const coachReady = Boolean(
      event?.coachReady || summary.coachAssessment?.ready,
    );
    const recommendation =
      (event?.nextAction as RoadmapNextAction | null) ??
      summary.coachAssessment?.recommendation ??
      null;
    const rationale =
      event?.coachRationale ?? summary.coachAssessment?.rationale ?? null;

    return {
      roadmapId: roadmap.id,
      title: roadmap.title,
      finishedAt: roadmap.finishedAt.toISOString(),
      completionWeeks: summary.completionTimeWeeks,
      totalLessons: summary.totalLessons,
      totalXpEarned: summary.totalXpEarned,
      skillsMastered: summary.skillsMastered,
      skillsPartial: summary.skillsPartial,
      skillsShaky: summary.skillsShaky,
      skillSummary: summary.skillSummary ?? [],
      badges: [] as string[],
      coachAssessment: {
        ready: coachReady,
        recommendation,
        rationale,
        options: summary.coachAssessment?.options ?? DEFAULT_COACH_OPTIONS,
      },
    };
  }

  async applyCoachResult(
    roadmapId: string,
    result: {
      recommendation: RoadmapNextAction;
      rationale: string;
    },
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const event = await manager.getRepository(RoadmapCompletionEvent).findOne({
        where: { roadmapId },
        order: { createdAt: 'DESC' },
      });
      if (event) {
        event.nextAction = result.recommendation;
        event.coachRationale = result.rationale;
        event.coachReady = true;
        await manager.getRepository(RoadmapCompletionEvent).save(event);
      }

      const roadmap = await manager.getRepository(Roadmap).findOne({
        where: { id: roadmapId },
      });
      if (!roadmap?.completionSummary) return;

      roadmap.completionSummary = {
        ...roadmap.completionSummary,
        coachAssessment: {
          ready: true,
          recommendation: result.recommendation,
          rationale: result.rationale,
          options:
            roadmap.completionSummary.coachAssessment?.options ??
            DEFAULT_COACH_OPTIONS,
        },
      };
      await manager.getRepository(Roadmap).save(roadmap);
    });
    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId },
    });
    if (roadmap) {
      await this.roadmapCache.invalidateRoadmap(roadmapId, roadmap.userId);
    }
  }

  listAdvancedRecipeSlugs(primaryRoleSlug: string): string[] {
    return [`${primaryRoleSlug}-advanced`];
  }

  private async allAssessmentsComplete(roadmapId: string): Promise<boolean> {
    const milestones = await this.milestonesRepo
      .createQueryBuilder('m')
      .innerJoin('m.phase', 'p')
      .where('p.roadmap_id = :roadmapId', { roadmapId })
      .andWhere('m.type IN (:...types)', {
        types: [...ASSESSMENT_MILESTONE_TYPES],
      })
      .getMany();

    return milestones.every((m) => m.completedAt != null);
  }

  private async buildMasterySummary(
    userId: string,
    roadmapId: string,
  ): Promise<Omit<RoadmapCompletionSummary, 'coachAssessment'>> {
    const tree = await this.treeLoader.loadRoadmapTree(roadmapId);
    const skillSlugs = new Set<string>();
    let totalLessons = 0;
    for (const phase of tree?.phases ?? []) {
      for (const ms of phase.milestones ?? []) {
        for (const lesson of ms.lessons ?? []) {
          totalLessons += 1;
          for (const slug of lesson.skillsTaught ?? []) {
            skillSlugs.add(slug);
          }
        }
      }
    }

    const profile = await this.profilesRepo.findOne({
      where: [
        { userId, status: LearnerProfileStatus.Provisional },
        { userId, status: LearnerProfileStatus.Verified },
      ],
      order: { version: 'DESC' },
      relations: { skillEstimates: true },
    });
    const targetStage = profile?.targetStage ?? 4;
    const estimates = profile?.skillEstimates ?? [];
    const bySlug = new Map(estimates.map((e) => [e.skillSlug, e]));

    const skillSummary: RoadmapCompletionSummary['skillSummary'] = [];
    let skillsMastered = 0;
    let skillsPartial = 0;
    let skillsShaky = 0;

    const slugs =
      skillSlugs.size > 0
        ? [...skillSlugs]
        : estimates.map((e) => e.skillSlug);

    for (const skillSlug of slugs) {
      const est = bySlug.get(skillSlug);
      const stage =
        est?.verifiedStage ?? est?.provisionalStage ?? 0;
      let status: 'mastered' | 'partial' | 'shaky';
      if (stage >= targetStage) {
        status = 'mastered';
        skillsMastered += 1;
      } else if (stage >= Math.max(1, targetStage - 1)) {
        status = 'partial';
        skillsPartial += 1;
      } else {
        status = 'shaky';
        skillsShaky += 1;
      }
      skillSummary.push({ skillSlug, stage, target: targetStage, status });
    }

    const lessonIds =
      tree?.phases
        ?.flatMap((p) => p.milestones ?? [])
        .flatMap((m) => m.lessons ?? [])
        .map((l) => l.id) ?? [];

    let totalXpEarned = 0;
    if (lessonIds.length) {
      const rows = await this.progressRepo.find({
        where: {
          userId,
          lessonId: In(lessonIds),
          status: LessonProgressStatus.Completed,
        },
      });
      totalXpEarned = rows.reduce((sum, r) => sum + (r.xpAwarded ?? 0), 0);
    }

    const createdAt = tree?.createdAt ?? new Date();
    const weeks = Math.max(
      1,
      Math.ceil(
        (Date.now() - new Date(createdAt).getTime()) / (7 * 24 * 60 * 60 * 1000),
      ),
    );

    return {
      skillsMastered,
      skillsPartial,
      skillsShaky,
      totalLessons: totalLessons || lessonIds.length,
      totalXpEarned,
      completionTimeWeeks: weeks,
      skillSummary,
    };
  }

  private async emitCompletedSideEffects(
    userId: string,
    roadmap: Roadmap,
    summary: Omit<RoadmapCompletionSummary, 'coachAssessment'>,
    finishedAt: Date,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.outbox.enqueue(manager, {
        type: OUTBOX_ROADMAP_COMPLETED,
        aggregateId: roadmap.id,
        payload: {
          event: OUTBOX_ROADMAP_COMPLETED,
          userId,
          roadmapId: roadmap.id,
          roleSlug: roadmap.primaryRoleSlug,
          finishedAt: finishedAt.toISOString(),
          completionWeeks: summary.completionTimeWeeks,
          totalLessons: summary.totalLessons,
          totalXpEarned: summary.totalXpEarned,
          skillsMastered: summary.skillsMastered,
          skillsPartial: summary.skillsPartial,
          skillsShaky: summary.skillsShaky,
        },
      });

      const grant = await this.gamification.grantInTx(manager, {
        userId,
        reasonType: RewardReasonType.Roadmap,
        reasonId: roadmap.id,
        idempotencyKey: `roadmap-complete:${roadmap.id}`,
        metadata: {
          countsForLeague: false,
          rewardRuleVersion: ROADMAP_COMPLETE_REWARD_RULE_KEY,
        },
        lines: [
          {
            currency: RewardCurrency.LifetimeXp,
            amount: GRADUATION_XP,
            idempotencySuffix: 'xp',
          },
          {
            currency: RewardCurrency.Gems,
            amount: GRADUATION_GEMS,
            idempotencySuffix: 'gems',
          },
        ],
      });

      if (!grant.alreadyGranted) {
        await this.gamification.enqueueRewardGranted(manager, {
          userId,
          transactionGroupId: grant.transactionGroupId,
          reasonType: RewardReasonType.Roadmap,
          reasonId: roadmap.id,
          qualifiedLeagueXp: 0,
          lifetimeXp: GRADUATION_XP,
          gems: GRADUATION_GEMS,
          coins: 0,
        });
      }
    });

    void this.gamification.processPendingOutbox().catch(() => undefined);

    if (this.coachProcessor) {
      await this.coachProcessor.enqueue(roadmap.id, userId);
    }
  }
}
