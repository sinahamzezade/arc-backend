import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import {
  DEFAULT_ATTEMPT_BUDGET_PER_CONCEPT,
  type LessonPlayOutline,
  type LessonRecoveryItem,
} from './lesson-play.types';
import { LessonAttempt } from './entities/lesson-attempt.entity';
import {
  RemediationEvent,
  type RemediationOutcome,
} from './entities/remediation-event.entity';

export type ConceptMasteryEntry = {
  state: 'unseen' | 'attempting' | 'shaky' | 'mastered' | 'recovered';
  misses: number;
  recoveries: number;
};

export type PublicRemediationBlock =
  | {
      conceptTag: string;
      round: number;
      exhausted?: false;
      microExplanation: LessonPlayOutline['content'][0]['blocks'];
      recoveryItem: {
        id: string;
        prompt: string;
        options: Array<{ id: string; label: string }>;
      };
    }
  | {
      conceptTag: string;
      exhausted: true;
      microExplanation: LessonPlayOutline['content'][0]['blocks'];
      round?: number;
    };

export type GradeResult = {
  correct: boolean;
  correctOptionId: string;
  feedback?: string;
  explanation?: string;
  remediation: PublicRemediationBlock | null;
  conceptTag: string | null;
};

type ResolvedGradable = {
  kind: 'practice' | 'quiz' | 'recovery';
  itemId: string;
  conceptTag: string;
  correctOptionId: string;
  options: Array<{ id: string; label: string; correct?: boolean }>;
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
  explanation?: string;
  recovery?: LessonRecoveryItem;
};

@Injectable()
export class LessonRemediationService {
  constructor(
    @InjectRepository(LessonAttempt)
    private readonly attemptsRepo: Repository<LessonAttempt>,
    @InjectRepository(RemediationEvent)
    private readonly remediationRepo: Repository<RemediationEvent>,
  ) {}

  resolveItem(
    outline: LessonPlayOutline,
    itemId: string,
  ): ResolvedGradable | null {
    if (outline.practice?.id === itemId) {
      const correct = outline.practice.options.find((o) => o.correct);
      return {
        kind: 'practice',
        itemId,
        conceptTag:
          outline.practice.conceptTag?.trim() ||
          `practice:${outline.practice.id}`,
        correctOptionId: correct?.id ?? '',
        options: outline.practice.options,
        feedbackCorrect: outline.practice.feedbackCorrect,
        feedbackIncorrect: outline.practice.feedbackIncorrect,
      };
    }

    const quiz = outline.quiz?.find((q) => q.id === itemId);
    if (quiz) {
      return {
        kind: 'quiz',
        itemId,
        conceptTag: quiz.conceptTag?.trim() || `quiz:${quiz.id}`,
        correctOptionId: quiz.correctOptionId,
        options: quiz.options,
        explanation: quiz.explanation,
      };
    }

    for (const [tag, pool] of Object.entries(outline.remediation ?? {})) {
      const recovery = pool.recoveryItems.find((r) => r.id === itemId);
      if (!recovery) continue;
      const correctOpt =
        recovery.options.find((o) => o.correct)?.id ??
        recovery.options.find((o) => o.id)?.id ??
        '';
      return {
        kind: 'recovery',
        itemId,
        conceptTag: tag,
        correctOptionId: correctOpt,
        options: recovery.options,
        explanation: recovery.explanation,
        recovery,
      };
    }

    return null;
  }

  async grade(
    attempt: LessonAttempt,
    outline: LessonPlayOutline,
    input: { itemId: string; optionId: string },
  ): Promise<GradeResult> {
    const resolved = this.resolveItem(outline, input.itemId);
    if (!resolved) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown item for content version',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!resolved.options.some((o) => o.id === input.optionId)) {
      throw new AppException(
        AuthErrorCode.LESSON_INVALID_ANSWER,
        'Unknown option for content version',
        HttpStatus.BAD_REQUEST,
      );
    }

