import { LessonContentService } from './lesson-content.service';
import { LessonRewardsService } from './lesson-rewards.service';
import type { LessonPlayOutline } from './lesson-play.types';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { RewardCalculatorService } from '../gamification/reward-calculator.service';

/** Minimal outline for unit tests only — not production content. */
const TEST_OUTLINE: LessonPlayOutline = {
  objective: 'Test objective',
  arloPrompt: 'Ask me',
  suggestedArlo: ['Explain this'],
  content: [
    {
      id: 'c1',
      title: 'Intro',
      blocks: [{ type: 'text', body: 'Body text' }],
    },
  ],
  practice: {
    id: 'p1',
    prompt: 'Which option is correct?',
    hint: 'Pick a',
    conceptTag: 'test-skill:option-correct',
    options: [
      { id: 'a', label: 'Correct answer', correct: true },
      { id: 'b', label: 'Wrong B', correct: false },
      { id: 'c', label: 'Wrong C', correct: false },
      { id: 'd', label: 'Wrong D', correct: false },
    ],
    feedbackIncorrect: 'Nope — secret.',
  },
  quiz: [
    {
      id: 'q1',
      prompt: 'Quiz one?',
      conceptTag: 'test-skill:quiz-one',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correctOptionId: 'a',
      explanation: 'Because A',
    },
    {
      id: 'q2',
      prompt: 'Quiz two?',
      conceptTag: 'test-skill:quiz-two',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correctOptionId: 'b',
      explanation: 'Because B',
    },
    {
      id: 'q3',
      prompt: 'Quiz three?',
      conceptTag: 'test-skill:quiz-three',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      correctOptionId: 'a',
      explanation: 'Because A',
    },
  ],
  reward: {
    gems: 2,
    coins: 15,
    arloLine: 'Nice work.',
  },
  rewardPresentation: {
    rewardClass: 'standard_practice',
    arloLine: 'Nice work.',
    badgeCandidateKey: 'secret-badge',
  },
  remediation: {
    'test-skill:option-correct': {
      microExplanation: [{ type: 'text', body: 'Secret remediation' }],
      recoveryItems: [
        {
          id: 'r-1',
          prompt: 'Recovery?',
          options: [{ id: 'a', label: 'Yes', correct: true }],
          explanation: 'Secret recovery explanation',
        },
      ],
    },
  },
};

describe('LessonContentService', () => {
  const content = new LessonContentService();

  it('strips grading keys from public play body', () => {
    const body = content.toPublicPlayBody(TEST_OUTLINE);
    expect(body.practice.options).toHaveLength(4);
    expect(body.practice.options).toEqual(
      expect.arrayContaining([
        { id: 'a', label: 'Correct answer' },
        { id: 'b', label: 'Wrong B' },
        { id: 'c', label: 'Wrong C' },
        { id: 'd', label: 'Wrong D' },
      ]),
    );
    expect(body.practice.options.every((o) => !('correct' in o))).toBe(true);
    expect(body.quiz[0]).not.toHaveProperty('correctOptionId');
    expect(body.quiz[0]).not.toHaveProperty('explanation');
    expect(body.practice).not.toHaveProperty('feedbackIncorrect');
    expect(body).not.toHaveProperty('remediation');
    expect(body.rewardPresentation).not.toHaveProperty('badgeCandidateKey');
    expect(body.adaptive.enabled).toBe(true);
    expect(body.adaptive.concepts.length).toBeGreaterThan(0);
  });

  it('shuffles practice options across calls', () => {
    const orders = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const body = content.toPublicPlayBody(TEST_OUTLINE);
      orders.add(body.practice.options.map((o) => o.id).join(','));
    }
    expect(orders.size).toBeGreaterThan(1);
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
    lessonTemplate: null,
  } as Lesson;

  it('awards first-step on first lesson ever via v2 calculator', () => {
    const reward = rewards.computeReward({
      lesson,
      outline: TEST_OUTLINE,
      quizCorrect: 3,
      quizTotal: 3,
      alreadyCompleted: false,
      isFirstLessonEver: true,
      pathPercentile: 10,
    });
    // coding × beginner × early path × perfect + first-attempt bonus
    // 32 × 1 × 0.8 × 1.3 = 33 → +3 first-attempt → 36
    // gems: round(3×1×0.8)+2 perfect +3 coding first = 2+2+3 = 7
    // coins: round(20×1×0.8) = 16
    expect(reward.xp).toBe(36);
    expect(reward.gems).toBe(7);
    expect(reward.coins).toBe(16);
    expect(reward.badgeId).toBe('first-step');
  });

  it('returns zero on repeat complete', () => {
    const reward = rewards.computeReward({
      lesson,
      outline: TEST_OUTLINE,
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
