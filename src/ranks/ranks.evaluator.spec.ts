import {
  ensureBaseGates,
  evaluateGates,
} from './ranks.evaluator';

describe('ranks.evaluator', () => {
  it('blocks unlock when XP passes but milestone missing', () => {
    const gates = ensureBaseGates(
      {
        all: [
          { type: 'lifetime_xp', gte: 8500 },
          { type: 'active_days', gte: 35 },
          { type: 'phases_completed', gte: 2 },
          { type: 'challenges_passed', gte: 2 },
        ],
      },
      8500,
      35,
    );
    const { allComplete, requirements } = evaluateGates(gates, {
      lifetimeXp: 9100,
      activeDays: 40,
      counters: { phases_completed: 1, challenges_passed: 2 },
    });
    expect(allComplete).toBe(false);
    expect(
      requirements.find((r) => r.key === 'phases_completed')?.complete,
    ).toBe(false);
  });

  it('passes when all gates met', () => {
    const { allComplete } = evaluateGates(
      {
        all: [
          { type: 'lifetime_xp', gte: 300 },
          { type: 'active_days', gte: 2 },
          { type: 'lessons_completed', gte: 3 },
        ],
      },
      {
        lifetimeXp: 400,
        activeDays: 3,
        counters: { lessons_completed: 3 },
      },
    );
    expect(allComplete).toBe(true);
  });
});
