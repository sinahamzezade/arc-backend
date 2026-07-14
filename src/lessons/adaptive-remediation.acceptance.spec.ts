/**
 * §16.8 adaptive remediation acceptance — unit/integration style.
 */
import { LessonContentService } from './lesson-content.service';
import { LessonRemediationService } from './lesson-remediation.service';
import { RewardCalculatorService } from '../gamification/reward-calculator.service';
import {
  assertConceptTagsPresent,
  collectSecretKeyHits,
  type LessonPlayOutline,
} from './lesson-play.types';
import {
  transformCurriculumLesson,
  validateTransformedOutline,
} from '../skill-graph/seeds/transform-curriculum';
import type { LessonAttempt } from './entities/lesson-attempt.entity';
import type { RemediationEvent } from './entities/remediation-event.entity';
import { QueryFailedError } from 'typeorm';

const GOLDEN: LessonPlayOutline = transformCurriculumLesson({
  skillSlug: 'web-internet',
  lessonSlug: 'web-internet-quiz',
  title: 'Request/response check',
  lessonType: 'quiz',
  content: {
    format: 'quiz',
    objective: 'Verify request/response cycle.',
    questions: [
      {
        prompt: 'What does DNS do?',
        options: [
          'Encrypts traffic',
          'Converts domain names into IP addresses',
          'Stores cookies',
          'Compresses images',
        ],
        correctIndex: 1,
        explanation: 'DNS maps names to IPs.',
      },
      {
        prompt: 'What does 404 mean?',
        options: [
          'Server crashed',
          'Success',
          'Resource not found',
          'Unauthorized',
        ],
        correctIndex: 2,
        explanation: '404 = not found.',
      },
    ],
  },
});

function mockRemediationService(attempt: LessonAttempt) {
  const events: RemediationEvent[] = [];
  const attemptsRepo = {
    save: jest.fn(async (a: LessonAttempt) => {
      Object.assign(attempt, a);
      return attempt;
    }),
  };
  const remediationRepo = {
    find: jest.fn(async ({ where }: { where: { conceptTag: string } }) =>
      events
        .filter((e) => e.conceptTag === where.conceptTag)
        .sort((a, b) => a.round - b.round),
    ),
    count: jest.fn(
      async ({ where }: { where: { conceptTag: string } }) =>
        events.filter((e) => e.conceptTag === where.conceptTag).length,
    ),
    create: jest.fn((row: Partial<RemediationEvent>) => row),
    save: jest.fn(async (row: RemediationEvent) => {
      const dup = events.find(
        (e) =>
          e.attemptId === row.attemptId &&
          e.conceptTag === row.conceptTag &&
          e.round === row.round,
      );
      if (dup) {
        const qerr = new QueryFailedError('', [], new Error('dup'));
        (qerr as unknown as { driverError: { code: string } }).driverError = {
          code: '23505',
        };
        throw qerr;
      }
      const saved = {
        ...row,
        id: `ev-${events.length + 1}`,
      } as RemediationEvent;
      events.push(saved);
      return saved;
    }),
  };
  return {
    service: new LessonRemediationService(
      attemptsRepo as never,
      remediationRepo as never,
    ),
    events,
  };
}

