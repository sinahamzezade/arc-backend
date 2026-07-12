export enum BadgeCategory {
  GettingStarted = 'getting_started',
  Learning = 'learning',
  Quiz = 'quiz',
  Consistency = 'consistency',
  Roadmap = 'roadmap',
  Projects = 'projects',
  Social = 'social',
  Battle = 'battle',
  Referral = 'referral',
}

export enum BadgeRarity {
  Common = 'common',
  Uncommon = 'uncommon',
  Rare = 'rare',
  Epic = 'epic',
  Legendary = 'legendary',
}

export enum BadgeDefinitionStatus {
  Draft = 'draft',
  Active = 'active',
  Retired = 'retired',
}

export enum UserBadgeStatus {
  Earned = 'earned',
  Revoked = 'revoked',
}

export enum BadgeCriteriaType {
  Counter = 'counter',
  DistinctSet = 'distinct_set',
  Consecutive = 'consecutive',
  Composite = 'composite',
  EventOnce = 'event_once',
  ReferralMilestone = 'referral_milestone',
}

export type BadgeRewardJson = {
  coins?: number;
  gems?: number;
  /** Skip ledger — currency already granted elsewhere (referral). */
  skipLedger?: boolean;
  cosmetic?: string;
};

export type BadgeCriteriaJson = {
  counterKey?: string;
  target?: number;
  setKey?: string;
  setTarget?: number;
  consecutiveKey?: string;
  minConsecutive?: number;
  eventType?: string;
  referralQualified?: number;
  compositeKeys?: string[];
};

export const BADGE_CORE_TOTAL = 36;
export const BADGE_FEATURED_MAX = 4;

export const OUTBOX_BADGE_UNLOCKED = 'badge.unlocked.v1';
export const OUTBOX_STUDY_COMPLETED = 'study_together.completed.v1';
export const OUTBOX_BATTLE_COMPLETED = 'battle.completed.v1';
export const OUTBOX_REFERRAL_MILESTONE = 'referral.milestone_unlocked.v1';
