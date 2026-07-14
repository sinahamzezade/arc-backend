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
import { TimingService } from '../course-timing/timing.service';
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
import type { LessonPlayOutline } from './lesson-play.types';
import { collectConceptTags } from '../skill-graph/seeds/transform-curriculum';

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
};

@Injectable()
export class LessonCompletionOrchestrator {
  constructor(
    private readonly dataSource: DataSource,
    private readonly rewards: LessonRewardsService,
    private readonly unlock: LessonUnlockService,
    private readonly gamification: GamificationService,
    private readonly streaks: StreakService,
    @InjectRepository(LessonCompletionResult)
    private readonly resultsRepo: Repository<LessonCompletionResult>,
    @Inject(forwardRef(() => WeeksService))
    private readonly weeks: WeeksService,
    private readonly quality: ContentQualityService,
    private readonly timing: TimingService,
  ) {}

  resolveContentVersionId(lesson: Lesson): string {
    return (
      lesson.sourceVersionId ??
      lesson.lessonTemplate?.publishedVersionId ??
      lesson.lessonTemplateId ??
      lesson.id
    );
  }

  async complete(input: {
    userId: string;
    lesson: Lesson;
    outline: LessonPlayOutline;
    dto: CompleteLessonDto;
    idempotencyKey: string;
    contentVersionId?: string;
    contentSchemaVersion?: number;
    attempt?: LessonAttempt | null;
  }): Promise<CompleteLessonResponse> {
    const { userId, lesson, outline, dto, idempotencyKey } = input;
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

      const quizAnswers = {
        ...(progress?.sessionState?.quizAnswers ?? {}),
        ...(dto.quizAnswers ?? {}),
      };
      const practiceOptionId =
        dto.practiceOptionId ??
        progress?.sessionState?.practiceOptionId ??
        null;

      let quizCorrect = 0;
      for (const q of outline.quiz) {
        if (quizAnswers[q.id] === q.correctOptionId) quizCorrect += 1;
      }
      const quizTotal = outline.quiz.length;
      const practiceCorrect = practiceOptionId
        ? Boolean(
            outline.practice.options.find(
              (o) => o.id === practiceOptionId && o.correct,
            ),
          )
        : null;

      const completedCount = await progressRepo.count({
        where: { userId, status: LessonProgressStatus.Completed },
      });
      const isFirstLessonEver = completedCount === 0 && !previouslyAwarded;

      const pathPercentile = await this.unlock.pathPercentile(manager, lesson);
      const assistance = this.rewards.mapAssistance(attempt?.assistanceUsed);

      const conceptTags = collectConceptTags(outline);
      const mastery = attempt?.conceptMastery ?? {};
      const shakyConcepts = conceptTags.filter(
        (tag) => mastery[tag]?.state === 'shaky',
      );
      const conceptsMastered = conceptTags.filter((tag) => {
        const s = mastery[tag]?.state;
        return s === 'mastered' || s === 'recovered';
      }).length;
      const conceptsTotal = conceptTags.length;

      const remediationRepo = manager.getRepository(RemediationEvent);
      const remediationRoundsUsed = attempt
        ? await remediationRepo.count({ where: { attemptId: attempt.id } })
        : 0;

      const reward = this.rewards.computeReward({
        lesson,
        outline,
        quizCorrect,
        quizTotal,
        alreadyCompleted: previouslyAwarded,
        isFirstLessonEver,
        pathPercentile,
        assistance,
        attemptKind: previouslyAwarded ? 'review_later' : 'first',
        conceptsMastered,
        conceptsTotal,
        remediationRoundsUsed,
        hasShakyConcepts: shakyConcepts.length > 0,
      });

      const qualifiedLeagueXp = reward.firstTime ? reward.xp : 0;

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
        practiceDone: true,
        practiceOptionId,
        quizAnswers,
      };

      const grant = await this.gamification.grantInTx(manager, {
        userId,
        reasonType: RewardReasonType.Lesson,
        reasonId: lesson.id,
        idempotencyKey: `lesson-complete:${lesson.id}:${attempt.id}`,
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
        conceptsTotal,
        conceptsMastered,
        remediationRoundsUsed,
        shakyConcepts,
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
      };
    });

    // §16.7 remediation analytics — fire-and-forget AFTER commit
    if (txResult.attemptId) {
      void this.emitRemediationAnalytics(
        txResult.attemptId,
        txResult.lessonId,
      ).catch(() => undefined);
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
