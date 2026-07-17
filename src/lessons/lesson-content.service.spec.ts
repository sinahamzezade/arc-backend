import { LessonContentService } from './lesson-content.service';
import { LessonRewardsService } from './lesson-rewards.service';
import {
  collectSecretKeyHits,
  isUnitPlayContent,
  normalizeUnitPlayContent,
  stripPlaySecrets,
  type QuizPlayContent,
  type ReadingPlayContent,
  type TaskPlayContent,
} from './lesson-play.types';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { RewardCalculatorService } from '../gamification/reward-calculator.service';

const QUIZ_CONTENT: QuizPlayContent = {
  objective: 'Check HTML basics',
  passScore: 70,
  questions: [
    {
      q: 'Which tag makes a heading?',
      type: 'mcq',
      options: ['<h1>', '<p>', '<div>'],
      answer: 0,
      explain: 'h1 is the top heading tag',
    },
    {
      q: 'HTML is a programming language.',
      type: 'boolean',
      answer: false,
      explain: 'HTML is a markup language',
    },
  ],
};

const READING_CONTENT: ReadingPlayContent = {
  objective: 'Understand tags',
  sections: ['Tags wrap content.', 'Attributes configure tags.'],
  keyTakeaways: ['Tags wrap', 'Attributes configure'],
};

const STRUCTURED_READING: ReadingPlayContent = {
  objective: 'Understand tags',
  sections: [
    {
      id: 's0',
      title: 'Tags',
      blocks: [
        { type: 'text', body: 'Tags wrap content.' },
        { type: 'callout', title: 'Tip', body: 'Close your tags.' },
      ],
    },
    {
      id: 's1',
      title: 'Attributes',
      blocks: [{ type: 'code', label: 'html', code: '<a href="/">' }],
    },
  ],
  keyTakeaways: ['Tags wrap', 'Attributes configure'],
};

const TASK_CONTENT: TaskPlayContent = {
  objective: 'Build a page',
  task: 'Create an HTML page with a heading.',
  acceptanceCriteria: ['Has <h1>', 'Valid HTML'],
  hints: ['Start with <!DOCTYPE html>'],
  starterHtml: '<html></html>',
};

function lessonWith(content: Record<string, unknown>): Lesson {
  return { playContent: content } as unknown as Lesson;
}

function makeContentService() {
  return new LessonContentService(
    { save: jest.fn(async (row: Lesson) => row) } as never,
    { getUnitById: jest.fn().mockResolvedValue(null) } as never,
    { resolveFresh: jest.fn().mockResolvedValue(null) } as never,
  );
}

describe('lesson-play.types helpers', () => {
  it('accepts all unit body shapes', () => {
    expect(isUnitPlayContent(QUIZ_CONTENT)).toBe(true);
    expect(isUnitPlayContent(READING_CONTENT)).toBe(true);
    expect(isUnitPlayContent(STRUCTURED_READING)).toBe(true);
    expect(isUnitPlayContent(TASK_CONTENT)).toBe(true);
    expect(isUnitPlayContent({ objective: 'watch', note: 'A video' })).toBe(
      true,
    );
    expect(isUnitPlayContent({ sections: [] })).toBe(false);
    expect(
      isUnitPlayContent({ objective: 'x', sections: [], keyTakeaways: [] }),
    ).toBe(false);
    expect(isUnitPlayContent(null)).toBe(false);
  });

  it('rejects malformed structured sections', () => {
    expect(
      isUnitPlayContent({
        objective: 'x',
        sections: [{ id: 's0', title: 'T', blocks: [{ type: 'weird' }] }],
        keyTakeaways: [],
      }),
    ).toBe(false);
  });

  it('normalizes quiz question ids to q0..', () => {
    const normalized = normalizeUnitPlayContent(
      QUIZ_CONTENT,
    ) as QuizPlayContent;
    expect(normalized.questions.map((q) => q.id)).toEqual(['q0', 'q1']);
  });

  it('stripPlaySecrets removes answer/explain from questions', () => {
    const stripped = stripPlaySecrets(
      normalizeUnitPlayContent(QUIZ_CONTENT),
    ) as QuizPlayContent;
    expect(collectSecretKeyHits(stripped)).toEqual([]);
    expect(stripped.questions[0]).not.toHaveProperty('answer');
    expect(stripped.questions[0]).not.toHaveProperty('explain');
    expect(stripped.questions[0]).toHaveProperty('q');
    expect(stripped.questions[0]).toHaveProperty('options');
  });
});

