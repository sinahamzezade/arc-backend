import { scoreBattleAnswer } from './battle-scoring';

describe('scoreBattleAnswer', () => {
  it('awards correctness + speed + difficulty + streak', () => {
    const result = scoreBattleAnswer({
      isCorrect: true,
      responseMs: 0,
      timeLimitMs: 30_000,
      difficulty: 'hard',
      correctStreakBefore: 2,
    });
    expect(result.correctnessPoints).toBe(100);
    expect(result.speedBonus).toBe(30);
    expect(result.difficultyBonus).toBe(10);
    expect(result.streakBonus).toBe(15);
    expect(result.questionScore).toBe(155);
  });

  it('zeros incorrect answers', () => {
    const result = scoreBattleAnswer({
      isCorrect: false,
      responseMs: 100,
      timeLimitMs: 30_000,
      difficulty: 'expert',
      correctStreakBefore: 5,
    });
    expect(result.questionScore).toBe(0);
  });
});
