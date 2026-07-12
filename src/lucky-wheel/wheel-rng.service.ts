import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';

@Injectable()
export class WheelRngService {
  /**
   * Cryptographically secure pick among weighted items.
   * Returns normalized rng in (0,1] and selected index.
   */
  pickWeighted(weights: number[]): { index: number; rngValue: number } {
    if (!weights.length) {
      return { index: 0, rngValue: 1 };
    }
    const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
    if (total <= 0) {
      return { index: 0, rngValue: 1 };
    }
    // randomInt is inclusive; map to (0, total]
    const roll = randomInt(1, total + 1);
    let cursor = 0;
    for (let i = 0; i < weights.length; i++) {
      cursor += Math.max(0, weights[i]);
      if (roll <= cursor) {
        return { index: i, rngValue: roll / total };
      }
    }
    return { index: weights.length - 1, rngValue: 1 };
  }
}
