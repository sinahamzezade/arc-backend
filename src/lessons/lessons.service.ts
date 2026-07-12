import { HttpStatus, Inject, Injectable, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { Profile } from '../profiles/entities/profile.entity';
import { Lesson, LessonStatus } from '../roadmaps/entities/lesson.entity';
import {
  LessonProgress,
  LessonProgressStatus,
} from '../roadmaps/entities/lesson-progress.entity';
import { Roadmap, RoadmapStatus } from '../roadmaps/entities/roadmap.entity';
import { WeeksService } from '../weeks/weeks.service';
import {
  CheckPracticeDto,
  CheckQuizDto,
  CompleteLessonDto,
  UpdateLessonProgressDto,
} from './dto/lesson-play.dto';
import { LessonContentService } from './lesson-content.service';
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
    private readonly dataSource: DataSource,
    private readonly content: LessonContentService,
    private readonly rewards: LessonRewardsService,
    private readonly unlock: LessonUnlockService,
    @Inject(forwardRef(() => WeeksService))
    private readonly weeks: WeeksService,
  ) {}

  async getPlay(userId: string, lessonId: string) {
    const ctx = await this.requireOwnedLesson(userId, lessonId, {
      allowLocked: false,
    });
    const { lesson, lessonNumber, progress } = ctx;
    const outline = this.content.resolveOutline(
      lesson,
      lesson.lessonTemplate,
    );
    const publicBody = this.content.toPublicPlayBody(outline);
      const isFirstEver = await this.isFirstLessonEver(userId);
    const preview = this.rewards.previewReward({
      lesson,
      outline,
      isFirstLessonEver: isFirstEver,
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

    return {
      id: lesson.id,
      lessonNumber,
      title: lesson.title,
      missionName: lesson.missionName,
      minutes: lesson.estimatedMinutes,
      xpReward: lesson.xpReward,
      objective: lesson.objective ?? outline.objective,
      status: lesson.status,
      resource,
      arloPrompt: outline.arloPrompt,
      content: publicBody.content,
      practice: publicBody.practice,
      quiz: publicBody.quiz,
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
    } else if (row.status === LessonProgressStatus.NotStarted) {
      row.status = LessonProgressStatus.InProgress;
      row.startedAt = row.startedAt ?? new Date();
    } else {
      row.startedAt = row.startedAt ?? new Date();
    }

    row = await this.progressRepo.save(row);

    return {
      lessonId: lesson.id,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? new Date().toISOString(),
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

    const session = { ...(row.sessionState ?? {}) };
    if (dto.contentStep !== undefined) session.contentStep = dto.contentStep;
    if (dto.practiceDone !== undefined) session.practiceDone = dto.practiceDone;
    if (dto.practiceOptionId !== undefined) {
      session.practiceOptionId = dto.practiceOptionId;
    }
    if (dto.quizAnswers !== undefined) {
      session.quizAnswers = {
        ...(session.quizAnswers ?? {}),
        ...dto.quizAnswers,
      };
    }
    if (dto.quizIndex !== undefined) session.quizIndex = dto.quizIndex;
    row.sessionState = session;

    if (dto.timeSpentMinutes !== undefined) {
      row.timeSpentMinutes = dto.timeSpentMinutes;
    }

    row = await this.progressRepo.save(row);
    return {
      lessonId: lesson.id,
      status: row.status,
      sessionState: row.sessionState,
      timeSpentMinutes: row.timeSpentMinutes,
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
    const outline = this.content.resolveOutline(
      lesson,
      lesson.lessonTemplate,
    );
    const option = outline.practice.options.find((o) => o.id === dto.optionId);
    if (!option) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown practice option',
        HttpStatus.BAD_REQUEST,
      );
    }

    const correctOption = outline.practice.options.find((o) => o.correct);
    const correct = Boolean(option.correct);
    const feedback = correct
      ? (outline.practice.feedbackCorrect ?? 'Nailed it.')
      : (outline.practice.feedbackIncorrect ?? 'Not quite — try the hint.');

    await this.patchSession(userId, lesson.id, progress, {
      practiceDone: true,
      practiceOptionId: dto.optionId,
    });

    return {
      correct,
      correctOptionId: correctOption?.id ?? dto.optionId,
      feedback,
    };
  }

  async checkQuiz(userId: string, lessonId: string, dto: CheckQuizDto) {
    const { lesson, progress } = await this.requireOwnedLesson(
      userId,
      lessonId,
      { allowLocked: false },
    );
    const outline = this.content.resolveOutline(
      lesson,
      lesson.lessonTemplate,
    );
    const question = outline.quiz.find((q) => q.id === dto.questionId);
    if (!question) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown quiz question',
        HttpStatus.BAD_REQUEST,
      );
    }
    const optionOk = question.options.some((o) => o.id === dto.optionId);
    if (!optionOk) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown quiz option',
        HttpStatus.BAD_REQUEST,
      );
    }

    const correct = question.correctOptionId === dto.optionId;
    const answers = {
      ...(progress?.sessionState?.quizAnswers ?? {}),
      [dto.questionId]: dto.optionId,
    };
    await this.patchSession(userId, lesson.id, progress, {
      quizAnswers: answers,
    });

    return {
      correct,
      correctOptionId: question.correctOptionId,
      explanation: question.explanation,
    };
  }

  async complete(userId: string, lessonId: string, dto: CompleteLessonDto) {
    const ctx = await this.requireOwnedLesson(userId, lessonId, {
      allowLocked: false,
    });
    const { lesson } = ctx;
    const outline = this.content.resolveOutline(
      lesson,
      lesson.lessonTemplate,
    );

    const result = await this.dataSource.transaction(async (manager) => {
      const progressRepo = manager.getRepository(LessonProgress);
      let progress = await progressRepo.findOne({
        where: { userId, lessonId: lesson.id },
      });

      const previouslyAwarded =
        (progress?.xpAwarded ?? 0) > 0 ||
        (progress?.gemsAwarded ?? 0) > 0 ||
        (progress?.coinsAwarded ?? 0) > 0;

      const alreadyCompleted =
        progress?.status === LessonProgressStatus.Completed &&
        (previouslyAwarded || Boolean(progress.completedAt));

      if (alreadyCompleted && progress) {
        const profile = await manager
          .getRepository(Profile)
          .findOne({ where: { userId } });
        return {
          lessonId: lesson.id,
          status: LessonProgressStatus.Completed,
          quizScore: {
            correct: progress.quizCorrect ?? 0,
            total: progress.quizTotal ?? outline.quiz.length,
            perfect:
              (progress.quizCorrect ?? 0) ===
              (progress.quizTotal ?? outline.quiz.length),
          },
          reward: {
            xp: progress.xpAwarded,
            gems: progress.gemsAwarded,
            coins: progress.coinsAwarded,
            badgeId: undefined,
            badgeLabel: undefined,
            arloLine:
              outline.reward?.arloLine ??
              `“${lesson.title}” stays on the map — no double loot.`,
          },
          profile: {
            totalXp: profile?.totalXp ?? 0,
            gems: profile?.gems ?? 0,
            coins: profile?.coins ?? 0,
          },
          unlockedLessonIds: [] as string[],
          roadmapProgressPercent: Number(
            (
              await manager.getRepository(Roadmap).findOne({
                where: { userId, status: RoadmapStatus.Ready },
                order: { updatedAt: 'DESC' },
              })
            )?.progressPercent ?? 0,
          ),
          firstCompletion: false,
          minutes: progress.timeSpentMinutes || lesson.estimatedMinutes,
        };
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

      const reward = this.rewards.computeReward({
        lesson,
        outline,
        quizCorrect,
        quizTotal,
        alreadyCompleted: previouslyAwarded,
        isFirstLessonEver,
      });

      if (!progress) {
        progress = progressRepo.create({
          userId,
          lessonId: lesson.id,
          status: LessonProgressStatus.InProgress,
          startedAt: new Date(),
          sessionState: {},
        });
      }

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

      const profileSnapshot = await this.rewards.applyReward(
        manager,
        userId,
        progress,
        reward,
      );
      await progressRepo.save(progress);

      const lessonRow = await manager.getRepository(Lesson).findOneOrFail({
        where: { id: lesson.id },
      });
      const unlockResult = await this.unlock.afterComplete(
        manager,
        userId,
        lessonRow,
      );

      return {
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
          badgeId: profileSnapshot.badgeId ?? reward.badgeId,
          badgeLabel: profileSnapshot.badgeLabel ?? reward.badgeLabel,
          arloLine: reward.arloLine,
        },
        profile: {
          totalXp: profileSnapshot.totalXp,
          gems: profileSnapshot.gems,
          coins: profileSnapshot.coins,
        },
        unlockedLessonIds: unlockResult.unlockedLessonIds,
        roadmapProgressPercent: unlockResult.progressPercent,
        firstCompletion: true,
        minutes:
          progress.timeSpentMinutes ||
          dto.timeSpentMinutes ||
          lesson.estimatedMinutes,
      };
    });

    if (result.firstCompletion) {
      try {
        await this.weeks.onLessonCompleted(
          userId,
          lesson.id,
          result.minutes,
        );
      } catch {
        /* week plan optional if roadmap/plan missing */
      }
    }

    const { firstCompletion: _f, minutes: _m, ...response } = result;
    return response;
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

    if (
      !opts.allowLocked &&
      lesson.status === LessonStatus.Locked
    ) {
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
