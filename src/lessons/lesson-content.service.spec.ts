import { LessonContentService } from './lesson-content.service';
import { LessonRewardsService } from './lesson-rewards.service';
import { HTML_HELLO_WORLD_OUTLINE } from './play-outline.factory';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { RewardCalculatorService } from '../gamification/reward-calculator.service';

describe('LessonContentService', () => {
  const content = new LessonContentService();

  it('strips grading keys from public play body', () => {
    const body = content.toPublicPlayBody(HTML_HELLO_WORLD_OUTLINE);
    expect(body.practice.options[0]).toEqual({
      id: 'a',
      label: '<p>Hello Arc</p>',
    });
    expect(body.quiz[0]).not.toHaveProperty('correctOptionId');
    expect(body.quiz[0]).not.toHaveProperty('explanation');
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
      outline: HTML_HELLO_WORLD_OUTLINE,
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
      outline: HTML_HELLO_WORLD_OUTLINE,
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
