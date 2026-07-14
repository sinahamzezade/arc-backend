import {
  ARC_PERSONALIZATION_KEY,
  isAlreadyPersonalized,
  mergeLessonBodyRewrite,
  parseLessonBodyRewrite,
} from './lesson-body-personalizer.schema';
import type { LessonPlayOutline } from './lesson-play.types';
import { isPlayOutline } from './lesson-play.types';

const SCAFFOLD: LessonPlayOutline = {
  objective: 'Learn useState basics',
  arloPrompt: 'Ask about state',
  suggestedArlo: ['What is state?'],
  content: [
    {
      id: 'c1',
      title: 'Intro',
      blocks: [{ type: 'text', body: 'Generic intro about state.' }],
    },
    {
      id: 'c2',
      title: 'Practice note',
      blocks: [
        { type: 'callout', title: 'Tip', body: 'Keep state local first.' },
      ],
    },
  ],
  practice: {
    id: 'p1',
    prompt: 'Which option is correct?',
    hint: 'Pick a',
    conceptTag: 'hooks:usestate',
    options: [
      { id: 'a', label: 'Correct answer', correct: true },
      { id: 'b', label: 'Wrong B', correct: false },
    ],
    feedbackIncorrect: 'Nope.',
  },
  quiz: [
    {
      id: 'q1',
      prompt: 'Quiz one?',
      conceptTag: 'hooks:quiz-one',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correctOptionId: 'a',
      explanation: 'Because A',
    },
  ],
  reward: { gems: 2, coins: 15, arloLine: 'Nice.' },
};

describe('lesson-body-personalizer.schema', () => {
  it('merges rewrite but freezes practice/quiz correctOptionId', () => {
    const draft = parseLessonBodyRewrite(
      {
        objective: 'State for marketers',
        arloPrompt: 'Ask about campaign state',
        suggestedArlo: ['Map to a CRM field'],
        pages: [
          {
            id: 'c1',
            title: 'Marketing intro',
            blocks: [
              {
                type: 'text',
                body: 'Think of state like a lead score field.',
              },
            ],
          },
          {
            id: 'c2',
            title: 'Tip for PMs',
            blocks: [
              {
                type: 'callout',
                title: 'PM tip',
                body: 'One source of truth.',
              },
            ],
          },
        ],
      },
      new Set(['c1', 'c2']),
    );

    const merged = mergeLessonBodyRewrite(SCAFFOLD, draft, {
      source: 'llm',
      model: 'test-model',
      promptVersion: 'v1',
      at: '2026-07-14T00:00:00.000Z',
    });

    expect(isPlayOutline(merged)).toBe(true);
    expect(merged.objective).toBe('State for marketers');
    expect(merged.content[0]!.title).toBe('Marketing intro');
    expect(merged.content[0]!.blocks[0]).toEqual({
      type: 'text',
      body: 'Think of state like a lead score field.',
    });
    expect(merged.practice.id).toBe('p1');
    expect(merged.practice.options[0]!.correct).toBe(true);
    expect(merged.quiz[0]!.id).toBe('q1');
    expect(merged.quiz[0]!.correctOptionId).toBe('a');
    expect(isAlreadyPersonalized(merged)).toBe(true);
    expect(
      (merged as Record<string, unknown>)[ARC_PERSONALIZATION_KEY],
    ).toMatchObject({ source: 'llm', model: 'test-model' });
  });

  it('rejects unknown page ids', () => {
    expect(() =>
      parseLessonBodyRewrite(
        {
          pages: [
            {
              id: 'invented',
              title: 'Nope',
              blocks: [{ type: 'text', body: 'x' }],
            },
          ],
        },
        new Set(['c1']),
      ),
    ).toThrow(/Unknown or missing page id/);
  });

  it('isAlreadyPersonalized false on scaffold', () => {
    expect(isAlreadyPersonalized(SCAFFOLD)).toBe(false);
    expect(isAlreadyPersonalized(null)).toBe(false);
  });
});
