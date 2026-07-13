import { createHash } from 'crypto';

describe('roadmap seed hash', () => {
  function seedFor(userId: string, goalRevision: string): number {
    const hex = createHash('sha256')
      .update(`${userId}:${goalRevision}`)
      .digest('hex')
      .slice(0, 8);
    return Number.parseInt(hex, 16);
  }

  it('is stable for same inputs', () => {
    expect(seedFor('u1', 'g1:t')).toBe(seedFor('u1', 'g1:t'));
  });

  it('diverges across users', () => {
    expect(seedFor('u1', 'g1:t')).not.toBe(seedFor('u2', 'g1:t'));
  });
});
