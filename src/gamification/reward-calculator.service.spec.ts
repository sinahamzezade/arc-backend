import { RewardCalculatorService } from './reward-calculator.service';

describe('RewardCalculatorService', () => {
  const calc = new RewardCalculatorService();

  it('scales mid-course quiz with perfect score', () => {
    const r = calc.compute({
      actionKind: 'quiz',
      difficulty: 'beginner',
      pathPercentile: 40,
      quizCorrect: 3,
      quizTotal: 3,
      attemptKind: 'first',
    });
    // 25 * 1 * 1 * 1.3 = 33 + first-attempt ~3 → 36
    expect(r.xp).toBeGreaterThanOrEqual(30);
    expect(r.gems).toBe(4); // 2 + perfect
    expect(r.coins).toBe(15);
    expect(r.firstTime).toBe(true);
  });

  it('zeros late review', () => {
    const r = calc.compute({
      actionKind: 'quiz',
      quizCorrect: 3,
      quizTotal: 3,
      attemptKind: 'review_later',
    });
    expect(r.xp).toBe(0);
    expect(r.gems).toBe(0);
  });

  it('caps extreme capstone', () => {
    const r = calc.compute({
      actionKind: 'capstone',
      difficulty: 'expert',
      pathPercentile: 99,
      quizCorrect: 10,
      quizTotal: 10,
      attemptKind: 'first',
    });
    expect(r.xp).toBeLessThanOrEqual(1000);
    expect(r.gems).toBeLessThanOrEqual(75);
    expect(r.coins).toBeLessThanOrEqual(500);
  });
});
