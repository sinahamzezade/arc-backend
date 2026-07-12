import { Injectable } from '@nestjs/common';
import {
  ASSISTANCE_MULT,
  AssistanceLevel,
  BASE_REWARDS,
  COINS_CAP,
  DIFFICULTY_MULT,
  GEMS_CAP,
  inferActionKind,
  LessonActionKind,
  normalizeDifficulty,
  performanceMultiplier,
  positionMultiplier,
  XP_CAP,
} from './reward-calculator.constants';

export type RewardCalcInput = {
  actionKind?: LessonActionKind;
  modality?: string;
  title?: string;
  track?: string;
  rewardClass?: string;
  estimatedMinutes?: number;
  difficulty?: string;
  /** 0–100 position in required path */
  pathPercentile?: number;
  quizCorrect: number;
  quizTotal: number;
  assistance?: AssistanceLevel;
  /** First completion vs review */
  attemptKind: 'first' | 'review_7d' | 'review_later' | 'after_solution';
  weeklyOnTrack?: boolean;
  isFirstLessonEver?: boolean;
};

export type RewardCalcResult = {
  xp: number;
  gems: number;
  coins: number;
  firstTime: boolean;
  metadata: Record<string, unknown>;
};

@Injectable()
export class RewardCalculatorService {
  compute(input: RewardCalcInput): RewardCalcResult {
    const kind =
      input.actionKind ??
      inferActionKind({
        title: input.title,
        track: input.track,
        modality: input.modality,
        rewardClass: input.rewardClass,
        estimatedMinutes: input.estimatedMinutes,
      });
    const base = BASE_REWARDS[kind];
    const diff = normalizeDifficulty(input.difficulty);
    const diffM = DIFFICULTY_MULT[diff];
    const posM = positionMultiplier(input.pathPercentile ?? 40);
    const perfM = performanceMultiplier(input.quizCorrect, input.quizTotal);
    const assist = input.assistance ?? 'none';
    const assistM = ASSISTANCE_MULT[assist];

    let repeatM = 1;
    if (input.attemptKind === 'review_7d') repeatM = 0.1;
    if (input.attemptKind === 'review_later') repeatM = 0;
    if (input.attemptKind === 'after_solution') {
      repeatM = Math.min(0.4, assistM);
    }

    const firstTime = input.attemptKind === 'first';
    if (!firstTime && repeatM === 0) {
      return {
        xp: 0,
        gems: 0,
        coins: 0,
        firstTime: false,
        metadata: { kind, attemptKind: input.attemptKind, zeroed: true },
      };
    }

    let xp = Math.round(
      base.xp * diffM * posM * perfM * assistM * repeatM,
    );
    let gems = firstTime
      ? Math.round(base.gems * diffM * posM)
      : 0;
    let coins = firstTime
      ? Math.round(base.coins * diffM * Math.min(posM, 1.4))
      : 0;

    // Bonuses (first completion only for gems/coins extras)
    if (firstTime) {
      const perfect =
        input.quizTotal > 0 && input.quizCorrect === input.quizTotal;
      if (perfect) gems += 2;

      const firstAttemptBonus = Math.min(40, Math.round(xp * 0.1));
      xp += firstAttemptBonus;

      if (input.weeklyOnTrack) {
        xp = Math.round(xp * 1.05);
      }

      if (
        (diff === 'advanced' || diff === 'expert') &&
        (kind === 'coding' ||
          kind === 'dataset' ||
          kind === 'debugging' ||
          kind === 'boss' ||
          kind === 'capstone')
      ) {
        xp += 5;
      }

      if (kind === 'capstone' && perfect) {
        xp += 100;
        gems += 10;
      }

      if (
        (kind === 'coding' || kind === 'dataset') &&
        assist === 'none'
      ) {
        gems += 3;
      }
    } else if (input.attemptKind === 'review_7d') {
      gems = 0;
      coins = 0;
    }

    xp = Math.min(XP_CAP, Math.max(0, xp));
    gems = Math.min(GEMS_CAP, Math.max(0, gems));
    coins = Math.min(COINS_CAP, Math.max(0, coins));

    return {
      xp,
      gems,
      coins,
      firstTime,
      metadata: {
        kind,
        difficulty: diff,
        diffM,
        posM,
        perfM,
        assistM,
        repeatM,
        attemptKind: input.attemptKind,
        pathPercentile: input.pathPercentile ?? 40,
        ruleVersion: 'lesson-reward-v2',
      },
    };
  }
}
