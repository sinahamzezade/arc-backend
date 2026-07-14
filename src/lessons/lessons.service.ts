import { HttpStatus, Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  CONTENT_SCHEMA_VERSION,
  REWARD_RULE_VERSION,
} from '../gamification/reward-constants';
import { Lesson, LessonStatus } from '../roadmaps/entities/lesson.entity';
import {
  LessonProgress,
  LessonProgressStatus,
} from '../roadmaps/entities/lesson-progress.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { WeeksService } from '../weeks/weeks.service';
import {
  CheckPracticeDto,
  CheckQuizDto,
  CompleteLessonDto,
  UpdateLessonProgressDto,
} from './dto/lesson-play.dto';
import {
  LessonAttempt,
  LessonAttemptStatus,
} from './entities/lesson-attempt.entity';
import { LessonArloService } from './lesson-arlo.service';
import { LessonCompletionOrchestrator } from './lesson-completion.orchestrator';
import { LessonContentService } from './lesson-content.service';
import { LessonRemediationService } from './lesson-remediation.service';
import { LessonRewardsService } from './lesson-rewards.service';
import { LessonUnlockService } from './lesson-unlock.service';

type OwnedLessonContext = {
  lesson: Lesson;
  lessonNumber: number;
  progress: LessonProgress | null;
};

@Injectable()
export class LessonsService {
  constructor(
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    @InjectRepository(LessonProgress)
    private readonly progressRepo: Repository<LessonProgress>,
    @InjectRepository(LessonAttempt)
    private readonly attemptsRepo: Repository<LessonAttempt>,
    private readonly content: LessonContentService,
    private readonly remediation: LessonRemediationService,
    private readonly rewards: LessonRewardsService,
    private readonly unlock: LessonUnlockService,
    private readonly orchestrator: LessonCompletionOrchestrator,
    private readonly arlo: LessonArloService,
    @Inject(forwardRef(() => WeeksService))
    private readonly _weeks: WeeksService,
  ) {
    void this._weeks;
  }

  async getPlay(userId: string, lessonId: string) {
    const ctx = await this.requireOwnedLesson(userId, lessonId, {
      allowLocked: false,
    });
    const { lesson, lessonNumber, progress } = ctx;

    let pinnedVersionId: string | null = null;
    if (progress?.activeAttemptId) {
      const attempt = await this.attemptsRepo.findOne({
        where: { id: progress.activeAttemptId },
      });
      pinnedVersionId = attempt?.contentVersionId ?? null;
    }

    const resolved = await this.content.resolveAuthoritative(
      lesson,
      lesson.lessonTemplate,
      pinnedVersionId,
    );
    const { outline } = resolved;
    const publicBody = this.content.toPublicPlayBody(outline);
    const isFirstEver = await this.isFirstLessonEver(userId);
    const roadmap = lesson.milestone.phase.roadmap;
    const pathPercentile = this.unlock.percentileInRoadmap(roadmap, lesson.id);
    const preview = this.rewards.previewReward({
      lesson,
      outline,
      isFirstLessonEver: isFirstEver,
      pathPercentile,
    });

    const resource = lesson.resource
      ? {
          id: lesson.resource.id,
          label: lesson.resource.title,
          href: lesson.resource.url,
          note: `${lesson.resource.provider} · open before you practice`,
          provider: lesson.resource.provider,
        }
      : {
          id: null,
          label: 'Resource coming soon',
          href: '/path',
          note: 'No catalog link on this lesson yet — study the objective, then practice.',
          provider: null,
        };

    const session = progress?.sessionState ?? {};
    const serverNow = new Date().toISOString();

    return {
      id: lesson.id,
      lessonNumber,
      title: lesson.title,
      missionName: lesson.missionName,
      minutes: lesson.estimatedMinutes,
      xpReward: preview.xp,
      objective: lesson.objective ?? outline.objective,
      status: lesson.status,
      contentVersionId: resolved.contentVersionId,
      contentSchemaVersion: resolved.contentSchemaVersion,
      rewardRuleVersion: REWARD_RULE_VERSION,
      attemptId: progress?.activeAttemptId ?? null,
      serverTime: serverNow,
      contentSource: {
        lessonTemplateId: lesson.lessonTemplateId ?? null,
        lessonVersionId: resolved.contentVersionId,
        version: resolved.contentSchemaVersion,
        status: lesson.lessonTemplate?.status ?? null,
        rewardClass: lesson.lessonTemplate?.rewardClass ?? null,
        source: resolved.source,
      },
      resource,
      arloPrompt: outline.arloPrompt,
      content: publicBody.content,
      practice: publicBody.practice,
      quiz: publicBody.quiz,
      adaptive: publicBody.adaptive,
      rewardPreview: {
        xp: preview.xp,
        gems: preview.gems,
        coins: preview.coins,
        badgeId: preview.badgeId,
        badgeLabel: preview.badgeLabel,
        arloLine: preview.arloLine,
      },
      suggestedArlo: publicBody.suggestedArlo,
      progress: {
        status: progress?.status ?? LessonProgressStatus.NotStarted,
        contentStep: session.contentStep ?? 0,
        practiceDone: session.practiceDone ?? false,
        practiceOptionId: session.practiceOptionId ?? null,
        quizAnswers: session.quizAnswers ?? {},
        quizIndex: session.quizIndex ?? 0,
        startedAt: progress?.startedAt ?? null,
        completedAt: progress?.completedAt ?? null,
      },
    };
  }

