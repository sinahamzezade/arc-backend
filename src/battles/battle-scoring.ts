import { BATTLE_DIFFICULTY_BONUS } from './battle.constants';

export type ScoreBreakdown = {
  correctnessPoints: number;
  speedBonus: number;
  difficultyBonus: number;
  streakBonus: number;
  questionScore: number;
};

export function scoreBattleAnswer(input: {
  isCorrect: boolean;
  responseMs: number;
  timeLimitMs: number;
  difficulty: string;
  correctStreakBefore: number;
}): ScoreBreakdown {
  if (!input.isCorrect) {
    return {
      correctnessPoints: 0,
      speedBonus: 0,
      difficultyBonus: 0,
      streakBonus: 0,
      questionScore: 0,
    };
  }

  const remainingMs = Math.max(0, input.timeLimitMs - input.responseMs);
  const speedBonus = Math.round(30 * (remainingMs / Math.max(1, input.timeLimitMs)));
  const difficultyBonus = BATTLE_DIFFICULTY_BONUS[input.difficulty] ?? 0;
  const nextStreak = input.correctStreakBefore + 1;
  const streakBonus = nextStreak >= 3 ? 15 : 0;
  const correctnessPoints = 100;

  return {
    correctnessPoints,
    speedBonus,
    difficultyBonus,
    streakBonus,
    questionScore:
      correctnessPoints + speedBonus + difficultyBonus + streakBonus,
  };
}