    const correct = input.optionId === resolved.correctOptionId;
    const tag = resolved.conceptTag;
    const budget =
      outline.attemptBudgetPerConcept ?? DEFAULT_ATTEMPT_BUDGET_PER_CONCEPT;

    if (correct) {
      await this.markCorrect(attempt, tag, resolved.kind === 'recovery');
      if (resolved.kind === 'recovery') {
        await this.tryAppendEvent(attempt, {
          conceptTag: tag,
          triggerItemId: input.itemId,
          recoveryItemId: input.itemId,
          outcome: 'recovered',
        });
      }
      return {
        correct: true,
        correctOptionId: resolved.correctOptionId,
        feedback: resolved.feedbackCorrect ?? 'Nailed it.',
        explanation: resolved.explanation,
        remediation: null,
        conceptTag: tag,
      };
    }

    // Wrong — idempotent if this trigger already recorded as latest miss
    const events = await this.remediationRepo.find({
      where: { attemptId: attempt.id, conceptTag: tag },
      order: { round: 'ASC' },
    });
    const last = events[events.length - 1];
    if (
      last &&
      last.triggerItemId === input.itemId &&
      (last.outcome === 'served' || last.outcome === 'budget_exhausted')
    ) {
      return this.rebuildWrongResponse(outline, resolved, last);
    }

    const pool = outline.remediation?.[tag];
    const servedIds = new Set(
      events
        .map((e) => e.recoveryItemId)
        .filter((id): id is string => Boolean(id)),
    );
    const nextRecovery = pool?.recoveryItems.find((r) => !servedIds.has(r.id));
    const nextMisses = (attempt.conceptMastery?.[tag]?.misses ?? 0) + 1;
    const withinBudget = nextMisses <= budget && Boolean(nextRecovery);

    const outcome: RemediationOutcome = withinBudget
      ? 'served'
      : 'budget_exhausted';

    const inserted = await this.tryAppendEvent(attempt, {
      conceptTag: tag,
      triggerItemId: input.itemId,
      recoveryItemId: withinBudget ? (nextRecovery?.id ?? null) : null,
      outcome,
    });

    await this.bumpMiss(attempt, tag, withinBudget ? 'attempting' : 'shaky');

    if (!inserted) {
      // Concurrent duplicate — rebuild from persisted round
      const again = await this.remediationRepo.find({
        where: { attemptId: attempt.id, conceptTag: tag },
        order: { round: 'ASC' },
      });
      const existing = again[again.length - 1];
      if (existing) {
        return this.rebuildWrongResponse(outline, resolved, existing);
      }
    }

    const micro =
      pool?.microExplanation ??
      ([
        {
          type: 'text' as const,
          body:
            resolved.feedbackIncorrect ??
            resolved.explanation ??
            'Revisit this concept, then try again.',
        },
      ] as const);

    if (withinBudget && nextRecovery && inserted) {
      return {
        correct: false,
        correctOptionId: resolved.correctOptionId,
        feedback: resolved.feedbackIncorrect,
        explanation: resolved.explanation ?? resolved.feedbackIncorrect,
        conceptTag: tag,
        remediation: {
          conceptTag: tag,
          round: inserted.round,
          microExplanation: [...micro],
          recoveryItem: {
            id: nextRecovery.id,
            prompt: nextRecovery.prompt,
            options: nextRecovery.options.map((o) => ({
              id: o.id,
              label: o.label,
            })),
          },
        },
      };
    }