  async start(userId: string, lessonId: string) {
    const { lesson, progress } = await this.requireOwnedLesson(
      userId,
      lessonId,
      { allowLocked: false },
    );

    const resolved = await this.content.resolveAuthoritative(
      lesson,
      lesson.lessonTemplate,
    );
    const contentVersionId = resolved.contentVersionId;

    let row = progress;
    if (!row) {
      row = this.progressRepo.create({
        userId,
        lessonId: lesson.id,
        status: LessonProgressStatus.InProgress,
        startedAt: new Date(),
        sessionState: {},
      });
    } else if (row.status === LessonProgressStatus.Completed) {
      row.retryCount += 1;
      row.status = LessonProgressStatus.InProgress;
      row.sessionState = {};
      row.completedAt = null;
      row.activeAttemptId = null;
    } else if (row.status === LessonProgressStatus.NotStarted) {
      row.status = LessonProgressStatus.InProgress;
      row.startedAt = row.startedAt ?? new Date();
    } else {
      row.startedAt = row.startedAt ?? new Date();
    }

    row = await this.progressRepo.save(row);

    const attempt = await this.ensureActiveAttempt(
      userId,
      lesson,
      row,
      contentVersionId,
      resolved.contentSchemaVersion,
    );
    row.activeAttemptId = attempt.id;
    row = await this.progressRepo.save(row);

    return {
      lessonId: lesson.id,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? new Date().toISOString(),
      attemptId: attempt.id,
      contentVersionId,
      contentSchemaVersion: resolved.contentSchemaVersion,
      rewardRuleVersion: REWARD_RULE_VERSION,
    };
  }

