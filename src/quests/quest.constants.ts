export enum QuestCadence {
  Daily = 'daily',
  Weekly = 'weekly',
  Seasonal = 'seasonal',
  OneTime = 'one_time',
}

export enum QuestCategory {
  Learning = 'learning',
  League = 'league',
  Battle = 'battle',
  Social = 'social',
  Recovery = 'recovery',
  Side = 'side',
}

export enum QuestDefinitionStatus {
  Draft = 'draft',
  Active = 'active',
  Retired = 'retired',
}

export enum QuestConditionType {
  Counter = 'counter',
  LeagueXp = 'league_xp',
  ActiveDays = 'active_days',
  EventOnce = 'event_once',
}

export type QuestXpSource = 'lesson' | 'battle' | 'any';

export type QuestConditionJson = {
  counterKey?: string;
  target?: number;
  xpSource?: QuestXpSource;
  minXp?: number;
  /** When set with league_xp, UI goal = ceil(minXp/unitXp), progress = floor(xp/unitXp). */
  unitXp?: number;
  minDays?: number;
  eventType?: string;
};

export type QuestRewardJson = {
  xp?: number;
  leagueXp?: number;
  coins?: number;
  gems?: number;
};

export const QUEST_XP_SOURCES: QuestXpSource[] = ['lesson', 'battle', 'any'];
