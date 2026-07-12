import {
  DIVISION_ORDER,
  MASTER_MIN_WEEKLY_SEALS,
  TIER_ORDER,
  TIER_RANK_GATES,
} from './leagues.constants';
import { LeagueDivision, LeagueTier } from './entities/league.enums';

export type LeaguePlacement = {
  tier: LeagueTier;
  division: LeagueDivision;
};

export function tierIndex(tier: LeagueTier): number {
  return TIER_ORDER.indexOf(tier);
}

export function divisionIndex(division: LeagueDivision): number {
  return DIVISION_ORDER.indexOf(division);
}

export function meetsTierGate(
  tier: LeagueTier,
  rankLevel: number,
  weeklySeals: number,
): boolean {
  if (rankLevel < TIER_RANK_GATES[tier]) return false;
  if (tier === LeagueTier.Master && weeklySeals < MASTER_MIN_WEEKLY_SEALS) {
    return false;
  }
  return true;
}

/** Highest tier the user may enter given rank + seals. */
export function maxEligibleTier(
  rankLevel: number,
  weeklySeals: number,
): LeagueTier {
  let best = LeagueTier.Bronze;
  for (const tier of TIER_ORDER) {
    if (meetsTierGate(tier, rankLevel, weeklySeals)) best = tier;
  }
  return best;
}

export function promoteOne(
  placement: LeaguePlacement,
): LeaguePlacement {
  const dIdx = divisionIndex(placement.division);
  if (dIdx < DIVISION_ORDER.length - 1) {
    return {
      tier: placement.tier,
      division: DIVISION_ORDER[dIdx + 1],
    };
  }
  const tIdx = tierIndex(placement.tier);
  if (tIdx < TIER_ORDER.length - 1) {
    return {
      tier: TIER_ORDER[tIdx + 1],
      division: LeagueDivision.III,
    };
  }
  return placement;
}

export function demoteOne(
  placement: LeaguePlacement,
): LeaguePlacement {
  const dIdx = divisionIndex(placement.division);
  if (dIdx > 0) {
    return {
      tier: placement.tier,
      division: DIVISION_ORDER[dIdx - 1],
    };
  }
  const tIdx = tierIndex(placement.tier);
  if (tIdx > 0) {
    return {
      tier: TIER_ORDER[tIdx - 1],
      division: LeagueDivision.I,
    };
  }
  return placement;
}

export function clampPlacementToGate(
  placement: LeaguePlacement,
  rankLevel: number,
  weeklySeals: number,
): { placement: LeaguePlacement; gateBlocked: boolean } {
  if (meetsTierGate(placement.tier, rankLevel, weeklySeals)) {
    return { placement, gateBlocked: false };
  }
  // Stay at previous tier's top division when gate blocks upward move.
  const tIdx = tierIndex(placement.tier);
  if (tIdx <= 0) {
    return {
      placement: { tier: LeagueTier.Bronze, division: LeagueDivision.III },
      gateBlocked: true,
    };
  }
  return {
    placement: {
      tier: TIER_ORDER[tIdx - 1],
      division: LeagueDivision.I,
    },
    gateBlocked: true,
  };
}