  async saveProgress(
    userId: string,
    lessonId: string,
    dto: UpdateLessonProgressDto,
  ) {
    const { lesson, progress } = await this.requireOwnedLesson(
      userId,
      lessonId,
      { allowLocked: false },
    );

    let row =
      progress ??
      this.progressRepo.create({
        userId,
        lessonId: lesson.id,
        status: LessonProgressStatus.InProgress,
        startedAt: new Date(),
        sessionState: {},
      });

    if (row.status === LessonProgressStatus.NotStarted) {
      row.status = LessonProgressStatus.InProgress;
      row.startedAt = row.startedAt ?? new Date();
    }

    let attempt: LessonAttempt | null = null;
    if (dto.attemptId || row.activeAttemptId) {
      attempt = await this.requireAttempt(
        userId,
        lesson,
        row,
        dto.attemptId ?? row.activeAttemptId!,
      );
    }

    const resolved = await this.content.resolveAuthoritative(
      lesson,
      lesson.lessonTemplate,
      attempt?.contentVersionId,
    );

    // Client may submit navigation / incremental answers only.
    const session = { ...(row.sessionState ?? {}) };
    if (dto.contentStep !== undefined) session.contentStep = dto.contentStep;
    if (dto.practiceOptionId !== undefined) {
      if (
        !this.content.hasValidAnswerIds(resolved.outline, {
          practiceOptionId: dto.practiceOptionId,
        })
      ) {
        throw new AppException(
          AuthErrorCode.LESSON_INVALID_ANSWER,
          'practiceOptionId not valid for content version',
          HttpStatus.BAD_REQUEST,
        );
      }
      session.practiceOptionId = dto.practiceOptionId;
    }
    if (dto.quizAnswers !== undefined) {
      if (
        !this.content.hasValidAnswerIds(resolved.outline, {
          quizAnswers: dto.quizAnswers,
        })
      ) {
        throw new AppException(
          AuthErrorCode.LESSON_INVALID_ANSWER,
          'quizAnswers not valid for content version',
          HttpStatus.BAD_REQUEST,
        );
      }
      session.quizAnswers = {
        ...(session.quizAnswers ?? {}),
        ...dto.quizAnswers,
      };
    }
    if (dto.quizIndex !== undefined) session.quizIndex = dto.quizIndex;
    if (dto.timeSpentMinutes !== undefined) {
      const prev = row.timeSpentMinutes ?? 0;
      const next = Math.max(prev, dto.timeSpentMinutes);
      row.timeSpentMinutes = Math.min(next, prev + 120);
    }
    row.sessionState = session;

    row = await this.progressRepo.save(row);
    return {
      lessonId: lesson.id,
      status: row.status,
      sessionState: row.sessionState,
      timeSpentMinutes: row.timeSpentMinutes,
      attemptId: row.activeAttemptId,
    };
  }

  async checkPractice(
    userId: string,
    lessonId: string,
    dto: CheckPracticeDto,
  ) {
    const { lesson, progress } = await this.requireOwnedLesson(
      userId,
      lessonId,
      { allowLocked: false },
    );
    const attempt = await this.requireAttempt(
      userId,
      lesson,
      progress,
      dto.attemptId,
    );
    const resolved = await this.content.resolveAuthoritative(
      lesson,
      lesson.lessonTemplate,
      attempt.contentVersionId,
    );
    const outline = resolved.outline;
    const itemId = dto.itemId ?? outline.practice.id;

    if (dto.hintUsed) {
      attempt.assistanceUsed = {
        ...(attempt.assistanceUsed ?? {}),
        hintUsed: true,
        hintCount: Number(attempt.assistanceUsed?.hintCount ?? 0) + 1,
      };
      await this.attemptsRepo.save(attempt);
    }

    const graded = await this.remediation.grade(attempt, outline, {
      itemId,
      optionId: dto.optionId,
    });

    // Only mark practiceDone for the primary practice item (not recovery)
    if (itemId === outline.practice.id) {
      await this.patchSession(userId, lesson.id, progress, {
        practiceDone: true,
        practiceOptionId: dto.optionId,
      });
    }

    return {
      correct: graded.correct,
      correctOptionId: graded.correctOptionId,
      feedback: graded.feedback,
      remediation: graded.remediation,
    };
  }

