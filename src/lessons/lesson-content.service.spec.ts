import { LessonContentService } from './lesson-content.service';
import { LessonRewardsService } from './lesson-rewards.service';
import { HTML_HELLO_WORLD_OUTLINE } from './play-outline.factory';
import { Lesson } from '../roadmaps/entities/lesson.entity';

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
  const rewards = new LessonRewardsService(new LessonContentService());

  const lesson = {
    title: 'Your first webpage',
    xpReward: 35,
    difficulty: 'beginner',
  } as Lesson;

  it('awards first-step on first lesson ever', () => {
    const reward = rewards.computeReward({
      lesson,
      outline: HTML_HELLO_WORLD_OUTLINE,
      quizCorrect: 3,
      quizTotal: 3,
      alreadyCompleted: false,
      isFirstLessonEver: true,
    });
    expect(reward.xp).toBe(35);
    expect(reward.gems).toBe(4); // 2 base + 2 perfect
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
