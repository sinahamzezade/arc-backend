import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
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
import { REWARD_RULE_VERSION } from './reward-constants';

export type VariableRollOutcome =
  | {
      kind: 'bonus_xp';
      bonusPercent: number;
      bonusXp: number;
    }
  | {
      kind: 'bonus_gems';
      gems: number;
    }
  | {
      kind: 'mystery_unlock';
      flag: true;
    }
  | {
      kind: 'jackpot';
      multiplier: 2;
      bonusXp: number;
    };

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
  /** §16.5 adaptive mastery inputs */
  conceptsMastered?: number;
  conceptsTotal?: number;
  remediationRoundsUsed?: number;
  /** Any shaky concept → withhold perfect-run bonuses */
  hasShakyConcepts?: boolean;
  /** Idempotency / transaction key for deterministic variable roll */
  grantKey?: string;
};

export type RewardCalcResult = {
  xp: number;
  gems: number;
  coins: number;
  firstTime: boolean;
  metadata: Record<string, unknown>;
};

const ACTIVE_MODALITIES = new Set([
  'scenario',
  'sandbox_simulation',
  'visual_hotspot',
  'debate',
]);

const PASSIVE_MODALITIES = new Set(['text', 'video', 'reading', 'audio']);

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
    const hasShaky = Boolean(input.hasShakyConcepts);
    const remediationRounds = input.remediationRoundsUsed ?? 0;

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
        !hasShaky &&
        input.quizTotal > 0 &&
        input.quizCorrect === input.quizTotal;
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
        assist === 'none' &&
        remediationRounds === 0 &&
        !hasShaky
      ) {
        gems += 3;
      }
    } else if (input.attemptKind === 'review_7d') {
      gems = 0;
      coins = 0;
    }

    const metadata: Record<string, unknown> = {
      kind,
      difficulty: diff,
      diffM,
      posM,
      perfM,
      assistM,
      repeatM,
      attemptKind: input.attemptKind,
      pathPercentile: input.pathPercentile ?? 40,
      ruleVersion: REWARD_RULE_VERSION,
      conceptsMastered: input.conceptsMastered ?? null,
      conceptsTotal: input.conceptsTotal ?? null,
      remediationRoundsUsed: remediationRounds,
      hasShakyConcepts: hasShaky,
    };

    if (firstTime && input.grantKey) {
      const rollResult = this.applyVariableRoll({
        input,
        kind,
        perfM,
        xpBeforeRoll: xp,
        gemsBeforeRoll: gems,
        grantKey: input.grantKey,
      });
      xp = rollResult.xp;
      gems = rollResult.gems;
      Object.assign(metadata, rollResult.metadata);
    }

    xp = Math.min(XP_CAP, Math.max(0, xp));
    gems = Math.min(GEMS_CAP, Math.max(0, gems));
    coins = Math.min(COINS_CAP, Math.max(0, coins));

    return {
      xp,
      gems,
      coins,
      firstTime,
      metadata,
    };
  }

  private applyVariableRoll(input: {
    input: RewardCalcInput;
    kind: LessonActionKind;
    perfM: number;
    xpBeforeRoll: number;
    gemsBeforeRoll: number;
    grantKey: string;
  }): {
    xp: number;
    gems: number;
    metadata: Record<string, unknown>;
  } {
    const { input: calcInput, kind, perfM, xpBeforeRoll, gemsBeforeRoll, grantKey } =
      input;
    const modality = (calcInput.modality ?? '').toLowerCase();
    const rewardClass = (calcInput.rewardClass ?? '').toLowerCase();
    const quizPct =
      calcInput.quizTotal > 0
        ? (calcInput.quizCorrect / calcInput.quizTotal) * 100
        : 0;
    const highPerformance = quizPct >= 80 || perfM >= 1.0;

    const passiveNoQuiz =
      PASSIVE_MODALITIES.has(modality) && calcInput.quizTotal <= 0;

    const eligible =
      !passiveNoQuiz &&
      (quizPct >= 80 ||
        ACTIVE_MODALITIES.has(modality) ||
        rewardClass.includes('project') ||
        rewardClass.includes('challenge') ||
        ((kind === 'boss' || kind === 'coding') && highPerformance));

    if (!eligible) {
      if (passiveNoQuiz) {
        return {
          xp: xpBeforeRoll,
          gems: gemsBeforeRoll,
          metadata: {
            rollSkipped: AuthErrorCode.REWARD_ROLL_INELIGIBLE_ACTION,
          },
        };
      }
      return {
        xp: xpBeforeRoll,
        gems: gemsBeforeRoll,
        metadata: { variableRoll: null, rollSkipped: 'not_proof_gated' },
      };
    }

    const hash = createHash('sha256').update(grantKey).digest();
    const bucket = hash.readUInt32BE(0) % 100;
    const subRoll = hash.readUInt32BE(4);

    let xp = xpBeforeRoll;
    let gems = gemsBeforeRoll;
    let variableRoll: VariableRollOutcome;

    if (bucket < 60) {
      const bonusPercent = 10 + (subRoll % 31);
      const bonusXp = Math.round(xpBeforeRoll * (bonusPercent / 100));
      xp += bonusXp;
      variableRoll = { kind: 'bonus_xp', bonusPercent, bonusXp };
    } else if (bucket < 85) {
      const bonusGems = 2 + (subRoll % 4);
      gems += bonusGems;
      variableRoll = { kind: 'bonus_gems', gems: bonusGems };
    } else if (bucket < 97) {
      variableRoll = { kind: 'mystery_unlock', flag: true };
    } else {
      const bonusXp = xpBeforeRoll;
      xp += bonusXp;
      variableRoll = { kind: 'jackpot', multiplier: 2, bonusXp };
    }

    return {
      xp,
      gems,
      metadata: {
        variableRoll,
        rollBucket: bucket,
        grantKey,
      },
    };
  }
}