  async checkQuiz(userId: string, lessonId: string, dto: CheckQuizDto) {
    const { lesson, progress } = await this.requireOwnedLesson(
      userId,
      lessonId,
      { allowLocked: false },
    );
    const attempt = await this.requireAttempt(
      userId,
      lesson,
      progress,
      dto.attemptId,
    );
    const resolved = await this.content.resolveAuthoritative(
      lesson,
      lesson.lessonTemplate,
      attempt.contentVersionId,
    );
    const outline = resolved.outline;
    const itemId = dto.itemId ?? dto.questionId;
    if (!itemId) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'itemId is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const graded = await this.remediation.grade(attempt, outline, {
      itemId,
      optionId: dto.optionId,
    });

    // Persist quiz answers only for primary quiz questions
    if (outline.quiz.some((q) => q.id === itemId)) {
      const answers = {
        ...(progress?.sessionState?.quizAnswers ?? {}),
        [itemId]: dto.optionId,
      };
      await this.patchSession(userId, lesson.id, progress, {
        quizAnswers: answers,
      });
    }

    return {
      correct: graded.correct,
      correctOptionId: graded.correctOptionId,
      explanation: graded.explanation,
      remediation: graded.remediation,
    };
  }

  async complete(
    userId: string,
    lessonId: string,
    dto: CompleteLessonDto,
    idempotencyKey: string,
  ) {
    const ctx = await this.requireOwnedLesson(userId, lessonId, {
      allowLocked: false,
    });
    const { lesson, progress } = ctx;
    const attempt = await this.requireAttempt(
      userId,
      lesson,
      progress,
      dto.attemptId,
    );
    const resolved = await this.content.resolveAuthoritative(
      lesson,
      lesson.lessonTemplate,
      attempt.contentVersionId,
    );
    if (
      !this.content.hasValidAnswerIds(resolved.outline, {
        practiceOptionId: dto.practiceOptionId,
        quizAnswers: dto.quizAnswers,
      })
    ) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Answers not valid for content version',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.orchestrator.complete({
      userId,
      lesson,
      outline: resolved.outline,
      dto,
      idempotencyKey,
      contentVersionId: resolved.contentVersionId,
      contentSchemaVersion: resolved.contentSchemaVersion,
      attempt,
    });
  }

  async arloChat(userId: string, lessonId: string, message: string) {
    if (!(await this.arlo.isFlagEnabled(userId))) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Arlo lesson AI is disabled',
        HttpStatus.BAD_REQUEST,
      );
    }
    const { lesson, progress } = await this.requireOwnedLesson(
      userId,
      lessonId,
      { allowLocked: true },
    );
    let pinned: string | null = null;
    if (progress?.activeAttemptId) {
      const attempt = await this.attemptsRepo.findOne({
        where: { id: progress.activeAttemptId },
      });
      pinned = attempt?.contentVersionId ?? null;
    }
    const resolved = await this.content.resolveAuthoritative(
      lesson,
      lesson.lessonTemplate,
      pinned,
    );
    return this.arlo.chat({
      userId,
      lesson,
      outline: resolved.outline,
      message,
    });
  }

  private async ensureActiveAttempt(
    userId: string,
    lesson: Lesson,
    progress: LessonProgress,
    contentVersionId: string,
    contentSchemaVersion = CONTENT_SCHEMA_VERSION,
  ): Promise<LessonAttempt> {
    if (progress.activeAttemptId) {
      const existing = await this.attemptsRepo.findOne({
        where: { id: progress.activeAttemptId },
      });
      if (
        existing &&
        existing.status === LessonAttemptStatus.InProgress &&
        existing.contentVersionId === contentVersionId
      ) {
        return existing;
      }
      if (existing && existing.status === LessonAttemptStatus.InProgress) {
        existing.status = LessonAttemptStatus.Abandoned;
        await this.attemptsRepo.save(existing);
      }
    }

    const last =
      (
        await this.attemptsRepo.find({
          where: { userId, lessonId: lesson.id },
          order: { attemptNumber: 'DESC' },
          take: 1,
        })
      )[0]?.attemptNumber ?? 0;

    return this.attemptsRepo.save(
      this.attemptsRepo.create({
        userId,
        lessonId: lesson.id,
        lessonProgressId: progress.id,
        attemptNumber: last + 1,
        contentVersionId,
        contentSchemaVersion,
        rewardRuleVersion: REWARD_RULE_VERSION,
        status: LessonAttemptStatus.InProgress,
        startedAt: progress.startedAt ?? new Date(),
        rewardEligible: true,
        assistanceUsed: {},
      }),
    );
  }

  /** Require attemptId — must match active attempt + pinned content version. */
  private async requireAttempt(
    userId: string,
    lesson: Lesson,
    progress: LessonProgress | null,
    attemptId: string,
  ): Promise<LessonAttempt> {
    if (!attemptId?.trim()) {
      throw new AppException(
        AuthErrorCode.LESSON_ATTEMPT_MISMATCH,
        'attemptId is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const attempt = await this.attemptsRepo.findOne({
      where: { id: attemptId, userId, lessonId: lesson.id },
    });
    if (!attempt) {
      throw new AppException(
        AuthErrorCode.LESSON_ATTEMPT_MISMATCH,
        'Invalid or expired attempt',
        HttpStatus.CONFLICT,
      );
    }
    if (
      progress?.activeAttemptId &&
      progress.activeAttemptId !== attemptId
    ) {
      throw new AppException(
        AuthErrorCode.LESSON_ATTEMPT_MISMATCH,
        'Attempt is not the active session',
        HttpStatus.CONFLICT,
      );
    }
    if (
      attempt.status !== LessonAttemptStatus.InProgress &&
      attempt.status !== LessonAttemptStatus.Completed
    ) {
      throw new AppException(
        AuthErrorCode.LESSON_ATTEMPT_MISMATCH,
        'Attempt is not active',
        HttpStatus.CONFLICT,
      );
    }
    return attempt;
  }

  /** @deprecated use requireAttempt */
  private async assertAttempt(
    userId: string,
    lesson: Lesson,
    progress: LessonProgress | null,
    attemptId?: string,
  ) {
    if (!attemptId) {
      throw new AppException(
        AuthErrorCode.LESSON_ATTEMPT_MISMATCH,
        'attemptId is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    await this.requireAttempt(userId, lesson, progress, attemptId);
  }

  private async patchSession(
    userId: string,
    lessonId: string,
    progress: LessonProgress | null,
    patch: LessonProgress['sessionState'],
  ) {
    let row =
      progress ??
      this.progressRepo.create({
        userId,
        lessonId,
        status: LessonProgressStatus.InProgress,
        startedAt: new Date(),
        sessionState: {},
      });
    if (row.status === LessonProgressStatus.NotStarted) {
      row.status = LessonProgressStatus.InProgress;
      row.startedAt = row.startedAt ?? new Date();
    }
    row.sessionState = { ...(row.sessionState ?? {}), ...patch };
    await this.progressRepo.save(row);
  }

  private async isFirstLessonEver(userId: string): Promise<boolean> {
    const count = await this.progressRepo.count({
      where: { userId, status: LessonProgressStatus.Completed },
    });
    return count === 0;
  }

  private async requireOwnedLesson(
    userId: string,
    lessonId: string,
    opts: { allowLocked: boolean },
  ): Promise<OwnedLessonContext> {
    const lesson = await this.lessonsRepo.findOne({
      where: { id: lessonId },
      relations: {
        resource: true,
        lessonTemplate: true,
        milestone: {
          phase: {
            roadmap: {
              phases: {
                milestones: {
                  lessons: true,
                },
              },
            },
          },
        },
      },
    });

    if (!lesson?.milestone?.phase?.roadmap) {
      throw new AppException(
        AuthErrorCode.LESSON_NOT_FOUND,
        'Lesson not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const roadmap = lesson.milestone.phase.roadmap;
    if (roadmap.userId !== userId) {
      throw new AppException(
        AuthErrorCode.LESSON_NOT_FOUND,
        'Lesson not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (!opts.allowLocked && lesson.status === LessonStatus.Locked) {
      throw new AppException(
        AuthErrorCode.LESSON_LOCKED,
        'Lesson is locked',
        HttpStatus.FORBIDDEN,
      );
    }

    const lessonNumber = this.ordinalInRoadmap(roadmap, lesson.id);
    const progress = await this.progressRepo.findOne({
      where: { userId, lessonId },
    });

    return { lesson, lessonNumber, progress };
  }

  private ordinalInRoadmap(roadmap: Roadmap, lessonId: string): number {
    let ordinal = 0;
    const phases = [...(roadmap.phases ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    for (const phase of phases) {
      const milestones = [...(phase.milestones ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      for (const milestone of milestones) {
        const lessons = [...(milestone.lessons ?? [])].sort(
          (a, b) => a.orderIndex - b.orderIndex,
        );
        for (const lesson of lessons) {
          ordinal += 1;
          if (lesson.id === lessonId) return ordinal;
        }
      }
    }
    return ordinal || 1;
  }
}
