import { HttpStatus, Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  CONTENT_SCHEMA_VERSION,
  REWARD_RULE_VERSION,
} from '../gamification/reward-constants';
import { GamificationService } from '../gamification/gamification.service';
import {
  RewardCurrency,
  RewardReasonType,
} from '../gamification/entities/reward-ledger-entry.entity';
import { StreakService } from '../gamification/streak.service';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import {
  LessonProgress,
  LessonProgressStatus,
} from '../roadmaps/entities/lesson-progress.entity';
import { ContentQualityService } from '../content-pool/content-quality.service';
import { Unit } from '../content-pool/entities/unit.entity';
import { TimingService } from '../course-timing/timing.service';
import {
  LearnerProfileSnapshot,
  LearnerProfileStatus,
  StageConfidence,
} from '../questionnaire/entities/learner-profile-snapshot.entity';
import {
  LearnerSkillEstimate,
  SkillEvidenceSource,
} from '../questionnaire/entities/learner-skill-estimate.entity';
import { WeeksService } from '../weeks/weeks.service';
import { CompleteLessonDto } from './dto/lesson-play.dto';
import {
  LessonAttempt,
  LessonAttemptStatus,
} from './entities/lesson-attempt.entity';
import { LessonCompletionResult } from './entities/lesson-completion-result.entity';
import { RemediationEvent } from './entities/remediation-event.entity';
import { LessonRewardsService } from './lesson-rewards.service';
import { LessonUnlockService } from './lesson-unlock.service';
import { CoachPersonalityService } from './coach-personality.service';
import { RoadmapCompletionService } from '../roadmaps/roadmap-completion.service';
import { CrossTrackDiscoveryService } from '../roadmaps/cross-track-discovery.service';

export type CompleteLessonResponse = {
  lessonId: string;
  status: string;
  quizScore: { correct: number; total: number; perfect: boolean };
  reward: {
    xp: number;
    gems: number;
    coins: number;
    badgeId?: string;
    badgeLabel?: string;
    arloLine: string;
    variableRoll?: Record<string, unknown> | null;
  };
  wallet: {
    lifetimeXp: number;
    gems: number;
    coins: number;
    version: number;
  };
  /** @deprecated prefer wallet — kept for older clients */
  profile: {
    totalXp: number;
    gems: number;
    coins: number;
  };
  unlockedLessonIds: string[];
  roadmapProgressPercent: number;
  attemptId: string | null;
  contentVersionId: string;
  rewardRuleVersion: string;
  /** Present when this completion finished the active roadmap. */
  roadmapCompleted?: boolean;
  roadmapId?: string | null;
  /** Optional cross-track discovery nudge (engagement §10). */
  crossTrackNudge?: {
    unitId: string;
    title: string;
    estimatedMinutes: number;
    optional: true;
  } | null;
};

