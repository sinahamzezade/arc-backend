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
import { isQuizContent, type UnitPlayContent } from './lesson-play.types';
import { LessonRewardsService } from './lesson-rewards.service';
import { LessonUnlockService } from './lesson-unlock.service';
import { RoadmapTreeLoader } from '../roadmaps/roadmap-tree.loader';

const QUIZ_LESSON_TYPE = 'quiz';
const SELF_ATTEST_LESSON_TYPES = new Set([
  'practice',
  'mini_project',
  'interactive',
]);

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
    private readonly rewards: LessonRewardsService,
    private readonly unlock: LessonUnlockService,
    private readonly treeLoader: RoadmapTreeLoader,
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

    const content = await this.content.ensurePlayContent(lesson);
    const body = this.content.toPublicPlayBody(content);
    const isFirstEver = await this.isFirstLessonEver(userId);
    const roadmap = lesson.milestone.phase.roadmap;
    const pathPercentile = this.unlock.percentileInRoadmap(roadmap, lesson.id);
    const preview = this.rewards.previewReward({
      lesson,
      quizTotal: this.content.quizTotal(content),
      isFirstLessonEver: isFirstEver,
      pathPercentile,
    });

    const session = progress?.sessionState ?? {};
    const serverNow = new Date().toISOString();

    return {
      id: lesson.id,
      lessonNumber,
      title: lesson.title,
      missionName: lesson.missionName,
      lessonType: lesson.lessonType,
      minutes: lesson.estimatedMinutes,
      xp: lesson.xpReward,
      xpReward: preview.xp,
      objective: lesson.objective ?? content.objective,
      status: lesson.status,
      provider: lesson.provider,
      url: lesson.url,
      level: lesson.level ?? 1,
      unitId: lesson.unitId,
      contentVersionId: this.contentVersionIdOf(lesson),
      rewardRuleVersion: REWARD_RULE_VERSION,
      attemptId: progress?.activeAttemptId ?? null,
      serverTime: serverNow,
      /** Safe adaptive context — unit snapshot only, no private profile data. */
      adaptive: {
        unitRole: lesson.unitRole,
        servesStage: lesson.servesStage ?? [],
        entryAction: lesson.entryAction,
        skillsTaught: lesson.skillsTaught ?? [],
      },
      /** Type-specific unit body with answer/explain stripped. */
      body,
      rewardPreview: {
        xp: preview.xp,
        gems: preview.gems,
        coins: preview.coins,
        badgeId: preview.badgeId,
        badgeLabel: preview.badgeLabel,
        arloLine: preview.arloLine,
      },
      progress: {
        status: progress?.status ?? LessonProgressStatus.NotStarted,
        contentStep: session.contentStep ?? 0,
        practiceDone: session.practiceDone ?? false,
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

    // Content must be materialized before a session can start.
    await this.content.ensurePlayContent(lesson);
    const contentVersionId = this.contentVersionIdOf(lesson);

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
    );
    row.activeAttemptId = attempt.id;
    row = await this.progressRepo.save(row);

    return {
      lessonId: lesson.id,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? new Date().toISOString(),
      attemptId: attempt.id,
      contentVersionId,
      contentSchemaVersion: CONTENT_SCHEMA_VERSION,
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

    if (dto.attemptId || row.activeAttemptId) {
      await this.requireAttempt(
        userId,
        lesson,
        row,
        dto.attemptId ?? row.activeAttemptId!,
      );
    }

    const content = await this.content.ensurePlayContent(lesson);

    const session = { ...(row.sessionState ?? {}) };
    if (dto.contentStep !== undefined) session.contentStep = dto.contentStep;
    if (dto.practiceDone !== undefined) {
      session.practiceDone = dto.practiceDone;
    }
    if (dto.quizAnswers !== undefined) {
      this.assertQuizAnswerIds(content, dto.quizAnswers);
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

  /**
   * Self-attest completion of the task for practice / mini_project /
   * interactive lessons. There is no server-graded practice MCQ anymore.
   */
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
    // Validates content exists; also guards quiz lessons out of this endpoint.
    await this.content.ensurePlayContent(lesson);
    if (lesson.lessonType === QUIZ_LESSON_TYPE) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Use quiz/check for quiz lessons',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (dto.hintUsed) {
      attempt.assistanceUsed = {
        ...(attempt.assistanceUsed ?? {}),
        hintUsed: true,
        hintCount: Number(attempt.assistanceUsed?.hintCount ?? 0) + 1,
      };
      await this.attemptsRepo.save(attempt);
    }

    const done = dto.done !== false;
    if (done) {
      await this.patchSession(userId, lesson.id, progress, {
        practiceDone: true,
      });
    }

    return { correct: true, done };
  }

  /** Grade one quiz question by id (`q0`..) or index against the snapshot. */
  async checkQuiz(userId: string, lessonId: string, dto: CheckQuizDto) {
    const { lesson, progress } = await this.requireOwnedLesson(
      userId,
      lessonId,
      { allowLocked: false },
    );
    await this.requireAttempt(userId, lesson, progress, dto.attemptId);
    const content = await this.content.ensurePlayContent(lesson);

    if (dto.questionId == null && dto.questionIndex == null) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'questionId or questionIndex is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const graded = this.content.gradeQuizQuestion(content, {
      questionId: dto.questionId,
      questionIndex: dto.questionIndex,
      optionIndex: dto.optionIndex,
      booleanAnswer: dto.booleanAnswer,
    });

    const submitted =
      dto.booleanAnswer !== undefined ? dto.booleanAnswer : dto.optionIndex!;
    const answers = {
      ...(progress?.sessionState?.quizAnswers ?? {}),
      [graded.questionId]: submitted,
    };
    await this.patchSession(userId, lesson.id, progress, {
      quizAnswers: answers,
    });

    return {
      questionId: graded.questionId,
      correct: graded.correct,
      answer: graded.answer,
      explain: graded.explain,
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
    const content = await this.content.ensurePlayContent(lesson);

    const quizAnswers = {
      ...(progress?.sessionState?.quizAnswers ?? {}),
      ...(dto.quizAnswers ?? {}),
    };
    if (dto.quizAnswers) {
      this.assertQuizAnswerIds(content, dto.quizAnswers);
    }

    const score = this.content.scoreQuiz(content, quizAnswers);

    // Quiz lessons gate completion on passScore; reading/video/practice
    // types complete without server-graded checks (self-attest).
    if (lesson.lessonType === QUIZ_LESSON_TYPE && isQuizContent(content)) {
      if (score.scorePercent < content.passScore) {
        throw new AppException(
          AuthErrorCode.LESSON_QUIZ_NOT_PASSED,
          `Quiz score ${score.scorePercent}% is below pass score ${content.passScore}%`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    const selfAttested = SELF_ATTEST_LESSON_TYPES.has(lesson.lessonType);

    return this.orchestrator.complete({
      userId,
      lesson,
      quizCorrect: score.correct,
      quizTotal: score.total,
      quizAnswers,
      practiceDone:
        selfAttested || Boolean(progress?.sessionState?.practiceDone),
      dto,
      idempotencyKey,
      contentVersionId: this.contentVersionIdOf(lesson),
      contentSchemaVersion: CONTENT_SCHEMA_VERSION,
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
    const { lesson } = await this.requireOwnedLesson(userId, lessonId, {
      allowLocked: true,
    });
    const content = await this.content.ensurePlayContent(lesson);
    return this.arlo.chat({
      userId,
      lesson,
      content,
      message,
    });
  }

  /** Stable version pin for attempt rows — unit slug or lesson id. */
  private contentVersionIdOf(lesson: Lesson): string {
    return lesson.unitId ?? lesson.id;
  }

  private assertQuizAnswerIds(
    content: UnitPlayContent,
    answers: Record<string, number | boolean>,
  ): void {
    if (!isQuizContent(content)) {
      if (Object.keys(answers).length === 0) return;
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Lesson has no quiz',
        HttpStatus.BAD_REQUEST,
      );
    }
    for (const qid of Object.keys(answers)) {
      const found = this.content.findQuizQuestion(content, {
        questionId: qid,
      });
      if (!found) {
        throw new AppException(
          AuthErrorCode.LESSON_INVALID_ANSWER,
          `Unknown quiz question: ${qid}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }
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

  /** Require attemptId — must match active attempt. */
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
        milestone: {
          phase: {
            roadmap: true,
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

    const lessonNumber = await this.lessonOrdinal(roadmap.id, lessonId);
    const progress = await this.progressRepo.findOne({
      where: { userId, lessonId },
    });

    return { lesson, lessonNumber, progress };
  }

  private async lessonOrdinal(
    roadmapId: string,
    lessonId: string,
  ): Promise<number> {
    const ordinals = await this.treeLoader.getLessonOrdinals(roadmapId);
    return ordinals[lessonId] ?? 0;
  }
}
