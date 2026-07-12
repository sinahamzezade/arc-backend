import { WheelRngService } from './wheel-rng.service';

describe('WheelRngService', () => {
  const rng = new WheelRngService();

  it('picks within weight bounds', () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < 300; i++) {
      const { index } = rng.pickWeighted([10, 20, 70]);
      counts[index] += 1;
    }
    expect(counts[0] + counts[1] + counts[2]).toBe(300);
    expect(counts[2]).toBeGreaterThan(counts[0]);
  });

  it('handles empty weights', () => {
    expect(rng.pickWeighted([]).index).toBe(0);
  });
});
