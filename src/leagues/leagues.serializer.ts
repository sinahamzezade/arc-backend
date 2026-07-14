import { LeagueCohort } from './entities/league-cohort.entity';
import { LeagueFinalResult } from './entities/league-final-result.entity';
import { LeagueMembership } from './entities/league-membership.entity';
import { LeagueSeason } from './entities/league-season.entity';
import { UserLeagueState } from './entities/user-league-state.entity';

export type LeaderboardEntryDto = {
  userId: string | null;
  position: number;
  qualifiedXp: number;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  anonymized: boolean;
};

export function toCurrentLeagueDto(input: {
  serverTimestamp: Date;
  season: LeagueSeason;
  cohort: LeagueCohort;
  membership: LeagueMembership;
  state: UserLeagueState;
  position: number;
  zones: {
    promoteThrough: number;
    remainFrom: number;
    remainThrough: number;
    demoteFrom: number;
  };
  topUsers: LeaderboardEntryDto[];
  surrounding: LeaderboardEntryDto[];
  breakdown: Record<string, number>;
  quests?: Array<{
    id: string;
    code: string;
    title: string;
    detail: string;
    progress: number;
    goal: number;
    xpReward: number;
    done: boolean;
  }>;
}) {
  return {
    serverTimestamp: input.serverTimestamp.toISOString(),
    season: {
      id: input.season.id,
      status: input.season.status,
      startsAt: input.season.startsAt.toISOString(),
      endsAt: input.season.endsAt.toISOString(),
      regionalBucket: input.season.regionalBucket,
      timezone: input.season.seasonTimezone,
    },
    cohort: {
      id: input.cohort.id,
      tier: input.cohort.tier,
      division: input.cohort.division,
      status: input.cohort.status,
      maxMembers: input.cohort.maxMembers,
    },
    me: {
      membershipId: input.membership.id,
      position: input.position,
      qualifiedXp: input.membership.qualifiedXp,
      proofWeightedXp: input.membership.proofWeightedXp,
      activeDays: input.membership.activeDays,
      hideFromProfile: input.state.hideFromProfile,
    },
    zones: input.zones,
    topUsers: input.topUsers,
    surroundingUsers: input.surrounding,
    scoreSourceBreakdown: input.breakdown,
    quests: input.quests ?? [],
  };
}

export function toLeaderboardDto(input: {
  serverTimestamp: Date;
  seasonEndsAt: Date;
  cohortId: string;
  entries: LeaderboardEntryDto[];
  nextCursor: string | null;
}) {
  return {
    serverTimestamp: input.serverTimestamp.toISOString(),
    seasonEndsAt: input.seasonEndsAt.toISOString(),
    cohortId: input.cohortId,
    entries: input.entries,
    nextCursor: input.nextCursor,
  };
}

export function toMeDto(input: {
  serverTimestamp: Date;
  season: LeagueSeason;
  cohort: LeagueCohort;
  membership: LeagueMembership;
  state: UserLeagueState;
  position: number;
  zone: 'promote' | 'remain' | 'demote';
  breakdown: Record<string, number>;
}) {
  return {
    serverTimestamp: input.serverTimestamp.toISOString(),
    seasonEndsAt: input.season.endsAt.toISOString(),
    tier: input.cohort.tier,
    division: input.cohort.division,
    position: input.position,
    qualifiedXp: input.membership.qualifiedXp,
    zone: input.zone,
    rankLevel: input.state.rankLevel,
    weeklySeals: input.state.weeklySeals,
    scoreSourceBreakdown: input.breakdown,
  };
}

export function toHistoryItemDto(row: LeagueFinalResult) {
  return {
    id: row.id,
    seasonId: row.seasonId,
    cohortId: row.cohortId,
    finalPosition: row.finalPosition,
    finalXp: row.finalXp,
    oldLeague: { tier: row.oldTier, division: row.oldDivision },
    newLeague: { tier: row.newTier, division: row.newDivision },
    promotionResult: row.promotionResult,
    reward: row.rewardSnapshot,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPublicUserLeagueDto(input: {
  userId: string;
  hidden: boolean;
  tier?: string;
  division?: string;
  position?: number | null;
  qualifiedXp?: number;
  seasonEndsAt?: Date | null;
}) {
  if (input.hidden) {
    return {
      userId: input.userId,
      hidden: true,
      league: null,
    };
  }
  return {
    userId: input.userId,
    hidden: false,
    league: {
      tier: input.tier,
      division: input.division,
      position: input.position ?? null,
      qualifiedXp: input.qualifiedXp ?? 0,
      seasonEndsAt: input.seasonEndsAt?.toISOString() ?? null,
    },
  };
}
