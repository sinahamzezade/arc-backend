import {
  LeagueDivision,
  LeagueRegionalBucket,
  LeagueTier,
} from './entities/league.enums';

export const DEFAULT_COHORT_SIZE = 30;
export const FULL_COHORT_PROMOTE = 7;
export const FULL_COHORT_DEMOTE = 5;
export const PROMOTE_RATIO = 0.23;
export const DEMOTE_RATIO = 0.17;
export const INACTIVE_EMPTY_SEASONS = 2;
export const SCORE_EVENT_GRACE_MS = 15 * 60 * 1000;
export const POSITION_NOTIFY_MIN_DELTA = 3;
export const RISK_NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const SEASON_START_HOUR = 4; // Monday 04:00 cohort-local
export const BATTLE_LEAGUE_XP_CAP = 100;
/** Soft hold when membership earns more than this XP in a rolling hour */
export const VELOCITY_XP_PER_HOUR = 800;
export const VELOCITY_WINDOW_MS = 60 * 60 * 1000;
export const POSITION_NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
export const MASTER_TOP3_SKU = 'frame-master-crown';

/** Tier entry gates from leagues.md §2 */
export const TIER_RANK_GATES: Record<LeagueTier, number> = {
  [LeagueTier.Bronze]: 1,
  [LeagueTier.Silver]: 3,
  [LeagueTier.Gold]: 4,
  [LeagueTier.Platinum]: 6,
  [LeagueTier.Diamond]: 8,
  [LeagueTier.Master]: 10,
};

export const MASTER_MIN_WEEKLY_SEALS = 12;

export const TIER_ORDER: LeagueTier[] = [
  LeagueTier.Bronze,
  LeagueTier.Silver,
  LeagueTier.Gold,
  LeagueTier.Platinum,
  LeagueTier.Diamond,
  LeagueTier.Master,
];

export const DIVISION_ORDER: LeagueDivision[] = [
  LeagueDivision.III,
  LeagueDivision.II,
  LeagueDivision.I,
];

/** Example season rewards — coins/gems do not count as League XP */
export const SEASON_REWARDS = {
  place1: { coins: 500, gems: 25 },
  place2: { coins: 350, gems: 15 },
  place3: { coins: 250, gems: 10 },
  promoted: { coins: 100, gems: 0 },
  stayedActive: { coins: 25, gems: 0 },
  masterTop3Cosmetic: { sku: MASTER_TOP3_SKU, title: 'Master Crown Frame' },
} as const;

export const REGIONAL_TIMEZONES: Record<LeagueRegionalBucket, string> = {
  [LeagueRegionalBucket.Europe]: 'Europe/Berlin',
  [LeagueRegionalBucket.Americas]: 'America/New_York',
  [LeagueRegionalBucket.Apac]: 'Asia/Tokyo',
  [LeagueRegionalBucket.MiddleEastAfrica]: 'Africa/Cairo',
};

export const LIVE_SCORE_KEY = (cohortId: string) =>
  `league:cohort:${cohortId}:scores`;
export const LIVE_MEMBER_KEY = (cohortId: string, userId: string) =>
  `league:cohort:${cohortId}:member:${userId}`;
