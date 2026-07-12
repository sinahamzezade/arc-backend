import {
  DEMOTE_RATIO,
  FULL_COHORT_DEMOTE,
  FULL_COHORT_PROMOTE,
  PROMOTE_RATIO,
} from './leagues.constants';
import { LeaguePromotionResult } from './entities/league.enums';
import {
  clampPlacementToGate,
  demoteOne,
  type LeaguePlacement,
  promoteOne,
} from './league-tiers';
import { LeagueDivision, LeagueTier } from './entities/league.enums';

export type PromotionCounts = {
  promoteCount: number;
  demoteCount: number;
  remainFloor: number;
  remainCeil: number;
};

export function promotionCounts(activeMembers: number): PromotionCounts {
  if (activeMembers <= 0) {
    return { promoteCount: 0, demoteCount: 0, remainFloor: 1, remainCeil: 0 };
  }

  let promoteCount: number;
  let demoteCount: number;

  if (activeMembers === 30) {
    promoteCount = FULL_COHORT_PROMOTE;
    demoteCount = FULL_COHORT_DEMOTE;
  } else {
    promoteCount = Math.max(1, Math.floor(activeMembers * PROMOTE_RATIO));
    demoteCount = Math.max(1, Math.floor(activeMembers * DEMOTE_RATIO));
  }

  // Keep promote+demote from consuming entire cohort.
  if (promoteCount + demoteCount >= activeMembers) {
    demoteCount = Math.max(0, activeMembers - promoteCount - 1);
  }

  const remainFloor = promoteCount + 1;
  const remainCeil = activeMembers - demoteCount;

  return { promoteCount, demoteCount, remainFloor, remainCeil };
}

export type RankedMember = {
  userId: string;
  position: number;
  qualifiedXp: number;
  placement: LeaguePlacement;
  rankLevel: number;
  weeklySeals: number;
  isBronzeFloor: boolean;
};

export type PromotionOutcome = {
  userId: string;
  position: number;
  result: LeaguePromotionResult;
  oldPlacement: LeaguePlacement;
  newPlacement: LeaguePlacement;
};

/**
 * Apply promote/remain/demote + rank gates.
 * Zero-activity Bronze members → inactive (no demotion).
 */
export function applyPromotionResults(
  members: RankedMember[],
): PromotionOutcome[] {
  const active = members.filter((m) => m.qualifiedXp > 0);
  const zeroXp = members.filter((m) => m.qualifiedXp <= 0);
  const counts = promotionCounts(active.length);

  const outcomes: PromotionOutcome[] = [];

  for (const m of active) {
    let result: LeaguePromotionResult;
    let next = m.placement;

    if (m.position <= counts.promoteCount) {
      next = promoteOne(m.placement);
      const gated = clampPlacementToGate(
        next,
        m.rankLevel,
        m.weeklySeals,
      );
      if (gated.gateBlocked) {
        result = LeaguePromotionResult.GateBlocked;
        next = { ...m.placement }; // remain Gold I etc.
      } else {
        result = LeaguePromotionResult.Promoted;
        next = gated.placement;
      }
    } else if (m.position > counts.remainCeil) {
      if (
        m.placement.tier === LeagueTier.Bronze &&
        m.placement.division === LeagueDivision.III
      ) {
        result = LeaguePromotionResult.Remained;
        next = m.placement;
      } else {
        result = LeaguePromotionResult.Demoted;
        next = demoteOne(m.placement);
      }
    } else {
      result = LeaguePromotionResult.Remained;
      next = m.placement;
    }

    outcomes.push({
      userId: m.userId,
      position: m.position,
      result,
      oldPlacement: m.placement,
      newPlacement: next,
    });
  }

  for (const m of zeroXp) {
    if (m.isBronzeFloor || m.placement.tier === LeagueTier.Bronze) {
      outcomes.push({
        userId: m.userId,
        position: m.position,
        result: LeaguePromotionResult.Inactive,
        oldPlacement: m.placement,
        newPlacement: m.placement,
      });
    } else {
      outcomes.push({
        userId: m.userId,
        position: m.position,
        result: LeaguePromotionResult.Demoted,
        oldPlacement: m.placement,
        newPlacement: demoteOne(m.placement),
      });
    }
  }

  return outcomes;
}

export function zoneForPosition(
  position: number,
  activeMembers: number,
): 'promote' | 'remain' | 'demote' {
  const counts = promotionCounts(activeMembers);
  if (position <= counts.promoteCount) return 'promote';
  if (position > counts.remainCeil) return 'demote';
  return 'remain';
}
