import {
  ARC_PERSONALIZATION_KEY,
  extractSafeFields,
  isAlreadyPersonalized,
  mergeLessonBodyRewrite,
  parseLessonBodyRewrite,
} from './lesson-body-personalizer.schema';
import {
  isUnitPlayContent,
  type QuizPlayContent,
  type ReadingPlayContent,
  type TaskPlayContent,
} from './lesson-play.types';

const READING: ReadingPlayContent = {
  objective: 'Learn useState basics',
  sections: ['Generic intro about state.', 'Keep state local first.'],
  keyTakeaways: ['State is memory', 'Local first'],
};

const TASK: TaskPlayContent = {
  objective: 'Build a counter',
  task: 'Create a counter with useState.',
  acceptanceCriteria: ['Button increments', 'Count renders'],
  hints: ['Start from useState(0)'],
  starterHtml: '<div id="app"></div>',
};

const QUIZ: QuizPlayContent = {
  objective: 'Check state knowledge',
  passScore: 70,
  questions: [
    {
      id: 'q0',
      q: 'useState returns?',
      type: 'mcq',
      options: ['array', 'object'],
      answer: 0,
      explain: 'Tuple of value and setter',
    },
  ],
};

const META = {
  source: 'llm' as const,
  model: 'test-model',
  promptVersion: 'v2',
  at: '2026-07-14T00:00:00.000Z',
};

describe('lesson-body-personalizer.schema', () => {
  it('extracts only safe fields per type', () => {
    expect(extractSafeFields(READING)).toEqual({
      objective: READING.objective,
      sections: READING.sections,
    });
    expect(extractSafeFields(TASK)).toEqual({
      objective: TASK.objective,
      task: TASK.task,
      hints: TASK.hints,
    });
    expect(extractSafeFields(QUIZ)).toEqual({ objective: QUIZ.objective });
  });

  it('merges rewrite but freezes keyTakeaways / acceptanceCriteria / questions', () => {
    const fields = extractSafeFields(READING);
    const draft = parseLessonBodyRewrite(
      {
        objective: 'State for marketers',
        sections: [
          'Think of state like a lead score field.',
          'One source of truth per campaign.',
        ],
      },
      fields,
    );
    const merged = mergeLessonBodyRewrite(READING, draft, META);

    expect(isUnitPlayContent(merged)).toBe(true);
    expect(merged.objective).toBe('State for marketers');
    expect((merged as ReadingPlayContent).sections[0]).toBe(
      'Think of state like a lead score field.',
    );
    expect((merged as ReadingPlayContent).keyTakeaways).toEqual(
      READING.keyTakeaways,
    );
    expect(isAlreadyPersonalized(merged)).toBe(true);
    expect(
      (merged as unknown as Record<string, unknown>)[ARC_PERSONALIZATION_KEY],
    ).toMatchObject({ source: 'llm', model: 'test-model' });
  });

  it('task merge preserves acceptanceCriteria and starterHtml', () => {
    const fields = extractSafeFields(TASK);
    const draft = parseLessonBodyRewrite(
      {
        objective: 'Counter for PMs',
        task: 'Build a sprint-point counter with useState.',
        hints: ['Model points as useState(0)'],
        acceptanceCriteria: ['SHOULD BE IGNORED'],
      },
      fields,
    );
    const merged = mergeLessonBodyRewrite(TASK, draft, META) as TaskPlayContent;
    expect(merged.task).toBe('Build a sprint-point counter with useState.');
    expect(merged.acceptanceCriteria).toEqual(TASK.acceptanceCriteria);
    expect(merged.starterHtml).toBe(TASK.starterHtml);
  });

  it('quiz merge can only touch objective — questions/answers frozen', () => {
    const fields = extractSafeFields(QUIZ);
    const draft = parseLessonBodyRewrite(
      {
        objective: 'Personalized quiz objective',
        questions: [{ q: 'evil', type: 'mcq', options: ['x'], answer: 0 }],
      },
      fields,
    );
    const merged = mergeLessonBodyRewrite(QUIZ, draft, META) as QuizPlayContent;
    expect(merged.objective).toBe('Personalized quiz objective');
    expect(merged.questions).toEqual(QUIZ.questions);
    expect(merged.passScore).toBe(70);
  });

  it('rejects section count drift', () => {
    expect(() =>
      parseLessonBodyRewrite(
        { sections: ['only one'] },
        extractSafeFields(READING),
      ),
    ).toThrow(/must keep 2 sections/);
  });

  it('rejects drafts with no usable fields', () => {
    expect(() =>
      parseLessonBodyRewrite({ pages: [] }, extractSafeFields(QUIZ)),
    ).toThrow(/no usable safe fields/);
  });

  it('isAlreadyPersonalized false on scaffold', () => {
    expect(isAlreadyPersonalized(READING)).toBe(false);
    expect(isAlreadyPersonalized(null)).toBe(false);
  });
});