    return {
      correct: false,
      correctOptionId: resolved.correctOptionId,
      feedback: resolved.feedbackIncorrect,
      explanation: resolved.explanation ?? resolved.feedbackIncorrect,
      conceptTag: tag,
      remediation: {
        conceptTag: tag,
        exhausted: true,
        round: inserted?.round,
        microExplanation: [...micro],
      },
    };
  }

  private rebuildWrongResponse(
    outline: LessonPlayOutline,
    resolved: ResolvedGradable,
    event: RemediationEvent,
  ): GradeResult {
    const pool = outline.remediation?.[event.conceptTag];
    const micro =
      pool?.microExplanation ??
      ([
        {
          type: 'text' as const,
          body:
            resolved.explanation ??
            resolved.feedbackIncorrect ??
            'Revisit this concept.',
        },
      ] as const);

    if (event.outcome === 'budget_exhausted' || !event.recoveryItemId) {
      return {
        correct: false,
        correctOptionId: resolved.correctOptionId,
        feedback: resolved.feedbackIncorrect,
        explanation: resolved.explanation ?? resolved.feedbackIncorrect,
        conceptTag: event.conceptTag,
        remediation: {
          conceptTag: event.conceptTag,
          exhausted: true,
          round: event.round,
          microExplanation: [...micro],
        },
      };
    }

    const recovery = pool?.recoveryItems.find(
      (r) => r.id === event.recoveryItemId,
    );
    return {
      correct: false,
      correctOptionId: resolved.correctOptionId,
      feedback: resolved.feedbackIncorrect,
      explanation: resolved.explanation ?? resolved.feedbackIncorrect,
      conceptTag: event.conceptTag,
      remediation: {
        conceptTag: event.conceptTag,
        round: event.round,
        microExplanation: [...micro],
        recoveryItem: {
          id: event.recoveryItemId,
          prompt: recovery?.prompt ?? 'Try this recovery check.',
          options: (recovery?.options ?? []).map((o) => ({
            id: o.id,
            label: o.label,
          })),
        },
      },
    };
  }

  private async markCorrect(
    attempt: LessonAttempt,
    tag: string,
    wasRecovery: boolean,
  ) {
    const mastery = { ...(attempt.conceptMastery ?? {}) };
    const prev = mastery[tag] ?? { state: 'unseen' as const, misses: 0, recoveries: 0 };
    const wasShaky = prev.state === 'shaky' || prev.recoveries > 0;
    mastery[tag] = {
      state: wasRecovery || wasShaky ? 'recovered' : 'mastered',
      misses: prev.misses,
      recoveries: wasRecovery ? prev.recoveries + 1 : prev.recoveries,
    };
    // Acceptance: correct recovery → mastered (recorded as recovered)
    if (wasRecovery) {
      mastery[tag].state = 'mastered';
    }
    attempt.conceptMastery = mastery;
    await this.attemptsRepo.save(attempt);
  }

  private async bumpMiss(
    attempt: LessonAttempt,
    tag: string,
    state: 'attempting' | 'shaky',
  ) {
    const mastery = { ...(attempt.conceptMastery ?? {}) };
    const prev = mastery[tag] ?? { state: 'unseen' as const, misses: 0, recoveries: 0 };
    mastery[tag] = {
      state,
      misses: prev.misses + 1,
      recoveries: prev.recoveries,
    };
    attempt.conceptMastery = mastery;
    await this.attemptsRepo.save(attempt);
  }

  private async tryAppendEvent(
    attempt: LessonAttempt,
    input: {
      conceptTag: string;
      triggerItemId: string;
      recoveryItemId: string | null;
      outcome: RemediationOutcome;
    },
  ): Promise<RemediationEvent | null> {
    const count = await this.remediationRepo.count({
      where: { attemptId: attempt.id, conceptTag: input.conceptTag },
    });
    const round = count + 1;
    try {
      return await this.remediationRepo.save(
        this.remediationRepo.create({
          attemptId: attempt.id,
          userId: attempt.userId,
          lessonId: attempt.lessonId,
          conceptTag: input.conceptTag,
          triggerItemId: input.triggerItemId,
          recoveryItemId: input.recoveryItemId,
          round,
          outcome: input.outcome,
        }),
      );
    } catch (err) {
      if (this.isUniqueViolation(err)) return null;
      throw err;
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    if (!(err instanceof QueryFailedError)) return false;
    const code = (err as QueryFailedError & { driverError?: { code?: string } })
      .driverError?.code;
    return code === '23505';
  }
}
