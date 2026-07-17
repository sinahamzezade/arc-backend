import { createHash } from 'crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { LiveContextService } from '../content-pool/live-context.service';
import { UnitsCatalogService } from '../content-pool/units-catalog.service';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import {
  isActiveFormatContent,
  isQuizContent,
  isUnitPlayContent,
  normalizeUnitPlayContent,
  stripPlaySecrets,
  type ActiveFormatPlayContent,
  type ActiveLessonBlock,
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

export type ActiveBlockGradeResult = {
  blockId: string;
  blockType: string;
  correct: boolean;
  alreadyResolved: boolean;
  explanation: string | null;
  outcome: string | null;
  xpEligible: boolean;
};

@Injectable()
export class LessonContentService {
  constructor(
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    private readonly unitsCatalog: UnitsCatalogService,
    private readonly liveContext: LiveContextService,
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

  /**
   * Resolve live_context blocks at read time; omit when no fresh snippet.
   */
  async toPublicPlayBodyWithLiveContext(
    content: UnitPlayContent,
    opts?: { preferredSkillTags?: string[] },
  ): Promise<Record<string, unknown>> {
    const body = this.toPublicPlayBody(content);
    if (!isActiveFormatContent(content) || !Array.isArray(body.blocks)) {
      return body;
    }

    const resolved: unknown[] = [];
    for (const raw of body.blocks as Array<Record<string, unknown>>) {
      if (raw.type !== 'live_context') {
        resolved.push(raw);
        continue;
      }
      const trackTag = String(raw.track_tag ?? '');
      const snippet = await this.liveContext.resolveFresh(
        trackTag,
        opts?.preferredSkillTags,
      );
      if (!snippet) {
        continue;
      }
      resolved.push({
        type: 'live_context',
        id: raw.id,
        track_tag: trackTag,
        snippet,
      });
    }
    return { ...body, blocks: resolved };
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

  requireActiveContent(content: UnitPlayContent): ActiveFormatPlayContent {
    if (!isActiveFormatContent(content)) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Lesson has no active-format blocks',
        HttpStatus.BAD_REQUEST,
      );
    }
    return content;
  }

  findActiveBlock(
    content: ActiveFormatPlayContent,
    blockId: string,
  ): ActiveLessonBlock | null {
    return content.blocks.find((b) => b.id === blockId) ?? null;
  }

  static hashDragOrder(orderedIds: string[]): string {
    return createHash('sha256').update(orderedIds.join('|')).digest('hex');
  }

  gradeScenario(
    content: UnitPlayContent,
    blockId: string,
    optionId: string,
    alreadyResolved: boolean,
  ): ActiveBlockGradeResult {
    const active = this.requireActiveContent(content);
    const block = this.findActiveBlock(active, blockId);
    if (!block || block.type !== 'scenario_decision') {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown scenario block',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (alreadyResolved) {
      throw new AppException(
        AuthErrorCode.SCENARIO_BLOCK_ALREADY_RESOLVED,
        'Scenario block already resolved',
        HttpStatus.CONFLICT,
      );
    }
    const correct = optionId === block.correctOptionId;
    const outcome = block.outcomes?.[optionId] ?? null;
    return {
      blockId,
      blockType: block.type,
      correct,
      alreadyResolved: false,
      explanation: outcome,
      outcome,
      xpEligible: correct,
    };
  }

  gradeVisualHotspot(
    content: UnitPlayContent,
    blockId: string,
    hotspotId: string,
    alreadyResolved: boolean,
  ): ActiveBlockGradeResult {
    const active = this.requireActiveContent(content);
    const block = this.findActiveBlock(active, blockId);
    if (!block || block.type !== 'visual_hotspot') {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown visual hotspot block',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (alreadyResolved) {
      throw new AppException(
        AuthErrorCode.SCENARIO_BLOCK_ALREADY_RESOLVED,
        'Block already resolved',
        HttpStatus.CONFLICT,
      );
    }
    const correct = hotspotId === block.correctHotspotId;
    return {
      blockId,
      blockType: block.type,
      correct,
      alreadyResolved: false,
      explanation: block.explanation ?? null,
      outcome: block.explanation ?? null,
      xpEligible: correct,
    };
  }

  gradeDragOrder(
    content: UnitPlayContent,
    blockId: string,
    orderedIds: string[],
    alreadyResolved: boolean,
  ): ActiveBlockGradeResult {
    const active = this.requireActiveContent(content);
    const block = this.findActiveBlock(active, blockId);
    if (!block || block.type !== 'drag_order') {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown drag-order block',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (alreadyResolved) {
      throw new AppException(
        AuthErrorCode.SCENARIO_BLOCK_ALREADY_RESOLVED,
        'Block already resolved',
        HttpStatus.CONFLICT,
      );
    }
    const hash = LessonContentService.hashDragOrder(orderedIds);
    const correct = hash === block.correctOrderHash;
    return {
      blockId,
      blockType: block.type,
      correct,
      alreadyResolved: false,
      explanation: block.explanation ?? null,
      outcome: block.explanation ?? null,
      xpEligible: correct,
    };
  }

  gradeDebate(
    content: UnitPlayContent,
    blockId: string,
    side: 'a' | 'b',
    alreadyResolved: boolean,
  ): ActiveBlockGradeResult {
    const active = this.requireActiveContent(content);
    const block = this.findActiveBlock(active, blockId);
    if (!block || block.type !== 'debate_pick') {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown debate block',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (alreadyResolved) {
      throw new AppException(
        AuthErrorCode.SCENARIO_BLOCK_ALREADY_RESOLVED,
        'Block already resolved',
        HttpStatus.CONFLICT,
      );
    }
    const preferred = block.preferredSide;
    const correct = preferred ? side === preferred : true;
    const outcome =
      side === 'a' ? (block.feedbackA ?? null) : (block.feedbackB ?? null);
    return {
      blockId,
      blockType: block.type,
      correct,
      alreadyResolved: false,
      explanation: outcome,
      outcome,
      xpEligible: correct,
    };
  }

  gradeSandboxSimulation(
    content: UnitPlayContent,
    blockId: string,
    actions: string[],
    opts: {
      alreadyResolved: boolean;
      unitActionVocabulary?: string[];
      unitSimulationAssetKey?: string | null;
    },
  ): ActiveBlockGradeResult {
    const active = this.requireActiveContent(content);
    const block = this.findActiveBlock(active, blockId);
    if (!block || block.type !== 'sandbox_simulation') {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown sandbox simulation block',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (opts.alreadyResolved) {
      throw new AppException(
        AuthErrorCode.SCENARIO_BLOCK_ALREADY_RESOLVED,
        'Block already resolved',
        HttpStatus.CONFLICT,
      );
    }

    const vocab = new Set([
      ...(block.actions ?? []),
      ...(opts.unitActionVocabulary ?? []),
    ]);
    for (const action of actions) {
      if (!vocab.has(action)) {
        throw new AppException(
          AuthErrorCode.SANDBOX_SIMULATION_ACTION_INVALID,
          `Action not in unit vocabulary: ${action}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    if (
      opts.unitSimulationAssetKey &&
      opts.unitSimulationAssetKey !== block.simulationAssetKey
    ) {
      throw new AppException(
        AuthErrorCode.SANDBOX_SIMULATION_SNAPSHOT_STALE,
        'Simulation snapshot version mismatch',
        HttpStatus.CONFLICT,
      );
    }

    const correct =
      actions.length === block.correctActions.length &&
      actions.every((a, i) => a === block.correctActions[i]);

    return {
      blockId,
      blockType: block.type,
      correct,
      alreadyResolved: false,
      explanation: block.outcomeCopy ?? null,
      outcome: block.outcomeCopy ?? null,
      xpEligible: correct,
    };
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