describe('§16.8 Adaptive Remediation acceptance', () => {
  it('every practice/quiz item has conceptTag (seed validation)', () => {
    expect(() => validateTransformedOutline(GOLDEN)).not.toThrow();
    expect(() => assertConceptTagsPresent(GOLDEN)).not.toThrow();
    expect(GOLDEN.practice.conceptTag).toBeTruthy();
    for (const q of GOLDEN.quiz) {
      expect(q.conceptTag).toBeTruthy();
    }
  });

  it('GET play strip leaks zero secret keys incl. remediation bodies', () => {
    const publicBody = new LessonContentService().toPublicPlayBody(GOLDEN);
    expect(collectSecretKeyHits(publicBody)).toEqual([]);
    expect(publicBody).not.toHaveProperty('remediation');
    expect(JSON.stringify(publicBody)).not.toMatch(/correctOptionId|feedbackIncorrect|badgeCandidateKey/);
    expect(publicBody.adaptive.concepts.length).toBeGreaterThan(0);
  });

  it('wrong answer returns fresh recovery item (never verbatim primary)', async () => {
    const attempt = {
      id: 'a1',
      userId: 'u1',
      lessonId: 'l1',
      conceptMastery: {},
    } as LessonAttempt;
    const { service } = mockRemediationService(attempt);
    const wrong = GOLDEN.practice.options.find((o) => !o.correct)!.id;
    const result = await service.grade(attempt, GOLDEN, {
      itemId: GOLDEN.practice.id,
      optionId: wrong,
    });
    expect(result.correct).toBe(false);
    expect(result.remediation).toBeTruthy();
    if (result.remediation && 'recoveryItem' in result.remediation) {
      expect(result.remediation.recoveryItem.prompt).not.toBe(
        GOLDEN.practice.prompt,
      );
      expect(
        result.remediation.recoveryItem.options.every(
          (o) => !('correct' in o),
        ),
      ).toBe(true);
    }
  });

  it('correct recovery → mastered + stops further remediation', async () => {
    const attempt = {
      id: 'a1',
      userId: 'u1',
      lessonId: 'l1',
      conceptMastery: {},
    } as LessonAttempt;
    const { service } = mockRemediationService(attempt);
    const wrong = GOLDEN.practice.options.find((o) => !o.correct)!.id;
    const fail = await service.grade(attempt, GOLDEN, {
      itemId: GOLDEN.practice.id,
      optionId: wrong,
    });
    const recoveryId =
      fail.remediation && 'recoveryItem' in fail.remediation
        ? fail.remediation.recoveryItem.id
        : null;
    expect(recoveryId).toBeTruthy();
    const tag = GOLDEN.practice.conceptTag!;
    const pool = GOLDEN.remediation![tag];
    const correctOpt = pool.recoveryItems[0].options.find((o) => o.correct)!
      .id;
    const ok = await service.grade(attempt, GOLDEN, {
      itemId: recoveryId!,
      optionId: correctOpt,
    });
    expect(ok.correct).toBe(true);
    expect(ok.remediation).toBeNull();
    expect(attempt.conceptMastery[tag].state).toBe('mastered');
  });

  it('budget exhaust → shaky, continue allowed, perfect bonus withheld', async () => {
    const attempt = {
      id: 'a1',
      userId: 'u1',
      lessonId: 'l1',
      conceptMastery: {},
    } as LessonAttempt;
    const { service, events } = mockRemediationService(attempt);
    const wrong = GOLDEN.practice.options.find((o) => !o.correct)!.id;
    await service.grade(attempt, GOLDEN, {
      itemId: GOLDEN.practice.id,
      optionId: wrong,
    });
    const tag = GOLDEN.practice.conceptTag!;
    const recovery = GOLDEN.remediation![tag].recoveryItems[0];
    const badOpt = recovery.options.find((o) => !o.correct)!.id;
    const exhausted = await service.grade(attempt, GOLDEN, {
      itemId: recovery.id,
      optionId: badOpt,
    });
    expect(exhausted.remediation).toMatchObject({ exhausted: true });
    expect(attempt.conceptMastery[tag].state).toBe('shaky');
    // Continue anyway — no throw, lesson completion still possible
    expect(events.length).toBeGreaterThanOrEqual(1);

    const calc = new RewardCalculatorService();
    const withShaky = calc.compute({
      actionKind: 'quiz',
      difficulty: 'beginner',
      pathPercentile: 40,
      quizCorrect: 1,
      quizTotal: 1,
      attemptKind: 'first',
      hasShakyConcepts: true,
      remediationRoundsUsed: events.length,
    });
    const perfect = calc.compute({
      actionKind: 'quiz',
      difficulty: 'beginner',
      pathPercentile: 40,
      quizCorrect: 1,
      quizTotal: 1,
      attemptKind: 'first',
    });
    expect(withShaky.gems).toBeLessThan(perfect.gems);
    expect(withShaky.xp).toBeGreaterThan(0);
  });

  it('duplicate check requests do not double-count a round', async () => {
    const attempt = {
      id: 'a1',
      userId: 'u1',
      lessonId: 'l1',
      conceptMastery: {},
    } as LessonAttempt;
    const { service, events } = mockRemediationService(attempt);
    const wrong = GOLDEN.practice.options.find((o) => !o.correct)!.id;
    await service.grade(attempt, GOLDEN, {
      itemId: GOLDEN.practice.id,
      optionId: wrong,
    });
    await service.grade(attempt, GOLDEN, {
      itemId: GOLDEN.practice.id,
      optionId: wrong,
    });
    expect(events).toHaveLength(1);
  });

  it('two concurrent inserts for same round — unique constraint wins once', async () => {
    const attempt = {
      id: 'a1',
      userId: 'u1',
      lessonId: 'l1',
      conceptMastery: {},
    } as LessonAttempt;
    const { service, events } = mockRemediationService(attempt);
    // Simulate race: pre-seed round 1 so second save hits unique
    events.push({
      id: 'pre',
      attemptId: 'a1',
      conceptTag: GOLDEN.practice.conceptTag!,
      round: 1,
      triggerItemId: GOLDEN.practice.id,
      recoveryItemId: 'r-x',
      outcome: 'served',
    } as RemediationEvent);

    const wrong = GOLDEN.practice.options.find((o) => !o.correct)!.id;
    // First grade sees existing event for same trigger → idempotent rebuild
    const result = await service.grade(attempt, GOLDEN, {
      itemId: GOLDEN.practice.id,
      optionId: wrong,
    });
    expect(result.correct).toBe(false);
    expect(events.filter((e) => e.round === 1)).toHaveLength(1);
  });
});