@Injectable()
export class LessonCompletionOrchestrator {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rewards: LessonRewardsService,
    private readonly unlock: LessonUnlockService,
    private readonly gamification: GamificationService,
    private readonly streaks: StreakService,
    private readonly coachPersonality: CoachPersonalityService,
    @InjectRepository(LessonCompletionResult)
    private readonly resultsRepo: Repository<LessonCompletionResult>,
    @Inject(forwardRef(() => WeeksService))
    private readonly weeks: WeeksService,
    private readonly quality: ContentQualityService,
    private readonly timing: TimingService,
    @Inject(forwardRef(() => RoadmapCompletionService))
    private readonly roadmapCompletion: RoadmapCompletionService,
    private readonly crossTrack: CrossTrackDiscoveryService,
  ) {}

  resolveContentVersionId(lesson: Lesson): string {
    return lesson.unitId ?? lesson.id;
  }

  async complete(input: {
    userId: string;
    lesson: Lesson;
    /** Server-graded score against play_content snapshot (0/0 for non-quiz). */
    quizCorrect: number;
    quizTotal: number;
    /** Final merged answers keyed by question id (q0..). */
    quizAnswers: Record<string, number | boolean>;
    /** Self-attested (or session-recorded) task completion. */
    practiceDone: boolean;
    dto: CompleteLessonDto;
    idempotencyKey: string;
    contentVersionId?: string;
    contentSchemaVersion?: number;
    attempt?: LessonAttempt | null;
  }): Promise<CompleteLessonResponse> {
    const { userId, lesson, dto, idempotencyKey } = input;
    const contentVersionId =
      input.contentVersionId ?? this.resolveContentVersionId(lesson);

    const byKey = await this.resultsRepo.findOne({
      where: { userId, idempotencyKey },
    });
    if (byKey) {
      return byKey.resultSnapshot as CompleteLessonResponse;
    }

    const priorForLesson = await this.resultsRepo.findOne({
      where: { userId, lessonId: lesson.id },
      order: { createdAt: 'DESC' },
    });
    if (priorForLesson) {
      // Store alias under new key so retries with fresh Idempotency-Key still safe.
      try {
        await this.resultsRepo.save(
          this.resultsRepo.create({
            userId,
            lessonId: lesson.id,
            attemptId: priorForLesson.attemptId,
            lessonProgressId: priorForLesson.lessonProgressId,
            idempotencyKey,
            rewardTransactionGroupId: priorForLesson.rewardTransactionGroupId,
            contentVersionId: priorForLesson.contentVersionId,
            rewardRuleVersion: priorForLesson.rewardRuleVersion,
            resultSnapshot: priorForLesson.resultSnapshot,
          }),
        );
      } catch {
        /* unique race — ignore */
      }
      return priorForLesson.resultSnapshot as CompleteLessonResponse;
    }

    const txResult = await this.dataSource.transaction(async (manager) => {
      const progressRepo = manager.getRepository(LessonProgress);
      const attemptRepo = manager.getRepository(LessonAttempt);
      const resultRepo = manager.getRepository(LessonCompletionResult);

      const keyed = await resultRepo.findOne({
        where: { userId, idempotencyKey },
      });
      if (keyed) {
        return {
          response: keyed.resultSnapshot as CompleteLessonResponse,
          firstCompletion: false,
          minutes: 0,
          hintUsed: false,
          attemptId: null as string | null,
          lessonId: lesson.id,
          roadmapId: lesson.milestone?.phase?.roadmap?.id ?? null,
        };
      }

      const existingResult = await resultRepo.findOne({
        where: { userId, lessonId: lesson.id },
        order: { createdAt: 'DESC' },
      });
      if (existingResult) {
        return {
          response: existingResult.resultSnapshot as CompleteLessonResponse,
          firstCompletion: false,
          minutes: 0,
          hintUsed: false,
          attemptId: null as string | null,
          lessonId: lesson.id,
          roadmapId: lesson.milestone?.phase?.roadmap?.id ?? null,
        };
      }

      let progress = await progressRepo.findOne({
        where: { userId, lessonId: lesson.id },
        lock: { mode: 'pessimistic_write' },
      });

      const previouslyAwarded =
        (progress?.xpAwarded ?? 0) > 0 ||
        (progress?.gemsAwarded ?? 0) > 0 ||
        (progress?.coinsAwarded ?? 0) > 0;

      let attempt: LessonAttempt | null = input.attempt ?? null;
      if (progress?.activeAttemptId && !attempt) {
        attempt = await attemptRepo.findOne({
          where: { id: progress.activeAttemptId },
        });
        if (attempt && attempt.contentVersionId !== contentVersionId) {
          throw new AppException(
            AuthErrorCode.LESSON_ATTEMPT_MISMATCH,
            'Attempt content version expired — restart lesson',
            HttpStatus.CONFLICT,
          );
        }
      }

      const { quizCorrect, quizTotal, quizAnswers, practiceDone } = input;
      const practiceCorrect = practiceDone ? true : null;

      const completedCount = await progressRepo.count({
        where: { userId, status: LessonProgressStatus.Completed },
      });
      const isFirstLessonEver = completedCount === 0 && !previouslyAwarded;

      const pathPercentile = await this.unlock.pathPercentile(manager, lesson);
      const assistance = this.rewards.mapAssistance(attempt?.assistanceUsed);

      if (!progress) {
        progress = progressRepo.create({
          userId,
          lessonId: lesson.id,
          status: LessonProgressStatus.InProgress,
          startedAt: new Date(),
          sessionState: {},
        });
        progress = await progressRepo.save(progress);
      }

      if (!attempt) {
        const last =
          (
            await attemptRepo.find({
              where: { userId, lessonId: lesson.id },
              order: { attemptNumber: 'DESC' },
              take: 1,
            })
          )[0]?.attemptNumber ?? 0;
        attempt = await attemptRepo.save(
          attemptRepo.create({
            userId,
            lessonId: lesson.id,
            lessonProgressId: progress.id,
            attemptNumber: last + 1,
            contentVersionId,
            contentSchemaVersion:
              input.contentSchemaVersion ?? CONTENT_SCHEMA_VERSION,
            rewardRuleVersion: REWARD_RULE_VERSION,
            status: LessonAttemptStatus.InProgress,
            startedAt: progress.startedAt ?? new Date(),
            rewardEligible: !previouslyAwarded,
          }),
        );
        progress.activeAttemptId = attempt.id;
      }

      const grantKey = `lesson-complete:${lesson.id}:${attempt.id}`;

      const reward = this.rewards.computeReward({
        lesson,
        quizCorrect,
        quizTotal,
        alreadyCompleted: previouslyAwarded,
        isFirstLessonEver,
        pathPercentile,
        assistance,
        attemptKind: previouslyAwarded ? 'review_later' : 'first',
        grantKey,
      });

      const qualifiedLeagueXp = reward.firstTime ? reward.xp : 0;

      const minutes =
        (dto.timeSpentMinutes ?? progress.timeSpentMinutes) ||
        lesson.estimatedMinutes;

      progress.status = LessonProgressStatus.Completed;
      progress.completedAt = new Date();
      progress.quizCorrect = quizCorrect;
      progress.quizTotal = quizTotal;
      progress.practiceCorrect = practiceCorrect;
      if (dto.timeSpentMinutes !== undefined) {
        progress.timeSpentMinutes = dto.timeSpentMinutes;
      }
      progress.sessionState = {
        ...(progress.sessionState ?? {}),
        practiceDone,
        quizAnswers,
      };

      const grant = await this.gamification.grantInTx(manager, {
        userId,
        reasonType: RewardReasonType.Lesson,
        reasonId: lesson.id,
        idempotencyKey: grantKey,
        metadata: {
          quizCorrect,
          quizTotal,
          practiceCorrect,
          rewardRuleVersion: REWARD_RULE_VERSION,
          contentVersionId,
          ...(reward.calcMetadata ?? {}),
        },
        lines: this.gamification.buildLessonGrantLines({
          xp: reward.xp,
          gems: reward.gems,
          coins: reward.coins,
          qualifiedLeagueXp,
        }),
      });

      if (!grant.alreadyGranted) {
        progress.xpAwarded = reward.xp;
        progress.gemsAwarded = reward.gems;
        progress.coinsAwarded = reward.coins;
      }

      let unlockedBadgeId: string | undefined;
      let unlockedBadgeLabel: string | undefined;
      // Badge unlocks are owned by BadgesModule via outbox (lesson.completed.v1).
      // Still surface intended badge on the reward payload for the lesson UI.
      if (reward.badgeId && reward.badgeLabel && reward.firstTime) {
        unlockedBadgeId = reward.badgeId;
        unlockedBadgeLabel = reward.badgeLabel;
      }

      await progressRepo.save(progress);

      attempt.status = LessonAttemptStatus.Completed;
      attempt.completedAt = new Date();
      attempt.submittedAt = new Date();
      attempt.lessonProgressId = progress.id;
      attempt.scoreSnapshot = {
        quizCorrect,
        quizTotal,
        practiceCorrect,
        scorePercent:
          quizTotal > 0 ? Math.round((quizCorrect / quizTotal) * 100) : 100,
      };
      attempt.rewardEligible = reward.firstTime;
      await attemptRepo.save(attempt);

      const lessonRow = await manager.getRepository(Lesson).findOneOrFail({
        where: { id: lesson.id },
      });
      const unlockResult = await this.unlock.afterComplete(
        manager,
        userId,
        lessonRow,
      );

      if (reward.firstTime) {
        await this.streaks.qualifyInTx(manager, {
          userId,
          actionType: 'lesson',
          actionId: lesson.id,
        });
      }

      const weekly = await this.weeks.markLessonDoneInTx(
        manager,
        userId,
        lesson.id,
        minutes,
        attempt.id,
      );

      const scorePercent =
        quizTotal > 0 ? Math.round((quizCorrect / quizTotal) * 100) : 100;

      await this.gamification.enqueueLessonCompleted(manager, {
        userId,
        lessonId: lesson.id,
        lessonProgressId: progress.id,
        attemptId: attempt.id,
        roadmapId: lesson.milestone?.phase?.roadmap?.id ?? null,
        milestoneId: lesson.milestoneId,
        weeklyTaskId: weekly.weeklyTaskId,
        verifiedMinutes: minutes,
        scorePercent,
        difficulty: lesson.difficulty,
        lessonType: lesson.lessonType,
        rewardTransactionGroupId: grant.transactionGroupId,
        qualifiedLeagueXp,
        conceptsTotal: 0,
        conceptsMastered: 0,
        remediationRoundsUsed: 0,
        shakyConcepts: [],
      });

      await this.gamification.enqueueRewardGranted(manager, {
        userId,
        transactionGroupId: grant.transactionGroupId,
        reasonType: RewardReasonType.Lesson,
        reasonId: lesson.id,
        qualifiedLeagueXp,
        lifetimeXp: reward.xp,
        gems: reward.gems,
        coins: reward.coins,
        leagueLedgerEntryId: grant.entryIds[RewardCurrency.LeagueXp] ?? null,
      });

      const variableRoll = reward.calcMetadata?.variableRoll;
      if (
        !grant.alreadyGranted &&
        variableRoll &&
        typeof variableRoll === 'object'
      ) {
        await this.gamification.enqueueVariableRoll(manager, {
          userId,
          transactionGroupId: grant.transactionGroupId,
          reasonId: lesson.id,
          variableRoll: variableRoll as Record<string, unknown>,
        });
      }

      if (reward.firstTime) {
        await this.coachPersonality.updateRapport(
          userId,
          'completion',
          manager,
        );
      }

      const response: CompleteLessonResponse = {
        lessonId: lesson.id,
        status: LessonProgressStatus.Completed,
        quizScore: {
          correct: quizCorrect,
          total: quizTotal,
          perfect: quizTotal > 0 && quizCorrect === quizTotal,
        },
        reward: {
          xp: reward.xp,
          gems: reward.gems,
          coins: reward.coins,
          badgeId: unlockedBadgeId ?? reward.badgeId,
          badgeLabel: unlockedBadgeLabel ?? reward.badgeLabel,
          arloLine: reward.arloLine,
          variableRoll:
            (reward.calcMetadata?.variableRoll as Record<string, unknown>) ??
            null,
        },
        wallet: {
          lifetimeXp: grant.wallet.lifetimeXp,
          gems: grant.wallet.gems,
          coins: grant.wallet.coins,
          version: grant.wallet.version,
        },
        profile: {
          totalXp: grant.wallet.lifetimeXp,
          gems: grant.wallet.gems,
          coins: grant.wallet.coins,
        },
        unlockedLessonIds: unlockResult.unlockedLessonIds,
        roadmapProgressPercent: unlockResult.progressPercent,
        attemptId: attempt.id,
        contentVersionId,
        rewardRuleVersion: REWARD_RULE_VERSION,
      };

      await resultRepo.save(
        resultRepo.create({
          userId,
          lessonId: lesson.id,
          attemptId: attempt.id,
          lessonProgressId: progress.id,
          idempotencyKey,
          rewardTransactionGroupId: grant.transactionGroupId,
          contentVersionId,
          rewardRuleVersion: REWARD_RULE_VERSION,
          resultSnapshot: response as unknown as Record<string, unknown>,
        }),
      );

      return {
        response,
        firstCompletion: reward.firstTime,
        minutes,
        hintUsed: Number(attempt?.assistanceUsed?.hintCount ?? 0) > 0,
        attemptId: attempt.id,
        lessonId: lesson.id,
        roadmapId: lesson.milestone?.phase?.roadmap?.id ?? null,
      };
    });

    // §16.7 remediation analytics — fire-and-forget AFTER commit
    if (txResult.attemptId) {
      void this.emitRemediationAnalytics(
        txResult.attemptId,
        txResult.lessonId,
      ).catch(() => undefined);
      // Skill evidence on the active learner profile — fire-and-forget,
      // never rewrites questionnaire answers, never replans synchronously.
      void this.recordSkillEvidence({
        userId,
        lesson,
        attemptId: txResult.attemptId,
        quizCorrect: input.quizCorrect,
        quizTotal: input.quizTotal,
        practiceDone: input.practiceDone,
      }).catch(() => undefined);
    }

    if (txResult.firstCompletion) {
      try {
        await this.weeks.onLessonCompleted(
          userId,
          lesson.id,
          txResult.minutes,
          txResult.response.attemptId ?? undefined,
        );
      } catch {
        /* seal optional */
      }
      void this.timing
        .onLessonCompleted(userId, lesson.id, txResult.minutes)
        .catch(() => undefined);

      // Doc 07 — roadmap graduation check after lesson TX commits.
      // Await finalize so the client can deep-link to graduation; side effects
      // inside finalize (rewards/coach/outbox) stay fire-and-forget.
      if (txResult.roadmapId) {
        try {
          const completed = await this.roadmapCompletion.checkRoadmapCompletion(
            userId,
            txResult.roadmapId,
          );
          if (completed) {
            txResult.response.roadmapCompleted = true;
            txResult.response.roadmapId = txResult.roadmapId;
          }
        } catch {
          /* graduation optional — never fail lesson complete */
        }

        try {
          const nudge = await this.crossTrack.maybeSurface({
            userId,
            roadmapId: txResult.roadmapId,
            remainingBudgetMinutes: 30,
            justCompletedUnitRole: lesson.unitRole,
          });
          if (nudge.surfaced && nudge.unitId && nudge.title) {
            txResult.response.crossTrackNudge = {
              unitId: nudge.unitId,
              title: nudge.title,
              estimatedMinutes: nudge.estimatedMinutes ?? 0,
              optional: true,
            };
          }
        } catch {
          /* cross-track optional */
        }
      }
    }

    if (lesson.lessonTemplateId) {
      void this.quality
        .recordLessonSample({
          lessonTemplateId: lesson.lessonTemplateId,
          completed: true,
          durationMs: txResult.minutes * 60_000,
          estimatedMinutes: lesson.estimatedMinutes,
          quizPassed:
            txResult.response.quizScore.correct >=
            Math.ceil(Math.max(1, txResult.response.quizScore.total) * 0.7),
          hintUsed: txResult.hintUsed,
        })
        .catch(() => undefined);
    }

    void this.gamification.processPendingOutbox().catch(() => undefined);

    return txResult.response;
  }

  /**
   * Post-commit skill evidence from lesson performance.
   *
   * For each skill the lesson teaches (lesson snapshot, falling back to the
   * source unit), update the matching LearnerSkillEstimate on the user's
   * ACTIVE profile (latest provisional/verified version). Idempotency is
   * keyed by attemptId+skillSlug via evidenceMeta.lastAttemptIds.
   *
   * - shaky completion (remediation used or low quiz score): confidence may
   *   drop to low; verifiedStage is NEVER raised here.
   * - strong completion (no remediation, high score): provisionalStage may
   *   move toward the profile target by at most 1, confidence to medium.
   * - strong checkpoint quiz: verifiedStage is raised to the proven stage.
   */
  private async recordSkillEvidence(input: {
    userId: string;
    lesson: Lesson;
    attemptId: string;
    quizCorrect: number;
    quizTotal: number;
    practiceDone: boolean;
  }): Promise<void> {
    const { userId, lesson, attemptId } = input;
    const skillSlugs = await this.resolveSkillsTaught(lesson);
    if (!skillSlugs.length) return;

    const profile = await this.dataSource
      .getRepository(LearnerProfileSnapshot)
      .findOne({
        where: [
          { userId, status: LearnerProfileStatus.Provisional },
          { userId, status: LearnerProfileStatus.Verified },
        ],
        order: { version: 'DESC' },
      });
    if (!profile) return;

    const hadRemediation = await this.dataSource
      .getRepository(RemediationEvent)
      .exists({ where: { attemptId } });
    const scorePercent =
      input.quizTotal > 0
        ? Math.round((input.quizCorrect / input.quizTotal) * 100)
        : 100;
    const shaky = hadRemediation || (input.quizTotal > 0 && scorePercent < 70);
    const strong =
      !hadRemediation &&
      (input.quizTotal > 0 ? scorePercent >= 80 : input.practiceDone);
    const isCheckpointQuiz =
      lesson.unitRole === 'checkpoint' && input.quizTotal > 0;
    const maxServedStage = Math.max(0, ...(lesson.servesStage ?? []));
    let changed = false;

    // Estimates are keyed by coarse profiling slugs (`html-css`), while units
    // teach namespaced slugs (`html-css:selectors`) — group by coarse slug.
    const byCoarse = new Map<string, string[]>();
    for (const slug of skillSlugs) {
      const coarse = (slug.includes(':') ? slug.split(':')[0]! : slug)
        .trim()
        .toLowerCase();
      if (!coarse) continue;
      const list = byCoarse.get(coarse) ?? [];
      list.push(slug);
      byCoarse.set(coarse, list);
    }

    const estimatesRepo = this.dataSource.getRepository(LearnerSkillEstimate);
    for (const [coarseSlug, taughtSlugs] of byCoarse) {
      try {
        let estimate = await estimatesRepo.findOne({
          where: { profileId: profile.id, skillSlug: coarseSlug },
        });
        if (!estimate) {
          estimate = estimatesRepo.create({
            profileId: profile.id,
            skillSlug: coarseSlug,
            selfExposureLevel: 'unknown',
            provisionalStage: 1,
            verifiedStage: null,
            confidence: StageConfidence.Low,
            evidenceSource: SkillEvidenceSource.LessonPerformance,
            evidenceMeta: {},
          });
        }

        const meta = { ...(estimate.evidenceMeta ?? {}) };
        const lastAttemptIds = {
          ...((meta.lastAttemptIds as Record<string, string>) ?? {}),
        };
        // Idempotent per attemptId+skillSlug — skip already-recorded evidence.
        const pending = taughtSlugs.filter(
          (slug) => lastAttemptIds[slug] !== attemptId,
        );
        if (!pending.length) continue;
        for (const slug of pending) lastAttemptIds[slug] = attemptId;

        meta.lastAttemptIds = lastAttemptIds;
        meta.lastLessonEvidence = {
          attemptId,
          lessonId: lesson.id,
          unitId: lesson.unitId,
          scorePercent,
          hadRemediation,
          at: new Date().toISOString(),
        };
        estimate.evidenceMeta = meta;
        estimate.evidenceSource = SkillEvidenceSource.LessonPerformance;

        if (shaky) {
          // Never raise verifiedStage on shaky evidence; lower confidence.
          estimate.confidence = StageConfidence.Low;
        } else if (strong) {
          const targetStage = profile.targetStage ?? estimate.provisionalStage;
          if (estimate.provisionalStage < targetStage) {
            estimate.provisionalStage += 1;
          }
          if (isCheckpointQuiz) {
            const provenStage = Math.min(
              estimate.provisionalStage,
              targetStage,
              maxServedStage || targetStage,
            );
            estimate.verifiedStage = Math.max(
              estimate.verifiedStage ?? 0,
              provenStage,
            );
            estimate.confidence = StageConfidence.High;
          }
          if (estimate.confidence === StageConfidence.Low) {
            estimate.confidence = StageConfidence.Medium;
          }
        }

        await estimatesRepo.save(estimate);
        changed = true;
      } catch {
        /* evidence failure must not affect learner */
      }
    }
    if (changed) {
      await this.refreshProfileStageFromEstimates(profile.id);
    }
  }

  private async refreshProfileStageFromEstimates(profileId: string): Promise<void> {
    try {
      const estimates = await this.dataSource
        .getRepository(LearnerSkillEstimate)
        .find({ where: { profileId } });
      if (!estimates.length) return;

      const median = (values: number[]): number => {
        const sorted = values
          .filter((v) => Number.isFinite(v) && v > 0)
          .sort((a, b) => a - b);
        if (!sorted.length) return 1;
        return sorted[Math.floor((sorted.length - 1) / 2)] ?? 1;
      };

      const profileRepo = this.dataSource.getRepository(LearnerProfileSnapshot);
      const profile = await profileRepo.findOne({ where: { id: profileId } });
      if (!profile) return;

      const provisionalStage = Math.max(
        profile.provisionalStage,
        median(estimates.map((e) => e.provisionalStage)),
      );
      const verifiedValues = estimates
        .map((e) => e.verifiedStage)
        .filter((v): v is number => v != null);
      const verifiedStage = verifiedValues.length
        ? Math.max(profile.verifiedStage ?? 0, median(verifiedValues))
        : profile.verifiedStage;

      profile.provisionalStage = provisionalStage;
      profile.verifiedStage = verifiedStage && verifiedStage > 0 ? verifiedStage : null;
      profile.stageGap = Math.max(0, profile.targetStage - provisionalStage);
      if (
        profile.verifiedStage != null &&
        profile.verifiedStage >= profile.provisionalStage
      ) {
        profile.stageConfidence = StageConfidence.High;
      }
      await profileRepo.save(profile);
    } catch {
      /* profile refresh failure must not affect completion */
    }
  }

  /** Lesson snapshot first; fall back to the source unit's skillsTaught. */
  private async resolveSkillsTaught(lesson: Lesson): Promise<string[]> {
    if (lesson.skillsTaught?.length) return lesson.skillsTaught;
    if (!lesson.unitId) return [];
    try {
      const unit = await this.dataSource
        .getRepository(Unit)
        .findOne({ where: { id: lesson.unitId } });
      return unit?.skillsTaught ?? [];
    } catch {
      return [];
    }
  }

  /** Emit lesson.remediation.v1 per round — never throws into completion path. */
  private async emitRemediationAnalytics(
    attemptId: string,
    lessonId: string,
  ): Promise<void> {
    const events = await this.dataSource.getRepository(RemediationEvent).find({
      where: { attemptId },
      order: { round: 'ASC' },
    });
    for (const ev of events) {
      try {
        await this.gamification.enqueueLessonRemediation({
          attemptId,
          lessonId,
          conceptTag: ev.conceptTag,
          round: ev.round,
          outcome: ev.outcome,
        });
      } catch {
        /* analytics failure must not affect learner */
      }
    }
  }
}