describe('LessonContentService', () => {
  const content = makeContentService();

  it('resolves playContent and strips secrets on public body', () => {
    const lesson = lessonWith(
      QUIZ_CONTENT as unknown as Record<string, unknown>,
    );
    const resolved = content.resolvePlayContent(lesson);
    const body = content.toPublicPlayBody(resolved);
    expect(collectSecretKeyHits(body)).toEqual([]);
    const questions = (body as { questions: Array<Record<string, unknown>> })
      .questions;
    expect(questions[0].id).toBe('q0');
  });

  it('resolves structured reading sections', () => {
    const lesson = lessonWith(
      STRUCTURED_READING as unknown as Record<string, unknown>,
    );
    const resolved = content.resolvePlayContent(lesson);
    expect(resolved).toMatchObject({ objective: 'Understand tags' });
  });

  it('throws when playContent is missing or invalid', () => {
    expect(() => content.resolvePlayContent(lessonWith({}))).toThrow();
  });

  it('hydrates playContent from the unit catalog when snapshot is missing', async () => {
    const save = jest.fn(async (row: Lesson) => row);
    const getUnitById = jest.fn().mockResolvedValue({
      id: 'html-intro-read',
      content: STRUCTURED_READING,
    });
    const svc = new LessonContentService(
      { save } as never,
      { getUnitById } as never,
      { resolveFresh: jest.fn().mockResolvedValue(null) } as never,
    );
    const lesson = {
      id: 'lesson-1',
      unitId: 'html-intro-read',
      playContent: null,
      objective: null,
    } as unknown as Lesson;

    const resolved = await svc.ensurePlayContent(lesson);
    expect(resolved.objective).toBe('Understand tags');
    expect(save).toHaveBeenCalled();
    expect(lesson.playContent).toMatchObject({ objective: 'Understand tags' });
  });

  it('grades mcq by question id and boolean by index', () => {
    const lesson = lessonWith(
      QUIZ_CONTENT as unknown as Record<string, unknown>,
    );
    const resolved = content.resolvePlayContent(lesson);

    const right = content.gradeQuizQuestion(resolved, {
      questionId: 'q0',
      optionIndex: 0,
    });
    expect(right.correct).toBe(true);
    expect(right.answer).toBe(0);
    expect(right.explain).toBe('h1 is the top heading tag');

    const wrong = content.gradeQuizQuestion(resolved, {
      questionIndex: 1,
      booleanAnswer: true,
    });
    expect(wrong.correct).toBe(false);
    expect(wrong.questionId).toBe('q1');
  });

  it('scores persisted answers against the snapshot', () => {
    const lesson = lessonWith(
      QUIZ_CONTENT as unknown as Record<string, unknown>,
    );
    const resolved = content.resolvePlayContent(lesson);
    const score = content.scoreQuiz(resolved, { q0: 0, q1: true });
    expect(score).toEqual({ correct: 1, total: 2, scorePercent: 50 });

    const perfect = content.scoreQuiz(resolved, { q0: 0, q1: false });
    expect(perfect.scorePercent).toBe(100);
  });

  it('non-quiz bodies score 100 with zero totals', () => {
    const score = content.scoreQuiz(READING_CONTENT, {});
    expect(score).toEqual({ correct: 0, total: 0, scorePercent: 100 });
  });
});

describe('LessonRewardsService', () => {
  const rewards = new LessonRewardsService(new RewardCalculatorService());

  const lesson = {
    title: 'Your first webpage',
    xpReward: 35,
    difficulty: 'beginner',
    lessonType: 'practice',
    estimatedMinutes: 20,
    missionName: 'HTML basics',
    rewardClassSnapshot: null,
  } as unknown as Lesson;

  it('awards first-step on first lesson ever via v2 calculator', () => {
    const reward = rewards.computeReward({
      lesson,
      quizCorrect: 3,
      quizTotal: 3,
      alreadyCompleted: false,
      isFirstLessonEver: true,
      pathPercentile: 10,
    });
    expect(reward.xp).toBeGreaterThan(0);
    expect(reward.badgeId).toBe('first-step');
  });

  it('returns zero on repeat complete', () => {
    const reward = rewards.computeReward({
      lesson,
      quizCorrect: 3,
      quizTotal: 3,
      alreadyCompleted: true,
      isFirstLessonEver: false,
    });
    expect(reward.xp).toBe(0);
    expect(reward.gems).toBe(0);
    expect(reward.coins).toBe(0);
  });
});
