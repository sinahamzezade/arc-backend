import { LessonRemediationService } from './lesson-remediation.service';
import type { LessonPlayOutline } from './lesson-play.types';
import type { LessonAttempt } from './entities/lesson-attempt.entity';
import type { RemediationEvent } from './entities/remediation-event.entity';

const OUTLINE: LessonPlayOutline = {
  objective: 'Learn tags',
  arloPrompt: 'Ask',
  suggestedArlo: ['a', 'b', 'c'],
  content: [{ id: 'c1', title: 'T', blocks: [{ type: 'text', body: 'Body' }] }],
  practice: {
    id: 'p1',
    prompt: 'Which closes a paragraph?',
    hint: 'slash',
    conceptTag: 'html-tag-closing',
    options: [
      { id: 'a', label: '<p>Hi</p>', correct: true },
      { id: 'b', label: '<p>Hi<p>', correct: false },
    ],
    feedbackCorrect: 'Yes',
    feedbackIncorrect: 'Need slash',
  },
  quiz: [],
  attemptBudgetPerConcept: 2,
  remediation: {
    'html-tag-closing': {
      microExplanation: [{ type: 'text', body: 'Close with slash' }],
      recoveryItems: [
        {
          id: 'r-tagclose-1',
          prompt: 'Which closes a heading?',
          options: [
            { id: 'a', label: '<h1>T<h1>', correct: false },
            { id: 'b', label: '<h1>T</h1>', correct: true },
          ],
          explanation: 'Slash on close',
        },
      ],
    },
  },
};

function makeAttempt(): LessonAttempt {
  return {
    id: 'att-1',
    userId: 'u1',
    lessonId: 'l1',
    conceptMastery: {},
  } as LessonAttempt;
}

describe('LessonRemediationService', () => {
  let service: LessonRemediationService;
  let events: RemediationEvent[];
  let attemptStore: LessonAttempt;

  beforeEach(() => {
    events = [];
    attemptStore = makeAttempt();
    const attemptsRepo = {
      save: jest.fn(async (a: LessonAttempt) => {
        attemptStore = a;
        return a;
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
            e.conceptTag === row.conceptTag &&
            e.round === row.round &&
            e.attemptId === row.attemptId,
        );
        if (dup) {
          const err = new Error('duplicate') as Error & {
            driverError: { code: string };
          };
          Object.setPrototypeOf(err, require('typeorm').QueryFailedError.prototype);
          err.driverError = { code: '23505' };
          // LessonRemediationService checks instanceof QueryFailedError
          const { QueryFailedError } = require('typeorm');
          const qerr = new QueryFailedError('', [], err);
          (qerr as unknown as { driverError: { code: string } }).driverError = {
            code: '23505',
          };
          throw qerr;
        }
        const saved = { ...row, id: `ev-${events.length + 1}` } as RemediationEvent;
        events.push(saved);
        return saved;
      }),
    };
    service = new LessonRemediationService(
      attemptsRepo as never,
      remediationRepo as never,
    );
  });

  it('serves fresh recovery item on wrong answer within budget', async () => {
    const result = await service.grade(attemptStore, OUTLINE, {
      itemId: 'p1',
      optionId: 'b',
    });
    expect(result.correct).toBe(false);
    expect(result.remediation).toMatchObject({
      conceptTag: 'html-tag-closing',
      round: 1,
    });
    expect(result.remediation && 'recoveryItem' in result.remediation).toBe(
      true,
    );
    if (result.remediation && 'recoveryItem' in result.remediation) {
      expect(result.remediation.recoveryItem.id).toBe('r-tagclose-1');
      expect(result.remediation.recoveryItem.prompt).not.toBe(
        OUTLINE.practice.prompt,
      );
      expect(
        result.remediation.recoveryItem.options.every(
          (o) => !('correct' in o),
        ),
      ).toBe(true);
    }
    expect(events).toHaveLength(1);
  });

  it('duplicate wrong check does not double-count round', async () => {
    await service.grade(attemptStore, OUTLINE, {
      itemId: 'p1',
      optionId: 'b',
    });
    const again = await service.grade(attemptStore, OUTLINE, {
      itemId: 'p1',
      optionId: 'b',
    });
    expect(events).toHaveLength(1);
    expect(again.remediation && 'round' in again.remediation
      ? again.remediation.round
      : null).toBe(1);
  });

  it('correct recovery flips to mastered', async () => {
    await service.grade(attemptStore, OUTLINE, {
      itemId: 'p1',
      optionId: 'b',
    });
    const recovered = await service.grade(attemptStore, OUTLINE, {
      itemId: 'r-tagclose-1',
      optionId: 'b',
    });
    expect(recovered.correct).toBe(true);
    expect(recovered.remediation).toBeNull();
    expect(attemptStore.conceptMastery['html-tag-closing'].state).toBe(
      'mastered',
    );
    expect(attemptStore.conceptMastery['html-tag-closing'].recoveries).toBe(1);
  });

  it('budget exhaust marks shaky and allows continue', async () => {
    // only one recovery item — second miss exhausts
    await service.grade(attemptStore, OUTLINE, {
      itemId: 'p1',
      optionId: 'b',
    });
    // fail recovery
    const failRecovery = await service.grade(attemptStore, OUTLINE, {
      itemId: 'r-tagclose-1',
      optionId: 'a',
    });
    expect(failRecovery.correct).toBe(false);
    expect(failRecovery.remediation).toMatchObject({ exhausted: true });
    expect(attemptStore.conceptMastery['html-tag-closing'].state).toBe(
      'shaky',
    );
  });
});
