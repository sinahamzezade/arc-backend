import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { UnitsCatalogService } from '../content-pool/units-catalog.service';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import {
  isQuizContent,
  isUnitPlayContent,
  normalizeUnitPlayContent,
  stripPlaySecrets,
  type QuizPlayContent,
  type QuizQuestion,
  type UnitPlayContent,
} from './lesson-play.types';

export type QuizGradeInput = {
  questionId?: string;
  questionIndex?: number;
  optionIndex?: number;
  booleanAnswer?: boolean;
};

export type QuizGradeResult = {
  questionId: string;
  correct: boolean;
  /** Revealed after the check only. */
  answer: number | boolean;
  explain: string | null;
};

@Injectable()
export class LessonContentService {
  constructor(
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    private readonly unitsCatalog: UnitsCatalogService,
  ) {}

  /**
   * Authoritative body — prefer lesson.play_content snapshot; if missing or
   * rejected by an older validator, hydrate once from units.content and persist.
   */
  resolvePlayContent(lesson: Lesson): UnitPlayContent {
    if (isUnitPlayContent(lesson.playContent)) {
      return normalizeUnitPlayContent(lesson.playContent);
    }
    throw new AppException(
      AuthErrorCode.LESSON_CONTENT_NOT_READY,
      'Lesson content is not ready',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /**
   * Async variant used by play APIs — backfills play_content from the unit
   * catalog when the snapshot was never written (e.g. structured sections
   * rejected by a prior validator).
   */
  async ensurePlayContent(lesson: Lesson): Promise<UnitPlayContent> {
    if (isUnitPlayContent(lesson.playContent)) {
      return normalizeUnitPlayContent(lesson.playContent);
    }

    if (lesson.unitId) {
      const unit = await this.unitsCatalog.getUnitById(lesson.unitId);
      if (unit && isUnitPlayContent(unit.content)) {
        const normalized = normalizeUnitPlayContent(unit.content);
        lesson.playContent = normalized as unknown as Record<string, unknown>;
        if (!lesson.objective?.trim()) {
          lesson.objective = normalized.objective;
        }
        await this.lessonsRepo.save(lesson);
        return normalized;
      }
    }

    throw new AppException(
      AuthErrorCode.LESSON_CONTENT_NOT_READY,
      'Lesson content is not ready',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  /** Public play payload — deep-strips answer/explain and legacy secret keys. */
  toPublicPlayBody(content: UnitPlayContent): Record<string, unknown> {
    return stripPlaySecrets(
      normalizeUnitPlayContent(content),
    ) as unknown as Record<string, unknown>;
  }

  /** Quiz total for score/reward computations (0 for non-quiz bodies). */
  quizTotal(content: UnitPlayContent): number {
    return isQuizContent(content) ? content.questions.length : 0;
  }

  requireQuizContent(content: UnitPlayContent): QuizPlayContent {
    if (!isQuizContent(content)) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Lesson has no quiz',
        HttpStatus.BAD_REQUEST,
      );
    }
    return content;
  }

  /** Look up a question by normalized id (`q0`..) or by index. */
  findQuizQuestion(
    content: QuizPlayContent,
    input: Pick<QuizGradeInput, 'questionId' | 'questionIndex'>,
  ): { question: QuizQuestion; questionId: string } | null {
    const normalized = normalizeUnitPlayContent(content) as QuizPlayContent;
    let question: QuizQuestion | undefined;
    if (input.questionId != null) {
      question = normalized.questions.find((q) => q.id === input.questionId);
    } else if (
      input.questionIndex != null &&
      Number.isInteger(input.questionIndex)
    ) {
      question = normalized.questions[input.questionIndex];
    }
    if (!question) return null;
    return { question, questionId: question.id! };
  }

  /** Grade one quiz question server-side from the secret-bearing snapshot. */
  gradeQuizQuestion(
    content: UnitPlayContent,
    input: QuizGradeInput,
  ): QuizGradeResult {
    const quiz = this.requireQuizContent(content);
    const found = this.findQuizQuestion(quiz, input);
    if (!found) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown quiz question',
        HttpStatus.BAD_REQUEST,
      );
    }
    const { question, questionId } = found;

    let correct: boolean;
    if (question.type === 'mcq') {
      if (
        input.optionIndex == null ||
        !Number.isInteger(input.optionIndex) ||
        input.optionIndex < 0 ||
        input.optionIndex >= (question.options?.length ?? 0)
      ) {
        throw new AppException(
          AuthErrorCode.LESSON_INVALID_ANSWER,
          'optionIndex is required for mcq questions',
          HttpStatus.BAD_REQUEST,
        );
      }
      correct = input.optionIndex === question.answer;
    } else {
      if (typeof input.booleanAnswer !== 'boolean') {
        throw new AppException(
          AuthErrorCode.LESSON_INVALID_ANSWER,
          'booleanAnswer is required for boolean questions',
          HttpStatus.BAD_REQUEST,
        );
      }
      correct = input.booleanAnswer === question.answer;
    }

    return {
      questionId,
      correct,
      answer: question.answer,
      explain: question.explain ?? null,
    };
  }

  /**
   * Score persisted answers (`{ q0: 2, q1: true }`) against the snapshot.
   */
  scoreQuiz(
    content: UnitPlayContent,
    answers: Record<string, number | boolean>,
  ): { correct: number; total: number; scorePercent: number } {
    if (!isQuizContent(content)) {
      return { correct: 0, total: 0, scorePercent: 100 };
    }
    const quiz = normalizeUnitPlayContent(content) as QuizPlayContent;
    let correct = 0;
    for (const q of quiz.questions) {
      if (q.id && answers[q.id] === q.answer) correct += 1;
    }
    const total = quiz.questions.length;
    return {
      correct,
      total,
      scorePercent: total > 0 ? Math.round((correct / total) * 100) : 100,
    };
  }
}
